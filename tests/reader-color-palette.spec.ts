import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
test('expanded palette offers soft colors and a visible custom control', async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  await page.goto('/'); await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByTestId('pdf-file-input').setInputFiles({ name: 'Colors.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Open Colors', exact: true }).click();
  await page.getByRole('button', { name: 'Open tools', exact: true }).click();
  await page.getByRole('button', { name: 'Pick color', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Soft highlight colors' }).getByRole('button')).toHaveCount(14);
  await page.getByRole('button', { name: 'Soft highlight #b2dfdb', exact: true }).click();
  await expect(page.getByLabel('Custom highlight color')).toHaveValue('#b2dfdb');
  await page.getByLabel('Custom highlight color').fill('#abcdef');
  await expect(page.locator('.reader-custom-color code')).toHaveText('#ABCDEF');
  const box = (await page.getByLabel('Custom highlight color').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(42);
  await page.screenshot({ path: 'artifacts/highlight-palette.png' });
});
