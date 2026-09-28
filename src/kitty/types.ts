export type KittyAction =
  | "DEFINE"
  | "SYNONYMS"
  | "TRANSLATE"
  | "EXPLAIN"
  | "SIMPLIFY"
  | "SUMMARIZE"
  | "ASK";
export type SelectionType =
  | "SINGLE_WORD"
  | "TWO_WORD_PHRASE"
  | "SHORT_PHRASE"
  | "SENTENCE"
  | "PARAGRAPH"
  | "LARGE_SELECTION";
export type Language = "en" | "ne" | "unknown";
export type SelectionAnalysis = {
  selectedText: string;
  normalizedText: string;
  wordCount: number;
  selectionType: SelectionType;
  detectedLanguage: Language;
  containsPunctuation: boolean;
  looksLikeSentence: boolean;
  looksLikePhrase: boolean;
};
export type Definition = {
  text: string;
  partOfSpeech: string;
  example?: string;
};
export type DictionaryStatus =
  | "INVALID_TERM"
  | "FOUND"
  | "NOT_FOUND"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR";
export type DictionaryResult = {
  term: string;
  normalizedTerm: string;
  found: boolean;
  status: DictionaryStatus;
  definitions: Definition[];
  synonyms: string[];
  pronunciation?: string;
  audio?: string;
  examples: string[];
  provider: string;
  attribution?: { url: string; provider: string };
  source: "CACHE" | "LOCAL_DICTIONARY" | "DICTIONARY_API";
};
export interface IDictionaryProvider {
  readonly providerName: string;
  isAvailable(language: Language): boolean;
  lookup(term: string, signal: AbortSignal): Promise<DictionaryResult>;
}
export type WebSource = { title: string; url: string; excerpt: string };
export type Citation = {
  url: string;
  title: string;
  start: number;
  end: number;
};
export type KittyRequest = {
  mode?: "local" | "cloud";
  model?: string;
  webSearch?: boolean;
  text: string;
  action: KittyAction;
  context?: string;
  question?: string;
  previousAnswer?: string;
  webSources?: WebSource[];
  targetLanguage?: "en" | "ne";
  dictionaryDefinition?: string;
};
export type KittyResponse = {
  type:
    | "DICTIONARY"
    | "TRANSLATION"
    | "AI_EXPLANATION"
    | "AI_DEFINITION"
    | "SUMMARY"
    | "QUESTION_ANSWER";
  source: DictionaryResult["source"] | "LOCAL_AI" | "CLOUD_AI";
  model?: string;
  citations?: Citation[];
  webSources?: WebSource[];
  searchProvider?: string;
  searchNotice?: string;
  title: string;
  primaryText: string;
  definitions?: Definition[];
  synonyms?: string[];
  pronunciation?: string;
  audio?: string;
  translation?: {
    sourceLanguage: Language;
    targetLanguage: "en" | "ne";
    provider: string;
  };
  isStreaming: boolean;
  error?: string;
};
export interface ILocalAIProvider {
  generate(
    request: KittyRequest,
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<string>;
}
export interface ITranslationProvider {
  translate(
    text: string,
    source: Language,
    target: "en" | "ne",
    signal: AbortSignal,
    onText: (text: string) => void,
  ): Promise<{ translatedText: string; provider: string; confidence?: number }>;
}
export type KittyUpdate = { status: string; response?: KittyResponse };
