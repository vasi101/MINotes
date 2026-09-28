import { test, expect, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

async function openPdf(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 800]).drawText('States use diplomacy to resolve disagreements.', { x: 60, y: 640, size: 18 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByTestId('pdf-file-input').setInputFiles({ name: 'Diplomacy.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Open Diplomacy', exact: true }).click();
  await expect(page.locator('.pdf-text-layer')).toHaveAttribute('data-ready', 'true');
}
async function dragWord(page: Page) {
  const span = page.locator('.pdf-text-layer span').filter({ hasText: 'States use diplomacy' }).first();
  const box = await span.evaluate(element => {
    const node = element.firstChild!; const start = node.textContent!.indexOf('diplomacy');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 9);
    const rect = range.getBoundingClientRect(); return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(box.left + 1, box.y); await page.mouse.down();
  await page.mouse.move(box.right - 1, box.y, { steps: 12 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('diplomacy');
  return box;
}
test('real PDF drag retains selection for right-click and visible Kitty button', async ({ page }) => {
  let requests = 0;
  await page.route('https://freedictionaryapi.com/**', route => { requests++; return route.fulfill({ json: { entries: [{ partOfSpeech: 'noun', senses: [{ definition: 'Managing relations between countries.' }] }] } }); });
  await openPdf(page);
  await expect(page.getByRole('button', { name: 'Ask Kitty about PDF text' })).toBeVisible();
  await expect(page.locator('.reader-kitty-button')).toHaveCount(0);
  await expect(page.locator('.reader-page-cat')).toHaveAccessibleName('Ask Kitty about PDF text');
  await expect(page.getByText('Coming soon', { exact: true })).toHaveCount(0);
  const box = await dragWord(page);
  // A real release and right-click must work after the highlight handler's turn.
  await page.mouse.click((box.left + box.right) / 2, box.y, { button: 'right' });
  await expect(page.getByRole('region', { name: 'Selection menu' })).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('button', { name: /^(Meaning|Phrase meaning)$/, exact: true }).click();
  await expect(page.getByRole('region', { name: 'Dictionary meaning' })).toContainText('Managing relations between countries.');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].marks.length)).toBe(0);
  await page.getByRole('button', { name: 'Close dictionary', exact: true }).click();
  await dragWord(page);
  await page.getByRole('button', { name: 'Ask Kitty about PDF text' }).click();
  await expect(page.locator('[data-kitty-reader-host]').getByRole('region', { name: 'Kitty answer' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask Kitty', exact: true })).toBeFocused();
  await expect(page.locator('.kitty-chat-context')).toContainText('diplomacy');
  expect(requests).toBe(1);
  await page.screenshot({path:'test-results/reader-kitty-cat.png'});
});
test('reader controls enable automatic Kitty and restore selection after pen mode', async ({ page }) => {
  await openPdf(page);
  await page.keyboard.press('p');
  await expect(page.locator('.pdf-text-layer')).toHaveCSS('pointer-events', 'none');
  await page.getByRole('button', { name: 'Toggle page card' }).click();
  await expect(page.getByRole('region', { name: 'Kitty reading controls' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Ask on Selection' }).check();
  await page.getByRole('button', { name: 'Select text', exact: true }).click();
  await expect(page.locator('.pdf-text-layer')).toHaveCSS('pointer-events', 'auto');
  await dragWord(page);
  await expect(page.getByRole('region', { name: 'Selection menu', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close Kitty actions' }).click();
  // Highlight remains an explicit tool and still creates annotations.
  await page.keyboard.press('h');
  const span = page.locator('.pdf-text-layer span').first(); const box = await span.boundingBox();
  await page.mouse.move(box!.x + 1, box!.y + 6); await page.mouse.down(); await page.mouse.move(box!.x + 70, box!.y + 6, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('minotes-v1')!).state.readDocuments[0].marks.length)).toBeGreaterThan(0);
});

test('compact page cat expands to a formatted chat using current page text', async ({page}) => {
  let request: any;
  await page.route('**/api/kitty/generate', route => {request=route.request().postDataJSON();return route.fulfill({body:JSON.stringify({result:{text:'## Diplomacy explained\n\nA **peaceful** approach.\n\n- Builds trust\n- Resolves disagreements\n\n### Steps\n1. Listen\n2. Negotiate'}})+'\n'});});
  await openPdf(page);
  const pill=page.locator('.reader-page-jump'); const before=await pill.boundingBox();
  expect(before!.width).toBeLessThanOrEqual(235); expect(before!.height).toBeLessThan(50);
  await page.getByRole('button',{name:'Ask Kitty about PDF text'}).click();
  const chat=page.getByRole('region',{name:'Kitty answer'}); await expect(chat).toBeVisible();
  await expect(page.getByRole('region',{name:'Kitty reading controls'})).toHaveCount(0);
  await chat.getByRole('textbox',{name:'Ask Kitty',exact:true}).fill('Explain the main idea');
  await chat.getByRole('button',{name:'Send question'}).click();
  await expect(chat.getByRole('heading',{name:'Diplomacy explained'})).toBeVisible();
  await expect(chat.locator('.kitty-answer-text li')).toHaveCount(4);
  await expect(chat.locator('.kitty-answer-text strong')).toHaveText('peaceful');
  expect(JSON.parse(request.prompt).selectedText).toContain('States use diplomacy');
  await page.screenshot({path:'test-results/kitty-page-chat-formatted.png'});
  await chat.getByRole('button',{name:'Close Kitty',exact:true}).click();
  await expect(pill).not.toHaveClass(/is-expanded/);
});
