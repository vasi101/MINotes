import type { SelectionAnalysis, SelectionType } from './types.ts';

export function normalizeText(text: string): string {
  let normalized = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  const quotes: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '«': '»' };
  if (normalized.length > 2 && quotes[normalized[0]] === normalized.at(-1)) normalized = normalized.slice(1, -1).trim();
  return normalized;
}
export function analyzeSelection(selectedText: string): SelectionAnalysis {
  const normalizedText = normalizeText(selectedText);
  const words = normalizedText.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’\-‐‑][\p{L}\p{M}\p{N}]+)*/gu) ?? [];
  const wordCount = words.length;
  const looksLikeSentence = wordCount > 2 && /[.!?।]/u.test(normalizedText);
  const looksLikePhrase = wordCount > 1 && wordCount < 12 && !looksLikeSentence;
  const selectionType: SelectionType = wordCount > 120 ? 'LARGE_SELECTION' : wordCount === 1 ? 'SINGLE_WORD' : wordCount === 2 ? 'TWO_WORD_PHRASE' : wordCount > 35 || /\n\s*\n/.test(selectedText) ? 'PARAGRAPH' : looksLikeSentence ? 'SENTENCE' : 'SHORT_PHRASE';
  // Script is a cheap hint, not a claim of reliable language identification.
  const detectedLanguage = /[\u0900-\u097f]/u.test(normalizedText) ? 'ne' : /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{Z}\s]+$/u.test(normalizedText) ? 'en' : 'unknown';
  return { selectedText, normalizedText, wordCount, selectionType, detectedLanguage, containsPunctuation: /\p{P}/u.test(normalizedText), looksLikeSentence, looksLikePhrase };
}
export const SelectionAnalyzer = { analyze: analyzeSelection };

// Clean the dictionary key without changing the user's displayed selection.
export function dictionaryTerm(text: string): string {
  return normalizeText(text).replace(/[\u00ad\u200b\ufeff]/gu, '').replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '').replace(/[\u2019]/g, "'").replace(/[\u2010\u2011]/g, '-').toLocaleLowerCase('en');
}

export function nearbyContext(text: string, selected: string, offset?: number): string {
  const index = offset ?? Math.max(0, text.indexOf(selected));
  return text.slice(Math.max(0, index - 350), Math.min(text.length, index + selected.length + 350)).slice(0, 1200);
}
