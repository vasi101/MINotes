import { test, expect, type Page } from '@playwright/test';

async function scene(page: Page) {
  return page.evaluate(async () => {
    const notes = JSON.parse(localStorage.getItem('minotes-v1')!).state.notes;
    const path = '/src/canvas/storage.ts';
    return (await import(path)).loadScene(notes.find((n: { title: string }) => n.title === 'Canvas one').id);
  });
}
async function textElements(page: Page) {
  const data = await scene(page);
  return data?.elements.filter((e: { type: string; isDeleted: boolean }) => e.type === 'text' && !e.isDeleted) || [];
}
async function openCanvas(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByLabel('Note title').fill('Canvas one');
  await expect(page.locator('.excalidraw')).toBeVisible();
}
async function nativeText(page: Page, text: string, x: number, y: number) {
  await page.getByTestId('toolbar-text').locator('..').click();
  await page.mouse.click(x, y);
  const input = page.locator('textarea.excalidraw-wysiwyg');
  await expect(input).toBeVisible();
  await input.fill(text);
  return input;
}

test('T workflow formats headings at their native position, supports undo and reload', async ({ page }) => {
  await openCanvas(page);
  await expect(page.getByRole('button', { name: 'Write', exact: true })).toHaveCount(0);
  await expect(page.locator('.canvas-writer')).toHaveCount(0);
  await page.mouse.click(900, 600);
  await page.keyboard.press('t');
  await page.mouse.click(450, 250);
  const editor = page.locator('textarea.excalidraw-wysiwyg');
  await editor.fill('# Foreign Policy');
  await expect.poll(async () => (await textElements(page))[0]?.text).toBe('# Foreign Policy');
  const raw = (await textElements(page))[0];
  await editor.press('Escape');
  await expect.poll(async () => (await textElements(page))[0]?.text).toBe('Foreign Policy');
  let heading = (await textElements(page))[0];
  expect(heading).toMatchObject({ id: raw.id, x: raw.x, y: raw.y, fontSize: 40, fontFamily: raw.fontFamily, strokeColor: raw.strokeColor });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await textElements(page))[0]?.text).toBe('# Foreign Policy');
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await textElements(page))[0]?.text).toBe('Foreign Policy');
  for (const [prefix, y, size] of [['##', 370, 32], ['###', 480, 28]] as const) {
    const field = await nativeText(page, prefix + ' Topic', 450, y);
    await field.press('Escape');
    await expect.poll(async () => (await textElements(page)).at(-1)?.fontSize).toBe(size);
  }
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByRole('button', { name: /Canvas one/ }).click();
  await expect(page.locator('.excalidraw')).toBeVisible();
  await expect.poll(async () => (await textElements(page)).map((e: { text: string }) => e.text)).toEqual(['Foreign Policy', 'Topic', 'Topic']);
  await page.screenshot({ path: 'test-results/native-headings.png' });
});

test('native lists continue, increment, indent, exit and preserve normal Enter', async ({ page }) => {
  await openCanvas(page);
  const editor = await nativeText(page, '- National Interest', 400, 240);
  await editor.press('Enter');
  await expect(editor).toHaveValue('\u2022 National Interest\n\u2022 ');
  await editor.press('Tab');
  await page.keyboard.insertText('Nested');
  await editor.press('Enter');
  await expect(editor).toHaveValue('\u2022 National Interest\n    \u2022 Nested\n    \u2022 ');
  await editor.press('Shift+Tab');
  await page.keyboard.insertText('Back');
  await editor.press('Enter'); await editor.press('Enter');
  await page.keyboard.insertText('Plain'); await editor.press('Enter');
  await page.keyboard.insertText('Next paragraph');
  await expect(editor).toHaveValue('\u2022 National Interest\n    \u2022 Nested\n\u2022 Back\nPlain\nNext paragraph');
  await editor.press('Escape');
  const numbered = await nativeText(page, '1. First', 800, 240);
  await numbered.press('Enter'); await page.keyboard.insertText('Second');
  await numbered.press('Enter'); await page.keyboard.insertText('Third');
  await expect(numbered).toHaveValue('1. First\n2. Second\n3. Third');
  await numbered.press('Enter'); await numbered.press('Enter');
  await expect(numbered).toHaveValue('1. First\n2. Second\n3. Third\n');
  await numbered.press('Escape');
  const star = await nativeText(page, '* Star bullet', 800, 460);
  await star.press('Escape');
  await expect.poll(async () => (await textElements(page)).at(-1)?.text).toBe('\u2022 Star bullet');
});

for (const theme of ['dark', 'light'] as const) {
  test(`native textarea is transparent and keeps selected color in ${theme} theme`, async ({ page }) => {
    await openCanvas(page);
    if (theme === 'light') {
      await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
      await page.getByRole('button', { name: 'Switch to light theme', exact: true }).click();
      await page.getByRole('button', { name: 'Open Canvas one', exact: true }).click();
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect.poll(() => page.locator('.excalidraw').evaluate(element => element.classList.contains('theme--dark'))).toBe(theme === 'dark');
    const editor = await nativeText(page, 'Clearly visible text', 450, 280);
    const styles = await editor.evaluate(input => { const style = getComputedStyle(input); return { background: style.backgroundColor, border: style.borderTopWidth, blur: style.backdropFilter, color: style.color, inlineColor: input.style.color, caret: style.caretColor, fill: style.webkitTextFillColor, filter: style.filter }; });
    expect(styles.background).toBe('rgba(0, 0, 0, 0)');
    expect(styles.border).toBe('0px'); expect(styles.blur).toBe('none');
    expect(styles.color).toBe(styles.inlineColor); expect(styles.caret).toBe(styles.color); expect(styles.fill).toBe(styles.color);
    expect(styles.filter === 'none').toBe(theme === 'light');
    await editor.press('Control+a');
    await page.screenshot({ path: `test-results/native-text-${theme}.png` });
    await editor.press('Escape');
  });
}
test('native shapes, pen, arrows, image files, text movement and undo survive reload', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Force the ordinary file input path instead of the OS File System picker.
  await page.addInitScript(() => { Reflect.deleteProperty(window, 'showOpenFilePicker'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByLabel('Note title').fill('Canvas one');
  for (const [tool, y] of [['rectangle', 280], ['arrow', 400], ['freedraw', 520]] as const) {
    await page.getByTestId(`toolbar-${tool}`).locator("..").click();
    await page.mouse.move(450, y); await page.mouse.down();
    await page.mouse.move(650, y + 65, { steps: 12 }); await page.mouse.up();
  }
  await expect.poll(async () => (await scene(page)).elements.filter((e: { isDeleted: boolean }) => !e.isDeleted).map((e: { type: string }) => e.type)).toEqual(['rectangle', 'arrow', 'freedraw']);
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('toolbar-image').locator('..').click();
  await (await chooser).setFiles('public/reader-cat-reference.png');
  await page.mouse.click(900, 420);
  await expect.poll(async () => Object.keys((await scene(page)).files).length).toBe(1);
  await nativeText(page, 'Move me', 750, 200);
  await page.locator('textarea.excalidraw-wysiwyg').press('Escape');
  await expect(page.locator('textarea.excalidraw-wysiwyg')).toHaveCount(0);
  const before = (await textElements(page))[0];
  const state = (await scene(page)).appState;
  const bounds = await page.locator('.canvas-stage').boundingBox();
  const x = bounds!.x + (before.x + state.scrollX + before.width / 2) * state.zoom.value;
  const y = bounds!.y + (before.y + state.scrollY + before.height / 2) * state.zoom.value;
  await page.getByTestId('toolbar-selection').locator('..').click();
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 60, { steps: 8 }); await page.mouse.up();
  await page.screenshot({ path: 'test-results/canvas-move.png' });
  await expect.poll(async () => (await textElements(page))[0].x).toBeCloseTo(before.x + 100, 0);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await textElements(page))[0].x).toBeCloseTo(before.x, 0);
  await page.getByRole('button', { name: 'Back to notes', exact: true }).click();
  await page.reload(); await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByRole('button', { name: /Canvas one/ }).click();
  await expect(page.locator('.excalidraw')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Saved locally');
  const restored = await scene(page);
  expect(restored.elements.filter((e: { isDeleted: boolean }) => !e.isDeleted).map((e: { type: string }) => e.type)).toEqual(['rectangle', 'arrow', 'freedraw', 'image', 'text']);
  expect(Object.values(restored.files)[0]).toMatchObject({ mimeType: 'image/png', dataURL: expect.stringContaining('data:image/png;base64,') });
});
