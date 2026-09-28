import { test, expect } from '@playwright/test';
import { analyzeSelection, normalizeText, nearbyContext } from '../src/kitty/selection';
import { DictionaryService, FreeDictionaryProvider } from '../src/kitty/dictionary';
import { KittyRouter, KittyActionController } from '../src/kitty/router';
import { buildPrompt, ManagedRuntime } from '../src/kitty/localAI';
import type { DictionaryResult, IDictionaryProvider, KittyAction, KittyRequest, KittyResponse } from '../src/kitty/types';

const result = (term: string, status = 'FOUND'): DictionaryResult => ({ term, normalizedTerm: term, found: status === 'FOUND', status: status as DictionaryResult['status'], definitions: status === 'FOUND' ? [{ text: 'A concise meaning.', partOfSpeech: 'noun' }] : [], synonyms: ['example'], examples: [], provider: 'fixture', source: 'DICTIONARY_API' });
const storage = () => { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); } }; };
function harness(status = 'FOUND') {
  const calls = { dictionary: [] as string[], ai: [] as KittyRequest[], translations: [] as string[] };
  const provider: IDictionaryProvider = { providerName: 'fixture', isAvailable: () => true, lookup: async term => { calls.dictionary.push(term); return result(term, status); } };
  const dictionary = new DictionaryService([provider], storage());
  const router = new KittyRouter(dictionary, { generate: async request => { calls.ai.push(request); return 'Local answer'; } }, { translate: async text => { calls.translations.push(text); return { translatedText: 'कूटनीति', provider: 'fixture' }; } });
  const run = (text: string, action: KittyAction = 'DEFINE') => router.run({ text, action, question: 'Why is it important?' }, new AbortController().signal, () => {});
  return { calls, dictionary, router, run };
}

test('normalization preserves meaningful punctuation and Unicode', () => {
  expect(normalizeText('  “diplomacy”  ')).toBe('diplomacy');
  expect(normalizeText('  foreign   policy ')).toBe('foreign policy');
  for (const text of ['state-building', "nation's", 'people’s', 'कूटनीति']) expect(analyzeSelection(text).wordCount).toBe(1);
  expect(analyzeSelection('विदेश नीति')).toMatchObject({ wordCount: 2, detectedLanguage: 'ne', selectionType: 'TWO_WORD_PHRASE' });
  expect(analyzeSelection('diplomacy,')).toMatchObject({ wordCount: 1, containsPunctuation: true });
  expect(analyzeSelection('Foreign policy serves national interest.').selectionType).toBe('SENTENCE');
  expect(analyzeSelection('word '.repeat(121)).selectionType).toBe('LARGE_SELECTION');
  expect(nearbyContext('x'.repeat(5000), 'x', 2500).length).toBeLessThanOrEqual(1200);
});
for (const term of ['diplomacy', 'state', 'constitution', 'sovereignty', 'state-building', "nation's"]) {
  test(`dictionary hit never invokes AI: ${term}`, async () => {
    const h = harness(); const answer = await h.run(term);
    expect(answer.source).toBe('DICTIONARY_API'); expect(h.calls.dictionary).toEqual([term]); expect(h.calls.ai).toHaveLength(0);
    expect((await h.run(term)).source).toBe('CACHE'); expect(h.calls.dictionary).toHaveLength(1);
  });
}
for (const term of ['foreign policy', 'strategic autonomy']) test(`dictionary rejects phrases: ${term}`, async () => {
  const h = harness(); await expect(h.run(term)).rejects.toThrow('individual words'); expect(h.calls.ai).toHaveLength(0); expect(h.calls.dictionary).toHaveLength(0);
});
test('dictionary miss stays a dictionary miss', async () => {
  const h = harness('NOT_FOUND'); await expect(h.run('zzunknown')).rejects.toThrow('No definition found'); expect(h.calls.ai).toHaveLength(0);
});

test('intent overrides word count and long phrases skip dictionary', async () => {
  const h = harness();
  for (const action of ['EXPLAIN', 'ASK', 'SIMPLIFY', 'SUMMARIZE'] as const) await h.run('diplomacy', action);
  await h.run('rule of law', 'EXPLAIN'); await h.run('diplomacy', 'TRANSLATE');
  expect(h.calls.dictionary).toHaveLength(0); expect(h.calls.ai).toHaveLength(5); expect(h.calls.translations).toEqual(['diplomacy']);
});
for (const status of ['NETWORK_ERROR', 'RATE_LIMITED', 'PROVIDER_ERROR']) test(`${status} does not silently invoke AI`, async () => {
  const h = harness(status); await expect(h.run('diplomacy')).rejects.toThrow("Couldn't retrieve"); expect(h.calls.ai).toHaveLength(0);
});
test('missing synonyms does not use AI', async () => {
  const provider: IDictionaryProvider = { providerName: 'fixture', isAvailable: () => true, lookup: async term => ({ ...result(term), synonyms: [] }) };
  let ai = 0;
  const router = new KittyRouter(new DictionaryService([provider], storage()), { generate: async () => { ai++; return 'Synonym'; } }, { translate: async () => { throw Error('unexpected'); } });
  await expect(router.run({ text: 'diplomacy', action: 'SYNONYMS' }, new AbortController().signal, () => {})).rejects.toThrow(); expect(ai).toBe(0);
});
test('persistent dictionary cache works offline and survives denied storage', async () => {
  const saved = storage(); let calls = 0;
  const provider: IDictionaryProvider = { providerName: 'fixture', isAvailable: () => true, lookup: async term => { calls++; return result(term); } };
  await new DictionaryService([provider], saved).lookup('diplomacy', new AbortController().signal);
  expect((await new DictionaryService([], saved).lookup('diplomacy', new AbortController().signal)).source).toBe('CACHE'); expect(calls).toBe(1);
  const denied = { getItem: () => { throw Error(); }, setItem: () => { throw Error(); } };
  expect((await new DictionaryService([provider], denied).lookup('state', new AbortController().signal)).found).toBe(true);
});
test('slow dictionary is aborted and fallback starts promptly', async () => {
  const provider: IDictionaryProvider = { providerName: 'slow', isAvailable: () => true, lookup: async (_term, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))) };
  const service = new DictionaryService([provider], storage(), 30);
  const start = performance.now(); expect((await service.lookup('diplomacy', new AbortController().signal)).status).toBe('NETWORK_ERROR'); expect(performance.now() - start).toBeLessThan(1000);
});
test('cancellation ignores old results and AI failure is contained', async () => {
  let finish: (value: string) => void = () => {};
  const router = new KittyRouter(new DictionaryService([], storage()), { generate: () => new Promise(resolve => { finish = resolve; }) }, { translate: async () => { throw Error('unavailable'); } });
  const controller = new KittyActionController(router); const completed: KittyResponse[] = []; const errors: string[] = [];
  const pending = controller.run({ text: 'diplomacy', action: 'EXPLAIN' }, () => {}, value => completed.push(value), error => errors.push(error));
  controller.cancel(); finish('late answer'); await pending; expect(completed).toHaveLength(0); expect(errors).toHaveLength(0);
  await controller.run({ text: 'diplomacy', action: 'TRANSLATE' }, () => {}, value => completed.push(value), error => errors.push(error)); expect(errors).toEqual(['unavailable']);
});
test('dictionary HTTP statuses are distinct and only the term is sent', async () => {
  const original = globalThis.fetch;
  try {
    for (const [status, expected] of [[404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_ERROR']] as const) {
      globalThis.fetch = async input => { expect(String(input)).toBe('https://freedictionaryapi.com/api/v1/entries/en/foreign%20policy'); return new Response('', { status }); };
      expect((await new FreeDictionaryProvider().lookup('foreign policy', new AbortController().signal)).status).toBe(expected);
    }
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    expect((await new FreeDictionaryProvider().lookup('state', new AbortController().signal)).status).toBe('NETWORK_ERROR');
  } finally { globalThis.fetch = original; }
});
test('AI prompt is narrow and context is bounded', () => {
  const prompt = buildPrompt({ text: 'democratic deficit', action: 'DEFINE', context: 'x'.repeat(5000) });
  expect(prompt.system).toContain('30–100 words'); expect(prompt.system).toContain('Do not invent'); expect(JSON.parse(prompt.prompt).nearbyContext).toHaveLength(1200);
});
test('local runtime handles split stream chunks and reports timing without note content', async () => {
  const original = globalThis.fetch; const diagnostics: unknown[] = [];
  try {
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)); expect(body.keepWarmMinutes).toBe(10); expect(body.requestId).toBeTruthy();
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { for (const part of ['{"ev', 'ent":{"phase":"generating","text":"Hello"}}\n', '{"result":{"text":"Hello world"}}']) c.enqueue(encoder.encode(part)); c.close(); } }));
    };
    const runtime = new ManagedRuntime(() => ({ model: 'fixture', translationModel: '', keepWarmMinutes: 10 }), (event, data) => diagnostics.push({ event, data }));
    expect(await runtime.generate('instruction', 'private text', new AbortController().signal, () => {})).toBe('Hello world');
    expect(JSON.stringify(diagnostics)).not.toContain('private text');
  } finally { globalThis.fetch = original; }
});

test('bounded cache benchmark and stale offline recovery', async ({}, testInfo) => {
  const saved = storage();
  const provider: IDictionaryProvider = { providerName: 'fixture', isAvailable: () => true, lookup: async term => result(term) };
  const dictionary = new DictionaryService([provider], saved);
  const signal = new AbortController().signal;
  for (let i = 0; i < 310; i++) await dictionary.lookup(`word${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}`, signal);
  const serialized = saved.getItem('minotes-kitty-dictionary-v1')!;
  expect(JSON.parse(serialized)).toHaveLength(300); expect(dictionary.peek('wordaa')).toBeUndefined();
  const times = [];
  for (let i = 0; i < 1000; i++) { const start = performance.now(); await dictionary.lookup('wordlx', signal); times.push(performance.now() - start); }
  times.sort((a, b) => a - b);
  const report = { fixture: true, cacheEntries: 300, iterations: 1000, medianMilliseconds: times[500], p95Milliseconds: times[950], serializedCacheBytes: Buffer.byteLength(serialized), aiCalls: 0, note: 'Synthetic dictionary fixtures; serialized bytes are not process RAM. Live inference requires an installed model.' };
  console.log('Kitty cache benchmark', JSON.stringify(report));
  await testInfo.attach('kitty-cache-benchmark', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  const stale = JSON.parse(serialized).map(([key, value]: [string, any]) => [key, { ...value, timestamp: Date.now() - 100 * 86400000 }]);
  saved.setItem('minotes-kitty-dictionary-v1', JSON.stringify(stale));
  const offline: IDictionaryProvider = { ...provider, lookup: async term => result(term, 'NETWORK_ERROR') };
  expect((await new DictionaryService([offline], saved).lookup('wordlx', signal)).source).toBe('CACHE');
});

test('punctuation around PDF words still hits the dictionary without AI', async () => {
  const h = harness();
  await h.run('?Diplomacy,?');
  expect(h.calls.dictionary).toEqual(['diplomacy']); expect(h.calls.ai).toHaveLength(0);
});
