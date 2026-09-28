import { analyzeSelection, normalizeText, dictionaryTerm } from './selection.ts';
import { isTauri, invoke } from '@tauri-apps/api/core';
import type { DictionaryResult, DictionaryStatus, IDictionaryProvider, Language } from './types.ts';

const empty = (term: string, status: DictionaryStatus, provider: string): DictionaryResult => ({ term, normalizedTerm: normalizeText(term), status, found: false, definitions: [], synonyms: [], examples: [], provider, source: 'DICTIONARY_API' });
type Entry = { phonetic?: string; phonetics?: { text?: string; audio?: string }[]; meanings?: { partOfSpeech?: string; synonyms?: string[]; definitions?: { definition?: string; example?: string; synonyms?: string[] }[] }[] };
export class FreeDictionaryProvider implements IDictionaryProvider {
  readonly providerName = 'FreeDictionaryAPI.com';
  isAvailable(language: Language) { return language === 'en'; }
  async lookup(term: string, signal: AbortSignal): Promise<DictionaryResult> {
    let received = false;
    try {
      const response = isTauri()
        ? await invoke<{ status: number; body: string }>('kitty_dictionary', { term }).then(r => new Response(r.body, { status: r.status }))
        : await fetch(`https://freedictionaryapi.com/api/v1/entries/en/${encodeURIComponent(term)}`, { signal });
      signal.throwIfAborted();
      received = true;
      if (!response.ok) return empty(term, response.status === 404 ? 'NOT_FOUND' : response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR', this.providerName);
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.entries)) return empty(term, 'PROVIDER_ERROR', this.providerName);
      type Sense = { definition?: string; examples?: string[]; synonyms?: string[]; subsenses?: Sense[] };
      type RemoteEntry = { partOfSpeech?: string; pronunciations?: { type?: string; text?: string }[]; synonyms?: string[]; senses?: Sense[] };
      const flatten = (senses: Sense[]): Sense[] => senses.flatMap(sense => [sense, ...flatten(sense.subsenses ?? [])]);
      const entries: Entry[] = (payload.entries as RemoteEntry[]).map(entry => ({
        phonetic: entry.pronunciations?.find(p => p.type === 'ipa')?.text,
        meanings: [{ partOfSpeech: entry.partOfSpeech, synonyms: entry.synonyms,
          definitions: flatten(entry.senses ?? []).map(sense => ({ definition: sense.definition, example: sense.examples?.[0], synonyms: sense.synonyms })) }],
      }));
      if (!Array.isArray(entries)) return empty(term, 'PROVIDER_ERROR', this.providerName);
      const meanings = entries.flatMap(e => e.meanings ?? []);
      const definitions = meanings.flatMap(m => (m.definitions ?? []).filter(d => typeof d.definition === 'string').map(d => ({ text: d.definition!, partOfSpeech: m.partOfSpeech ?? '', example: d.example }))).slice(0, 20);
      const phonetics = entries.flatMap(e => e.phonetics ?? []);
      return { ...empty(term, definitions.length ? 'FOUND' : 'NOT_FOUND', this.providerName), found: !!definitions.length, definitions,
        synonyms: [...new Set(meanings.flatMap(m => [...(m.synonyms ?? []), ...(m.definitions ?? []).flatMap(d => d.synonyms ?? [])]).filter(s => typeof s === 'string'))].slice(0, 30),
        pronunciation: entries[0]?.phonetic ?? phonetics.find(p => p.text)?.text,
        audio: phonetics.find(p => p.audio?.startsWith('https://'))?.audio,
        attribution: { url: `https://en.wiktionary.org/wiki/${encodeURIComponent(term)}`, provider: this.providerName },
        examples: definitions.flatMap(d => d.example ? [d.example] : []) };
    } catch (error) {
      if (signal.aborted) throw error;
      return empty(term, received ? 'PROVIDER_ERROR' : 'NETWORK_ERROR', this.providerName);
    }
  }
}
type Cached = { timestamp: number; result: DictionaryResult };
const CACHE_KEY = 'minotes-kitty-dictionary-v1';
const TTL = 90 * 24 * 60 * 60 * 1000;
export class DictionaryService {
  private memory = new Map<string, Cached>();
  private storage?: Pick<Storage, 'getItem' | 'setItem'>;
  constructor(privateProviders: IDictionaryProvider[] = [new FreeDictionaryProvider()], storage?: Pick<Storage, 'getItem' | 'setItem'>, readonly timeoutMs = 8000) {
    this.providers = privateProviders;
    try { this.storage = storage ?? globalThis.localStorage; } catch { /* Private browsing can deny storage. */ }
    try {
      const saved = JSON.parse(this.storage?.getItem(CACHE_KEY) ?? '[]');
      if (Array.isArray(saved)) for (const [key, entry] of saved.slice(-300)) {
        if (typeof key === 'string' && entry?.result?.found && Array.isArray(entry.result.definitions) && entry.result.definitions.every((d: unknown) => !!d && typeof d === 'object' && 'text' in d && typeof d.text === 'string' && 'partOfSpeech' in d && typeof d.partOfSpeech === 'string') && Array.isArray(entry.result.synonyms) && entry.result.synonyms.every((s: unknown) => typeof s === 'string') && Number.isFinite(entry.timestamp)) this.memory.set(key, entry);
      }
    } catch { /* A corrupt cache never prevents a lookup. */ }
  }
  private providers: IDictionaryProvider[];
  private inFlight = new Map<string, Promise<DictionaryResult>>();
  canLookupPhrase(term: string) { const count = analyzeSelection(term).wordCount; return count === 1; }
  private key(term: string) { return dictionaryTerm(term); }
  peek(term: string, allowStale = false): DictionaryResult | undefined {
    const entry = this.memory.get(this.key(term));
    if (entry && (allowStale || Date.now() - entry.timestamp < TTL)) return { ...entry.result, term, source: 'CACHE' };
  }
  async lookup(term: string, signal: AbortSignal): Promise<DictionaryResult> {
    signal.throwIfAborted();
    const key = this.key(term);
    if (!/^[a-z]+(?:['-][a-z]+)*$/i.test(key)) return empty(term, 'INVALID_TERM', 'dictionary');
    const cached = this.peek(key); if (cached) return cached;
    if (globalThis.navigator?.onLine === false) return this.peek(key, true) ?? empty(key, 'NETWORK_ERROR', 'dictionary');
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.fetchResult(key, new AbortController().signal).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    // Each caller can cancel without cancelling another caller's shared request.
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      pending!.then(value => { if (!signal.aborted) resolve(value); }, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  private async fetchResult(term: string, signal: AbortSignal): Promise<DictionaryResult> {
    signal.throwIfAborted();
    const cached = this.peek(term); if (cached) return cached;
    const lookupTerm = dictionaryTerm(term);
    const language = analyzeSelection(lookupTerm).detectedLanguage;
    let result = empty(term, 'NOT_FOUND', 'dictionary');
    for (const provider of this.providers) {
      if (!provider.isAvailable(language)) continue;
      const controller = new AbortController();
      const abort = () => controller.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new DOMException('Lookup timed out', 'TimeoutError')), this.timeoutMs);
      try { result = await provider.lookup(lookupTerm, controller.signal); }
      catch { signal.throwIfAborted(); result = empty(term, 'NETWORK_ERROR', provider.providerName); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
      signal.throwIfAborted();
      if (result.found) {
        this.memory.delete(this.key(term));
        this.memory.set(this.key(term), { result, timestamp: Date.now() });
        while (this.memory.size > 300) this.memory.delete(this.memory.keys().next().value!);
        try { this.storage?.setItem(CACHE_KEY, JSON.stringify([...this.memory])); } catch { /* Keep memory cache if quota is full. */ }
        return result;
      }
    }
    return result.status !== 'NOT_FOUND' ? this.peek(term, true) ?? result : result;
  }
  async getDefinition(term: string, signal: AbortSignal) { return (await this.lookup(term, signal)).definitions; }
  async getSynonyms(term: string, signal: AbortSignal) { return (await this.lookup(term, signal)).synonyms; }
  async getPartOfSpeech(term: string, signal: AbortSignal) { return (await this.lookup(term, signal)).definitions[0]?.partOfSpeech; }
}
