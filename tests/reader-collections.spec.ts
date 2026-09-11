import { test, expect } from '@playwright/test';
test('reading collections sort history and persist document flags across folders', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('minotes-v1') || '{"state":{},"version":0}');
    saved.state.readDocuments = [
      { id:'older', name:'Older document', folder:'Study', lastOpenedAt:'2026-09-09T00:00:00Z' },
      { id:'newer', name:'Newer document', lastOpenedAt:'2026-09-11T00:00:00Z' },
      { id:'unread', name:'Unread document' },
    ].map(d => ({ pages:1, size:100, addedAt:'2026-09-01T00:00:00Z', lastPage:1, zoom:0, marks:[], ...d }));
    saved.state.readFolders = ['Study'];
    localStorage.setItem('minotes-v1', JSON.stringify(saved));
  });
  await page.reload();
  await page.getByRole('button', { name:'Read', exact:true }).click();
  const collections = page.getByRole('navigation', { name:'Document collections' });
  await collections.getByRole('button', { name:'Recent', exact:true }).click();
  await expect(page.locator('.pdf-card-name')).toHaveText(['Newer document', 'Older document']);
  await page.getByRole('button', { name:'Add Older document to Favourite', exact:true }).click();
  await page.getByRole('button', { name:'Add Older document to To Read', exact:true }).click();
  await collections.getByRole('button', { name:'Favourite', exact:true }).click();
  await expect(page.locator('.pdf-card-name')).toHaveText(['Older document']);
  await page.reload();
  await page.getByRole('button', { name:'Read', exact:true }).click();
  await collections.getByRole('button', { name:'To Read', exact:true }).click();
  await expect(page.locator('.pdf-card-name')).toHaveText(['Older document']);
  await page.getByRole('button', { name:'Remove Older document from To Read', exact:true }).click();
  await expect(page.getByText('Nothing in To Read yet')).toBeVisible();
});
