import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('saved change markers avoid scans, retry failures, and sync uploads and moved folders', async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const folder = (id: string, name = id) => ({ id, name, mimeType: 'application/vnd.google-apps.folder' });
  const file = (id: string, parent = 'books') => ({ id, name: `${id}.pdf`, mimeType: 'application/pdf', size: String(bytes.length), modifiedTime: '2026-09-01T00:00:00Z', parents: [parent] });
  let revision = 0, failDownload = false, failPage = false;
  const lists: string[] = [], downloads: string[] = [], cursors: string[] = [];
  await page.route('**/api/auth/status', route => route.fulfill({ json: { configured: true, persistent: true, connected: true, accountId: 'account', email: 'reader@example.com' } }));
  await page.route('**/api/drive/**', async route => {
    const url = new URL(route.request().url());
    const id = url.pathname.split('/').pop()!;
    if (url.pathname.endsWith('/changes/startPageToken')) return route.fulfill({ json: { startPageToken: String(revision) } });
    if (url.pathname.endsWith('/changes')) {
      const token = url.searchParams.get('pageToken')!; cursors.push(token);
      if (token === String(revision)) return route.fulfill({ json: { changes: [], newStartPageToken: token } });
      if (revision === 1) return route.fulfill({ json: { changes: [{ fileId: 'added', file: file('added') }], newStartPageToken: '1' } });
      if (revision === 2) {
        if (token !== 'page2') return route.fulfill({ json: { changes: [{ fileId: 'moved', file: { ...folder('moved'), parents: ['books'] } }], nextPageToken: 'page2' } });
        if (failPage) return route.fulfill({ status: 503, json: {} });
        return route.fulfill({ json: { changes: [{ fileId: 'original', removed: true }], newStartPageToken: '2' } });
      }
      if (revision === 3) return route.fulfill({ json: { changes: [{ fileId: 'added', file: { ...file('added'), parents: ['outside'] } }], newStartPageToken: '3' } });
      if (revision === 5) return route.fulfill({ json: { changes: [{ fileId: 'nested', file: { ...file('nested', 'moved'), modifiedTime: '2026-09-02T00:00:00Z' } }], newStartPageToken: '5' } });
      return route.fulfill({ json: { changes: [{ fileId: 'unrelated', file: file('unrelated', 'outside') }], newStartPageToken: '4' } });
    }
    if (url.searchParams.get('alt') === 'media') {
      downloads.push(id);
      if (failDownload && id === 'added') return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ contentType: 'application/pdf', body: bytes });
    }
    if (id === 'books') return route.fulfill({ json: folder('books', 'Books') });
    if (id !== 'files') return route.fulfill({ json: file(id) });
    const parent = url.searchParams.get('q')!.match(/^'([^']+)'/)![1]; lists.push(parent);
    return route.fulfill({ json: { files: parent === 'root' ? [folder('books', 'Books')] : parent === 'books' ? [file('original')] : parent === 'moved' ? [file('nested', 'moved')] : [] } });
  });
  const docs = () => page.evaluate(() => (JSON.parse(localStorage.getItem('minotes-v1') || 'null')?.state.readDocuments || []).map((doc: any) => doc.sourceFileId).sort());
  const refresh = () => page.evaluate(async () => { const path = '/src/reader/googleDrive.ts'; await (await import(path)).refreshDriveInBackground(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Profile', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a Drive folder' }).click();
  await page.locator('.drive-folder-list').getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Import this Drive folder' }).click();
  await expect.poll(docs).toEqual(['original']);
  await expect(page.getByRole('button', { name: 'View Drive sync status' })).toHaveAttribute('aria-busy', 'false');
  const baseline = [...lists];
  await page.reload();
  await expect.poll(() => cursors.length).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'View Drive sync status' })).toHaveAttribute('aria-busy', 'false');
  expect(lists).toEqual(baseline); expect(downloads).toEqual(['original']);
  revision = 1; failDownload = true;
  await refresh(); await expect.poll(docs).toEqual(['original']);
  failDownload = false; await refresh();
  await expect.poll(docs).toEqual(['added', 'original']);
  expect(cursors.slice(-2)).toEqual(['0', '0']);
  expect(lists).toEqual(baseline);
  revision = 2; failPage = true;
  await refresh(); await expect.poll(docs).toEqual(['added', 'original']);
  expect(lists).toEqual(baseline); // A failed page must not partially remove files or scan folders.
  failPage = false; await refresh();
  await expect.poll(docs).toEqual(['added', 'nested']);
  expect(lists).toEqual([...baseline, 'moved']); // Only the newly linked subtree is listed.
  revision = 3; await refresh(); await expect.poll(docs).toEqual(['nested']);
  const downloaded = [...downloads];
  revision = 4; await refresh();
  expect(lists).toEqual([...baseline, 'moved']); expect(downloads).toEqual(downloaded);
  await refresh(); expect(cursors.at(-1)).toBe('4');
  await page.evaluate(async () => {
    const path = '/src/store.ts'; const { useStore } = await import(path);
    useStore.getState().updateReadDocument(useStore.getState().readDocuments[0].id, { favourite: true });
  });
  revision = 5; await refresh();
  expect(downloads).toEqual([...downloaded, 'nested']);
  expect(lists).toEqual([...baseline, 'moved']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].favourite)).toBe(true);
});
