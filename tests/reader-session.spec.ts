import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

test('Continue with Google imports a folder and stays connected across reloads', async ({ page, context }) => {
  let connected = false;
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const folder = { id: 'books', name: 'Books', mimeType: 'application/vnd.google-apps.folder' };
  const file = { id: 'notes', name: 'Notes.pdf', mimeType: 'application/pdf', size: String(bytes.length), modifiedTime: '2026-09-01T00:00:00Z' };
  await context.route('**/api/auth/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/start')) {
      connected = true;
      return route.fulfill({ contentType: 'text/html', body: '<p>Signed in</p><script>window.opener?.postMessage({type:"minotes-google-auth"},location.origin);</script>' });
    }
    if (pathname.endsWith('/logout')) connected = false;
    return route.fulfill({ json: { configured: true, persistent: true, connected, accountId: connected ? 'account' : undefined, email: connected ? 'reader@example.com' : undefined } });
  });
  await context.route('**/api/drive/**', async route => {
    expect(route.request().headers()['x-drive-account']).toBe('account');
    expect(route.request().headers().authorization).toBeUndefined();
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/changes/startPageToken')) return route.fulfill({ json: { startPageToken: '0' } });
    if (url.pathname.endsWith('/changes')) return route.fulfill({ json: { changes: [], newStartPageToken: '0' } });
    if (url.searchParams.get('alt') === 'media') return route.fulfill({ contentType: 'application/pdf', body: bytes });
    if (url.pathname.endsWith('/books')) return route.fulfill({ json: folder });
    if (url.pathname.endsWith('/notes')) return route.fulfill({ json: file });
    return route.fulfill({ json: { files: url.searchParams.get('q')?.startsWith("'root'") ? [folder] : [file] } });
  });
  const open = async () => {
    await page.getByRole('button', { name: 'More library actions' }).click();
    await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await open();
  await expect(page.getByRole('button', { name: 'Load Google OAuth JSON' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await expect(page.getByText('Connected: reader@example.com')).toBeVisible();
  await page.locator('.drive-folder-list').getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Import this Drive folder' }).click();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh connected folders' }).click();
  await expect(page.getByRole('button', { name: 'Refresh connected folders' })).toBeEnabled();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  await open();
  await expect(page.getByText('Connected: reader@example.com')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
});
