import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function mockGoogle(page: Page) {
  await page.route('https://accounts.google.com/gsi/client', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.google = { accounts: { oauth2: { initTokenClient(config) {
      return { requestAccessToken() {
        const failure = localStorage.getItem('google-failure');
        if (failure === 'popup') config.error_callback({type:'popup_failed_to_open'});
        else config.callback({access_token:'test-session-token',expires_in:3600,scope:failure === 'scope' ? 'email' : 'https://www.googleapis.com/auth/drive.readonly'});
      }};
    }}}};
  ` }));
}
async function openDrive(page: Page) {
  await page.getByRole('button', { name: 'More library actions', exact: true }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
}

test('browser connects, imports and refreshes Drive without storing secrets or losing offline copies', async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const folder = 'application/vnd.google-apps.folder';
  let expired = false, renamed = false;
  await mockGoogle(page);
  await page.route('https://www.googleapis.com/drive/v3/**', async route => {
    const url = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe('Bearer test-session-token');
    if (expired) { await route.fulfill({ status: 401, json: { error: 'expired' } }); return; }
    if (url.pathname.endsWith('/about')) { await route.fulfill({ json: { user: { permissionId: 'browser-account', emailAddress: 'reader@example.com' } } }); return; }
    if (url.pathname.endsWith('/changes/startPageToken')) return route.fulfill({ json: { startPageToken: '0' } });
    if (url.pathname.endsWith('/changes')) return route.fulfill({ json: { changes: renamed ? [{ fileId: 'pdf-1', file: { id: 'pdf-1', name: 'Renamed.pdf', mimeType: 'application/pdf', size: String(bytes.length), modifiedTime: '2026-09-01T00:00:00Z', parents: ['books'] } }] : [], newStartPageToken: renamed ? '1' : '0' } });
    if (url.searchParams.get('alt') === 'media') { await route.fulfill({ contentType: 'application/pdf', body: bytes }); return; }
    if (url.pathname.endsWith('/files/books')) { await route.fulfill({ json: { id: 'books', name: 'Books', mimeType: folder } }); return; }
    const file = { id: 'pdf-1', name: renamed ? 'Renamed.pdf' : 'Notes.pdf', mimeType: 'application/pdf', size: String(bytes.length), modifiedTime: '2026-09-01T00:00:00Z' };
    if (url.pathname.endsWith('/files/pdf-1')) { await route.fulfill({ json: file }); return; }
    const root = url.searchParams.get('q')?.startsWith("'root'");
    await route.fulfill({ json: root ? { files: [{ id: 'books', name: 'Books', mimeType: folder }] } : { files: [file] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await openDrive(page);
  await expect(page.getByText('Web application', { exact: true })).toBeVisible();
  await page.getByLabel('Google OAuth configuration').setInputFiles({ name: 'desktop.json', mimeType: 'application/json', buffer: Buffer.from('{"installed":{"client_id":"example.apps.googleusercontent.com"}}') });
  await expect(page.getByRole('alert')).toContainText('Web application');
  const origin = new URL(page.url()).origin;
  await page.getByLabel('Google OAuth configuration').setInputFiles({ name: 'web.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ web: { client_id: 'example.apps.googleusercontent.com', client_secret: 'test-secret-not-to-store', javascript_origins: [origin] } })) });
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByText('Connected: reader@example.com')).toBeVisible();
  await page.locator('.drive-folder-list').getByRole('button', { name: 'Books', exact: true }).click();
  await page.getByRole('button', { name: 'Import this Drive folder', exact: true }).click();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  const refresh = page.getByRole('button', { name: 'Refresh connected folders', exact: true });
  await expect(refresh).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
  await expect(page.getByRole('button', { name: 'View Drive sync status' })).toHaveAttribute('aria-busy', 'false');
  renamed = true;
  await refresh.click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].name)).toBe('Renamed');
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  expired = true;
  await refresh.click();
  await expect(page.getByRole('alert')).toContainText('sign-in expired');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
  await refresh.click();
  await expect(page.locator('.drive-connection')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('still linked');
  await page.getByRole('button', { name: 'Sign in to refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(saved).not.toContain('test-session-token'); expect(saved).not.toContain('test-secret-not-to-store');
  await page.reload();
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await openDrive(page);
  await expect(page.getByRole('button', { name: 'Connect Google Drive', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments.length)).toBe(1);
});

test('browser handles blocked sign-in popups and missing Drive consent', async ({ page }) => {
  await mockGoogle(page);
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('minotes-google-web-client', 'example.apps.googleusercontent.com'));
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await openDrive(page);
  await page.evaluate(() => localStorage.setItem('google-failure', 'popup'));
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Allow pop-ups');
  await page.evaluate(() => localStorage.setItem('google-failure', 'scope'));
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Allow read-only Google Drive access');
});


test('Google 403 errors show the actual reason and a matching next step', async ({ page }) => {
  await mockGoogle(page);
  let reason = 'SERVICE_DISABLED';
  let message = 'Google Drive API has not been used in project 123 before or it is disabled.';
  await page.route('https://www.googleapis.com/drive/v3/**', route => route.fulfill({ status: 403, json: { error: { message, details: [{ reason }] } } }));
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('minotes-google-web-client', 'example.apps.googleusercontent.com'));
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await openDrive(page);
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Enable Google Drive API');
  await expect(page.getByRole('alert')).toContainText('project 123');
  await expect(page.getByRole('alert')).toContainText('SERVICE_DISABLED');
  reason = 'userRateLimitExceeded'; message = 'User Rate Limit Exceeded';
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('quota was reached');
  reason = 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'; message = 'Request had insufficient authentication scopes.';
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('allow read-only Drive access');
  reason = 'newGoogleReason'; message = 'Additional access requirements apply.';
  await page.getByRole('button', { name: 'Connect Google Drive', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(message);
});
