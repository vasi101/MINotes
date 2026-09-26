import { test, expect } from '@playwright/test';

test('PDF.js fallback decoders load as standalone modules in a worker', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const source = `onmessage = async ({data}) => {
      try {
        const results = [];
        for (const name of ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
          const decoder = await import(data + '/pdfjs/wasm/' + name + '?import');
          const instance = await decoder.default();
          results.push(typeof instance._malloc);
        }
        postMessage({results});
      } catch(error) { postMessage({error: String(error)}); }
    };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    try {
      return await new Promise<{ results?: string[]; error?: string }>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('Decoder worker timed out')), 15000);
        worker.onmessage = event => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
        worker.postMessage(location.origin);
      });
    } finally { worker.terminate(); URL.revokeObjectURL(url); }
  });
  expect(result.error).toBeUndefined();
  expect(result.results).toEqual(['function', 'function']);
});
