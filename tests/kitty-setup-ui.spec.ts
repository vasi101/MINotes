import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const models = [{ id: 'kitty-light', displayName: 'Kitty Light', description: 'Short answers', sizeBytes: 491400032, model: 'Qwen2.5 0.5B', quantization: 'Q4_K_M', contextSize: 2048, licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF' }, { id: 'kitty-balanced', displayName: 'Kitty Balanced', description: 'Everyday reading', sizeBytes: 1117320736, model: 'Qwen2.5 1.5B', quantization: 'Q4_K_M', contextSize: 4096, licenseUrl: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF' }];
test('first-run setup detects hardware, recommends, installs and shows verified status', async ({ page }) => {
  let installed = false; const methods: string[] = [];
  await page.route('**/api/kitty/**', async route => {
    const method = new URL(route.request().url()).pathname.split('/').pop()!; methods.push(method);
    let result: unknown;
    if (method === 'status') result = { installed: installed ? { ...models[1], backend: 'cuda', path: 'MINOTE/AI/models/kitty-balanced.gguf' } : null, progress: { phase: 'idle' }, partials: [], loaded: false, models };
    if (method === 'hardware') result = { hardware: { ramGB: 16, availableRamGB: 10, cpu: 'Test CPU', cores: 8, architecture: 'x64', os: 'Windows', diskFreeBytes: 30e9, gpus: [{ name: 'RTX 3060', vendor: 'NVIDIA', vramGB: 6 }] }, recommendedId: 'kitty-balanced', compatibleIds: models.map(m => m.id), models, reason: '' };
    if (method === 'install') {
      expect(route.request().postDataJSON().modelId).toBe('kitty-balanced'); installed = true;
      return route.fulfill({ contentType: 'application/x-ndjson', body: [{ event: { phase: 'downloading', completed: 800000000, total: 1117320736 } }, { event: { phase: 'verifying' } }, { event: { phase: 'testing', backend: 'cuda' } }, { event: { phase: 'ready' } }, { result: { installed: true } }].map(v => JSON.stringify(v)).join('\n') });
    }
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ result }) });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set up Kitty', exact: true })).toBeVisible();
  expect(methods).not.toContain('generate'); expect(methods).not.toContain('install');
  await page.getByRole('button', { name: 'Set up Kitty', exact: true }).click();
  await expect(page.getByLabel('Kitty model')).toHaveValue('kitty-balanced');
  await expect(page.getByRole('region', { name: 'Kitty AI setup' })).toContainText('RTX 3060');
  await page.getByRole('button', { name: 'Install Kitty', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Kitty AI setup' })).toContainText('Installed ✓');
  await expect(page.getByRole('region', { name: 'Kitty AI setup' })).toContainText('CUDA acceleration verified');
  expect(methods).not.toContain('generate');
  await page.screenshot({ path: 'test-results/kitty-setup.png' });
});

test('one word, two words and longer selections offer correct nearby menus; answers stay in cat', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let dictionary = 0, ai = 0;
  await page.route('https://freedictionaryapi.com/**', route => { dictionary++; return route.fulfill({ json: { entries: [{ partOfSpeech: 'noun', senses: [{ definition: 'A dictionary meaning.' }] }] } }); });
  await page.route('**/api/kitty/generate', route => { ai++; return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ result: { text: 'A concise explanation.' } }) }); });
  const pdf = await PDFDocument.create(); pdf.addPage([600, 800]).drawText('Diplomacy, foreign policy and national interests.', { x: 60, y: 450, size: 16 });
  await page.goto('/'); await page.getByRole('button', { name: 'Read', exact: true }).click();
  await page.getByTestId('pdf-file-input').setInputFiles({ name: 'Routing.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await page.getByRole('button', { name: 'Open Routing', exact: true }).click();
  const span = page.locator('.pdf-text-layer span').first(); await expect(span).toBeAttached();
  for (const [text, action] of [['Diplomacy,', 'Meaning'], ['foreign policy', 'Meaning'], ['foreign policy and national interests.', 'Explain']]) {
    await span.evaluate((element, text) => {
      const node = element.firstChild!, offset = node.textContent!.indexOf(text); const range = document.createRange();
      range.setStart(node, offset); range.setEnd(node, offset + text.length); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 820, clientY: 510 }));
    }, text);
    const popup = page.getByRole('region', { name: 'Selection menu' }); await expect(popup).toBeVisible();
    await expect(popup).toHaveCSS('margin-top','0px');
    const box = await popup.boundingBox(); expect(Math.abs(box!.x - 820)).toBeLessThan(3); expect(Math.abs(box!.y - 510)).toBeLessThan(3);
    await expect(page.locator('[data-kitty-reader-host] .kitty-popup')).toHaveCount(0);
    await popup.getByRole('button', { name: action, exact: true }).click();
    if (action === 'Explain') {
      await expect(page.locator('[data-kitty-reader-host] .kitty-island')).toContainText('A concise explanation.');
      await page.getByRole('button', { name: 'Close Kitty', exact: true }).click();
    } else {
      await expect(page.getByRole('region', { name: 'Dictionary meaning' })).toContainText(text === 'foreign policy' ? 'Dictionary currently supports individual words.' : 'A dictionary meaning.');
      await page.getByRole('button', { name: 'Close dictionary' }).click();
    }
  }
  expect(dictionary).toBe(1); expect(ai).toBe(1);
});

test('existing Documents model is identified without offering to delete its file', async ({page}) => {
  await page.route('**/api/kitty/status', route => route.fulfill({body:JSON.stringify({result:{installed:{...models[1],displayName:'Qwen3.5 2B',external:true,backend:'automatic',path:'Documents/AI/models/Qwen3.5-2B_Q4_k_m.gguf'},partials:[],models,loaded:false,busy:false}})+'\n'}));
  await page.goto('/'); await page.getByRole('button',{name:'Settings',exact:true}).click();
  const setup=page.getByRole('region',{name:'Kitty AI setup'});
  await expect(setup).toContainText('Using existing file');
  await expect(setup).toContainText('Qwen3.5 2B');
  await expect(setup).toContainText('Ready to load from Documents');
  await expect(setup.getByRole('button',{name:'Remove Local AI'})).toHaveCount(0);
});
