import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

for (const native of [true, false]) {
  test(`${native ? 'desktop' : 'browser'} fullscreen fills the viewport and restores on exit`, async ({ page }) => {
    if (native) await page.addInitScript(() => {
      let fullscreen = false, maximized = true;
      const calls: string[] = [];
      Object.assign(window, { fullscreenCalls: calls });
      Object.defineProperty(window, 'isTauri', { value: true });
      Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
        metadata: { currentWindow: { label: 'main' } },
        invoke: async (command: string, args: { value?: boolean }) => {
          if (command === 'plugin:window|is_fullscreen') return fullscreen;
          if (command === 'plugin:window|is_maximized') return maximized;
          if (command === 'plugin:window|unmaximize') { calls.push('unmaximize'); maximized = false; }
          if (command === 'plugin:window|maximize') { calls.push('maximize'); maximized = true; }
          if (command === 'plugin:window|set_fullscreen') { calls.push(`fullscreen:${args.value}`); fullscreen = !!args.value; }
          return null;
        }
      } });
    });
    const pdf = await PDFDocument.create(); pdf.addPage([500, 900]);
    await page.goto('/');
    await page.getByRole('button', { name: 'Read', exact: true }).click();
    await page.getByTestId('pdf-file-input').setInputFiles({ name: 'Fit.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await page.getByRole('button', { name: 'Open Fit', exact: true }).click();
    await expect(page.locator('[data-page-number="1"]')).toHaveAttribute('data-rendered', 'true');
    await page.keyboard.press('f');
    await expect(page.locator('.pdf-viewer')).toHaveClass(/reader-fullscreen/);
    if (native) await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(() => page.evaluate(() => {
      const box = document.querySelector('.pdf-scroller')!.getBoundingClientRect();
      return Math.abs(box.bottom - innerHeight) + Math.abs(box.top) + Math.abs(box.left) + Math.abs(box.right - innerWidth);
    })).toBeLessThan(2);
    if (native) {
      expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual(['unmaximize', 'fullscreen:true']);
      await expect(page.locator('.window-bar')).toBeHidden();
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.pdf-viewer')).not.toHaveClass(/reader-fullscreen/);
    if (native) {
      expect(await page.evaluate(() => (window as any).fullscreenCalls)).toEqual(['unmaximize', 'fullscreen:true', 'fullscreen:false', 'maximize']);
      await expect(page.locator('.window-bar')).toBeVisible();
    }
  });
}
