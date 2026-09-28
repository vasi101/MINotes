import { test, expect } from '@playwright/test';
const entry = { entries: [{ pronunciations: [{ type: 'ipa', text: '/test/' }], partOfSpeech: 'noun', synonyms: ['statecraft'], senses: [{ definition: 'Relations between countries.', examples: ['They used diplomacy.'] }] }] };
test('dictionary service normalizes, deduplicates, persists, and handles failures', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async fixture => {
    const path = '/src/kitty/dictionary.ts';
    const { DictionaryService, FreeDictionaryProvider } = await import(path);
    let calls = 0;
    const original = window.fetch;
    window.fetch = async () => { calls++; await new Promise(r => setTimeout(r, 20)); return new Response(JSON.stringify(fixture)); };
    const storage = { value: '', getItem() { return this.value; }, setItem(_key: string, value: string) { this.value = value; } };
    const service = new DictionaryService([new FreeDictionaryProvider()], storage);
    const signal = () => new AbortController().signal;
    const words = ['convey', 'diplomacy', 'government', 'sovereignty', 'international', 'development', "don't", 'well-being'];
    for (const word of words) await service.lookup(word, signal());
    await Promise.all(['CONVEY', 'convey,', '(convey)'].map(word => service.lookup(word, signal())));
    await Promise.all([1,2,3].map(() => service.lookup('fresh', signal())));
    const count = calls;
    const invalid = await service.lookup('foreign policy', signal());
    const restored = new DictionaryService([new FreeDictionaryProvider()], storage);
    const cached = await restored.lookup('convey', signal());
    window.fetch = async () => new Response('{}', { status: 404 });
    const missing = await service.lookup('xyzabc', signal());
    window.fetch = async () => new Response('{}', { status: 500 });
    const failed = await service.lookup('failure', signal());
    window.fetch = async () => { throw new TypeError('network'); };
    const offline = await service.lookup('network', signal());
    window.fetch = original;
    return { count, invalid: invalid.status, source: cached.source, missing: missing.status, failed: failed.status, offline: offline.status };
  }, entry);
  expect(result).toEqual({ count: 9, invalid: 'INVALID_TERM', source: 'CACHE', missing: 'NOT_FOUND', failed: 'PROVIDER_ERROR', offline: 'NETWORK_ERROR' });
});

test('editor Meaning popup loads, copies, dismisses, fits themes, and caches offline', async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let calls = 0;
  await page.route('https://freedictionaryapi.com/**', async route => { calls++; await new Promise(r => setTimeout(r, 150)); await route.fulfill({ json: entry }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByTestId('toolbar-text').locator('..').click(); await page.mouse.click(430, 330);
  const input = page.locator('textarea.excalidraw-wysiwyg');
  await input.fill('diplomacy'); await input.selectText();
  await input.dispatchEvent('keyup', { key: 'Shift' });
  const menu = page.getByRole('region', { name: 'Selection menu' });
  await expect(menu).toBeVisible(); expect(calls).toBe(0);
  await expect(menu.getByRole('button', { name: 'Meaning', exact: true })).toHaveCount(1);
  await menu.getByRole('button', { name: 'Meaning', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Dictionary meaning' });
  await expect(panel).toContainText('Looking up...');
  await expect(panel).toContainText('Relations between countries.');
  await panel.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(panel).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('They used diplomacy.');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    await page.screenshot({ path: `test-results/dictionary-${theme}.png` });
    const color = await panel.evaluate(el => getComputedStyle(el).color);
    expect(color).toBe(await page.evaluate(() => getComputedStyle(document.body).color));
  }
  await page.setViewportSize({ width: 390, height: 740 });
  const box = await panel.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390); expect(box!.height).toBeLessThanOrEqual(370);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0);
  const show = async (text: string) => {
    await page.evaluate(text => window.dispatchEvent(new CustomEvent('minotes:ask-kitty', { detail: { text, context: '', x: 350, y: 700 } })), text);
    await page.getByRole('button', { name: 'Meaning', exact: true }).click();
  };
  await context.setOffline(true); await show('diplomacy'); await expect(panel).toContainText('Relations between countries.'); expect(calls).toBe(1);
  await page.mouse.click(10, 10); await expect(panel).toHaveCount(0);
  await show('uncached'); await expect(panel).toContainText('Dictionary unavailable while offline.');
  await context.setOffline(false);
  await show('foreign policy'); await expect(panel).toContainText('Dictionary currently supports individual words.'); expect(calls).toBe(1);
  await page.unroute('https://freedictionaryapi.com/**');
  await page.route('https://freedictionaryapi.com/**', route => route.fulfill({ status: 404, json: {} }));
  await show('xyzabc'); await expect(panel).toContainText('No definition found for "xyzabc".');
  await page.unroute('https://freedictionaryapi.com/**');
  await page.route('https://freedictionaryapi.com/**', route => route.fulfill({ status: 500, json: {} }));
  await show('failure'); await expect(panel).toContainText("Couldn't retrieve the definition.");
  await page.unroute('https://freedictionaryapi.com/**');
  await page.route('https://freedictionaryapi.com/**', route => route.fulfill({ json: entry }));
  await panel.getByRole('button', { name: 'Retry' }).click(); await expect(panel).toContainText('Relations between countries.');
  await panel.getByRole('button', { name: 'Close dictionary' }).click(); await expect(panel).toHaveCount(0);
});

test('Read PDF selection opens dictionary meaning', async ({ page }) => {
  const { PDFDocument } = await import('pdf-lib');
  await page.route('https://freedictionaryapi.com/**', route => route.fulfill({ json: entry }));
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }));
  await page.goto('/'); await page.getByRole('button', { name: 'Read', exact: true }).click();
  const pdf = await PDFDocument.create(); pdf.addPage([500, 700]).drawText('States use diplomacy.', { x: 50, y: 600, size: 16 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add to library', exact: true }).click();
  await page.locator('.reader-header-actions').getByRole('button', { name: 'Import PDF' }).click();
  await (await chooser).setFiles({ name: 'Dictionary.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByTestId(/pdf-card-/).click();
  await page.keyboard.press('v');
  const span = page.locator('.pdf-text-layer span').filter({ hasText: 'States use diplomacy' }).first();
  await expect(span).toBeAttached();
  await span.evaluate(element => {
    const node = element.firstChild!; const start = node.textContent!.indexOf('diplomacy');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 9);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 230 }));
  });
  await page.getByRole('button', { name: 'Meaning', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Dictionary meaning' })).toContainText('Relations between countries.');
});
