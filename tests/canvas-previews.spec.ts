import { test, expect, type Page } from '@playwright/test';

async function openNew(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(page.locator('.excalidraw')).toBeVisible();
}
test('title stays compact and window-centered; Library hidden at desktop and mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openNew(page);
  const title = page.getByLabel('Note title');
  for (const text of ['Call', 'Foreign Policy', 'A very long note title '.repeat(12)]) {
    await title.fill(text);
    const bounds = (await title.boundingBox())!;
    expect(Math.abs(bounds.x + bounds.width / 2 - 640)).toBeLessThan(2);
    expect(bounds.width).toBeLessThanOrEqual(360);
    if (text === 'Call') expect(bounds.width).toBeLessThanOrEqual(145);
    await title.press('Enter');
    await expect(title).not.toBeFocused();
  }
  await expect(page.getByRole('checkbox', { name: 'Library', exact: true })).toBeHidden();
  await expect(page.locator('.canvas-writer')).toHaveCount(0);
  await title.fill('Call'); await title.press('Enter');
  await page.screenshot({ path: 'test-results/compact-canvas.png' });
  await page.setViewportSize({ width: 430, height: 800 });
  await expect.poll(async () => { const box = (await title.boundingBox())!; return Math.abs(box.x + box.width / 2 - 215); }).toBeLessThan(2);
  await expect(page.getByRole('checkbox', { name: 'Library', exact: true })).toBeHidden();
});

test('actual bounded scene previews are cached, theme-aware and never replace scene data', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openNew(page);
  await page.getByLabel('Note title').fill('Foreign Policy');
  await page.getByTestId('toolbar-text').locator('..').click();
  await page.mouse.click(450, 240);
  await page.locator('textarea.excalidraw-wysiwyg').fill('# Foreign Policy');
  await page.locator('textarea.excalidraw-wysiwyg').press('Escape');
  await page.getByTestId('toolbar-rectangle').locator('..').click();
  await page.mouse.move(460, 350); await page.mouse.down(); await page.mouse.move(670, 460, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  const card = page.getByRole('button', { name: 'Open Foreign Policy', exact: true });
  await expect(card.getByRole('img', { name: 'Canvas preview' })).toBeVisible();
  const saved = await page.evaluate(async () => {
    const storePath = '/src/store.ts', scenePath = '/src/canvas/storage.ts', previewPath = '/src/canvas/previewStorage.ts';
    const note = (await import(storePath)).useStore.getState().notes[0];
    const scene = await (await import(scenePath)).loadScene(note.id);
    const preview = await (await import(previewPath)).loadPreview(note.id);
    return { id: note.id, elements: scene.elements, files: scene.files, signature: preview.signature, light: preview.light.size, dark: preview.dark.size };
  });
  expect(saved.light).toBeGreaterThan(500); expect(saved.dark).toBeGreaterThan(500);
  expect(saved.elements.filter((e: { isDeleted: boolean }) => !e.isDeleted)).toHaveLength(2);
  await expect(card.locator('p')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/note-cover-dark.png' });
  const darkUrl = await card.locator('img').getAttribute('src');
  await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(card.locator('img')).not.toHaveAttribute('src', darkUrl!);
  await expect.poll(async () => card.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.screenshot({ path: 'test-results/note-cover-light.png' });
  await page.reload(); await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await expect(card.locator('img')).toBeVisible();
  // Loading the grid uses only cached blobs, with no Excalidraw canvas mounted.
  await expect(page.locator('.excalidraw')).toHaveCount(0);
  const beforeReopen = await page.evaluate(async id => { const path = '/src/canvas/storage.ts'; return (await import(path)).loadScene(id); }, saved.id);
  expect(beforeReopen.elements).toEqual(saved.elements);
  await card.click();
  await expect(page.locator('.excalidraw')).toBeVisible();
  const restored = await page.evaluate(async id => { const path = '/src/canvas/storage.ts'; return (await import(path)).loadScene(id); }, saved.id);
  // Native restore normalizes missing bindings to an empty array.
  const normalize = (elements: typeof saved.elements) => elements.map((element: { boundElements: unknown }) => ({ ...element, boundElements: element.boundElements ?? [] }));
  expect(normalize(restored.elements)).toEqual(normalize(saved.elements)); expect(restored.files).toEqual(saved.files);
});

test('empty covers and dense grid are responsive without horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'All notes', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const path = '/src/store.ts'; const store = (await import(path)).useStore;
    for (let i = 0; i < 12; i++) { const id = store.getState().addNote(); store.getState().updateNote(id, { title: `Empty ${i}`, canvasEmpty: true }); }
  });
  await page.reload();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  for (const width of [1280, 768, 430]) {
    await page.setViewportSize({ width, height: 900 });
    const cards = page.locator('.canvas-note-card');
    await expect(cards).toHaveCount(12);
    await expect(cards.first().getByText('Empty note')).toBeVisible();
    await expect(cards.locator('img')).toHaveCount(0);
    expect(await page.locator('.cards.notes').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const box = (await cards.first().boundingBox())!;
    expect(box.width).toBeLessThan(240);
    const dateBox = (await cards.first().locator('time').boundingBox())!;
    expect(dateBox.y + dateBox.height).toBeLessThanOrEqual(box.y + box.height - 4);
    if (width === 1280) await page.screenshot({ path: 'test-results/note-grid.png' });
  }
});
