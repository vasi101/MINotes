import { test, expect } from '@playwright/test';

test('finds folders by name across pages and lets users choose duplicate names', async ({ page }) => {
  const mimeType = 'application/vnd.google-apps.folder';
  const name = "Reader's Books";
  const queries: string[] = [];
  await page.route('**/api/auth/status', route => route.fulfill({ json: { configured: true, persistent: true, connected: true, accountId: 'account', email: 'reader@example.com' } }));
  await page.route('**/api/drive/**', route => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get('q') || '';
    expect(route.request().headers()['x-drive-account']).toBe('account');
    if (q.includes('name contains')) {
      queries.push(q);
      if (q.includes('Missing')) return route.fulfill({ json: { files: [] } });
      expect(q).toContain("name contains 'Reader\\'s Books'");
      expect(q).toContain("mimeType = 'application/vnd.google-apps.folder'");
      expect(q).not.toContain('in parents');
      return route.fulfill({ json: url.searchParams.get('pageToken') ? { files: [{ id: 'second', name, mimeType }] } : { files: [{ id: 'first', name, mimeType }], nextPageToken: 'next' } });
    }
    return route.fulfill({ json: { files: q.startsWith("'second'") ? [{ id: 'child', name: 'Selected second folder', mimeType }] : [] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByRole('button', { name: 'More library actions' }).click();
  await page.getByRole('button', { name: 'Google Drive', exact: true }).click();
  await page.getByLabel('Folder name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Find folder', exact: true }).click();
  const results = page.getByRole('region', { name: 'Folder search results' });
  await expect(results.getByRole('button', { name, exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Import this Drive folder' })).toHaveCount(0);
  await results.getByRole('button', { name, exact: true }).nth(1).click();
  await expect(page.getByRole('button', { name: 'Selected second folder', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import this Drive folder' })).toBeEnabled();
  expect(queries).toHaveLength(2);
  await page.getByLabel('Folder name', { exact: true }).fill('Missing');
  await page.getByRole('button', { name: 'Find folder', exact: true }).click();
  await expect(page.getByText('No folders found. Try another name.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import this Drive folder' })).toHaveCount(0);
});
