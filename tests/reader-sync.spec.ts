import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function mockDrive(page: import('@playwright/test').Page) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const original = Array.from(await pdf.save()); pdf.addPage();
  const changed = Array.from(await pdf.save());
  await page.addInitScript(({ original, changed }) => {
    const folder = 'application/vnd.google-apps.folder';
    Object.defineProperty(window, 'isTauri', { value: true });
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
      invoke: async (command: string, args: { folderId?: string; fileId?: string; accountId?: string }) => {
        const stage = Number(localStorage.getItem('drive-stage') || 0);
        const status = () => ({ configured: localStorage.getItem('drive-configured') === 'yes', connected: localStorage.getItem('drive-connected') === 'yes', email: 'reader@example.com', accountId: 'account-1' });
        if (command === 'drive_status') return status();
        if (command === 'drive_configure') { localStorage.setItem('drive-configured', 'yes'); return; }
        if (command === 'drive_connect') { localStorage.setItem('drive-connected', 'yes'); return status(); }
        if (command === 'drive_disconnect') { localStorage.removeItem('drive-connected'); return; }
        if (command.startsWith('drive_') && !status().connected) throw new Error('Connect to Google Drive first.');
        if (command === 'drive_metadata') return { id: args.fileId, name: 'Books', mimeType: folder };
        if (command === 'drive_list') {
          if (localStorage.getItem('drive-fail') === 'yes') throw new Error('Cannot reach Google Drive. Your downloaded PDFs are still available offline.');
          if (args.folderId === 'root') return [{ id: 'books', name: 'Books', mimeType: folder }];
          if (args.folderId === 'books') return stage === 0 ? [
            { id: 'pdf-1', name: 'Original.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-01T00:00:00Z', size: String(original.length) },
            { id: 'old', name: 'Old empty', mimeType: folder }
          ] : [{ id: 'new', name: 'New folder', mimeType: folder }, { id: 'empty', name: 'Another empty', mimeType: folder }];
          if (args.folderId === 'new') return [{ id: stage === 1 ? 'pdf-1' : 'pdf-2', name: stage === 1 ? 'Renamed.pdf' : 'Added.pdf', mimeType: 'application/pdf', modifiedTime: '2026-09-02T00:00:00Z', size: String(changed.length) }];
          return [];
        }
        if (command === 'drive_download') {
          localStorage.setItem('drive-downloads', String(Number(localStorage.getItem('drive-downloads') || 0) + 1));
          return stage === 0 ? original : changed;
        }
        return null;
      },
    } });
  }, { original, changed });
}

test('Drive setup imports folders, then refresh preserves annotations across rename and move', async ({ page }) => {
  await mockDrive(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder label', { exact: true }).fill('Study');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await expect(page.getByText('One-time Google setup')).toBeVisible();
  await page.screenshot({ path: 'test-results/google-drive-setup.png' });
  await page.getByLabel('Google OAuth configuration').setInputFiles({ name: 'client.json', mimeType: 'application/json', buffer: Buffer.from('{"installed":{"client_id":"test.apps.googleusercontent.com"}}') });
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await page.locator('.drive-folder-list').getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Import this Drive folder', exact: true }).click();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh connected folders', exact: true })).toBeVisible();
  const originalId = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('minotes-v1')!);
    const doc = saved.state.readDocuments[0]; doc.favourite = true;
    doc.marks = [{ id: 'mark', page: 1, kind: 'ink', color: '#000000', rects: [], points: [1, 1, 2, 2], width: 2 }];
    localStorage.setItem('minotes-v1', JSON.stringify(saved));
    localStorage.setItem('drive-stage', '1');
    return doc.id;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh Google Drive folders', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].name)).toBe('Renamed');
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state);
  expect(state.readDocuments).toHaveLength(1);
  expect(state.readDocuments[0]).toMatchObject({ id: originalId, favourite: true, folder: 'Study/Books/New folder', pages: 2 });
  expect(state.readDocuments[0].marks).toHaveLength(1);
  expect(state.readFolders).not.toContain('Study/Books/Old empty');
  expect(state.readFolderColors['Study/Books/New folder']).not.toBe(state.readFolderColors['Study/Books/Another empty']);
  const downloads = await page.evaluate(() => localStorage.getItem('drive-downloads'));
  await page.getByRole('button', { name: 'Refresh Google Drive folders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh Google Drive folders', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem('drive-downloads'))).toBe(downloads);
  await page.evaluate(() => localStorage.setItem('drive-fail', 'yes'));
  await page.getByRole('button', { name: 'Refresh Google Drive folders', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Cannot reach Google Drive');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
  await page.evaluate(() => { localStorage.removeItem('drive-fail'); localStorage.setItem('drive-stage', '2'); });
  await page.getByRole('button', { name: 'Refresh Google Drive folders', exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.map((doc: { name: string }) => doc.name))).toEqual(['Added']);
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
});

test('compact library toolbar opens Drive setup from More', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.locator('.reader-header-actions > button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Refresh Google Drive folders' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Refresh connected folders' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await expect(page.getByText('Web application', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load Google OAuth JSON', exact: true })).toBeVisible();
  await expect(page.getByText('Import your system folder again to connect it for refresh.')).toHaveCount(0);
});


test('refresh remains visible for a previously imported folder without active Drive sign-in', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('minotes-v1') || '{"state":{},"version":0}');
    saved.state.readFolders = ['NASU', 'NASU/3RD', 'Unlinked'];
    saved.state.readDocuments = [{ id: 'copy', name: 'Notes', folder: 'NASU/3RD', sourcePath: 'NASU/3RD/Notes.pdf', pages: 1, size: 100, addedAt: '2026-01-01', lastPage: 1, zoom: 0, marks: [] }];
    localStorage.setItem('minotes-v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  const refresh = page.getByRole('button', { name: 'Refresh connected folders', exact: true });
  await expect(refresh).toBeVisible();
  await page.getByRole('button', { name: 'NASU', exact: true }).click();
  await page.getByRole('button', { name: '3RD', exact: true }).click();
  await expect(refresh).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).first().click();
  await page.getByRole('button', { name: 'Unlinked', exact: true }).click();
  await expect(refresh).toHaveCount(0);
});


test('Read removes folders directly, deletes cached PDFs and stops Drive from restoring them', async ({ page }) => {
  await mockDrive(page);
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('drive-configured', 'yes'); localStorage.setItem('drive-connected', 'yes'); });
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByLabel('Folder label', { exact: true }).fill('Keep');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await page.locator('.drive-folder-list').getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Import this Drive folder', exact: true }).click();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  const documentId = await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].id);
  await page.getByRole('button', { name: 'Remove folder Books', exact: true }).click();
  await expect(page.getByText('Original files in Google Drive or on your computer stay unchanged.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Books', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Remove folder Old empty', exact: true }).click();
  await page.getByRole('button', { name: 'Remove folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Old empty', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh connected folders', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh connected folders', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Old empty', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Remove this folder', exact: true }).click();
  await page.getByRole('button', { name: 'Remove folder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Books', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(0);
  const cached = await page.evaluate(id => new Promise(resolve => {
    const open = indexedDB.open('minotes-pdf-files');
    open.onsuccess = () => {
      const read = open.result.transaction('files').objectStore('files').get(id);
      read.onsuccess = () => { resolve(!!read.result); open.result.close(); };
    };
  }), documentId);
  expect(cached).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Books', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keep', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh connected folders', exact: true })).toHaveCount(0);
});
