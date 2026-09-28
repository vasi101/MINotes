import { analyzeSelection } from "./selection.ts";
import { DictionaryService } from "./dictionary.ts";
import {
  searchForSelection,
  sourceCitations,
  type SearchResults,
} from "./webSearch";
import { CloudAIProvider } from "./cloudAI";
import type { Diagnostic } from "./localAI.ts";
import type {
  ILocalAIProvider,
  ITranslationProvider,
  KittyRequest,
  KittyResponse,
  KittyUpdate,
} from "./types.ts";

export class KittyRouter {
  constructor(
    private dictionary: DictionaryService,
    private ai: ILocalAIProvider,
    private translation: ITranslationProvider,
    private diagnostic: Diagnostic = () => {},
    private cloud = new CloudAIProvider(),
  ) {}
  async run(
    request: KittyRequest,
    signal: AbortSignal,
    update: (update: KittyUpdate) => void,
  ): Promise<KittyResponse> {
    const selection = analyzeSelection(request.text);
    if (!selection.wordCount && request.action !== "ASK")
      throw new Error("Select a word or some text first.");
    if (request.text.length > 16000)
      throw new Error("Select a shorter passage (up to 16,000 characters).");
    if (request.action === "ASK" && !request.question?.trim())
      throw new Error("Enter a question about this selection.");
    signal.throwIfAborted();
    const dictionaryFirst = ["DEFINE", "SYNONYMS"].includes(request.action);
    this.diagnostic("route", {
      selectionType: selection.selectionType,
      wordCount: selection.wordCount,
      action: request.action,
      route: dictionaryFirst
        ? "DICTIONARY"
        : request.mode === "cloud"
          ? "CLOUD_AI"
          : request.action === "TRANSLATE"
            ? "TRANSLATION"
            : "LOCAL_AI",
    });
    if (dictionaryFirst) {
      const start = performance.now();
      if (!this.dictionary.peek(selection.normalizedText))
        update({ status: "Looking it up…" });
      const result = await this.dictionary.lookup(
        selection.normalizedText,
        signal,
      );
      signal.throwIfAborted();
      this.diagnostic("dictionary", {
        milliseconds: performance.now() - start,
        status: result.status,
        cache: result.source === "CACHE",
      });
      if (
        result.found &&
        (request.action !== "SYNONYMS" || result.synonyms.length)
      ) {
        return {
          type: "DICTIONARY",
          source: result.source,
          title: selection.normalizedText,
          primaryText:
            request.action === "SYNONYMS"
              ? result.synonyms.join(" · ")
              : result.definitions
                  .slice(0, 3)
                  .map((d) => d.text)
                  .join("\n\n"),
          definitions: result.definitions,
          synonyms: result.synonyms,
          pronunciation: result.pronunciation,
          audio: result.audio,
          isStreaming: false,
        };
      }
      throw new Error(
        result.status === "INVALID_TERM"
          ? "Dictionary currently supports individual words."
          : result.status === "NOT_FOUND"
            ? `No definition found for "${selection.normalizedText}".`
            : "Couldn't retrieve the definition.",
      );
    }
    if (request.mode === "cloud")
      return this.cloud.run(request, signal, update);
    let search: SearchResults | undefined;
    if (request.webSearch && ["ASK", "EXPLAIN"].includes(request.action)) {
      update({ status: "Searching the web..." });
      search = await searchForSelection(request, signal);
      request = { ...request, webSources: search.sources };
    }
    const translated = request.action === "TRANSLATE";
    const target =
      request.targetLanguage ??
      (selection.detectedLanguage === "ne" ? "en" : "ne");
    const response: KittyResponse = {
      type: translated
        ? "TRANSLATION"
        : request.action === "DEFINE" || request.action === "SYNONYMS"
          ? "AI_DEFINITION"
          : request.action === "SUMMARIZE"
            ? "SUMMARY"
            : request.action === "ASK"
              ? "QUESTION_ANSWER"
              : "AI_EXPLANATION",
      source: "LOCAL_AI",
      webSources: search?.sources,
      searchProvider: search?.provider,
      searchNotice: search?.notice,
      title: selection.normalizedText,
      primaryText: "",
      isStreaming: true,
      ...(translated
        ? {
            translation: {
              sourceLanguage: selection.detectedLanguage,
              targetLanguage: target,
              provider: "Local translation",
            },
          }
        : {}),
    };
    const status = translated
      ? "Translating…"
      : request.action === "SUMMARIZE"
        ? "Finding the key points…"
        : request.action === "EXPLAIN"
          ? "Explaining…"
          : "Thinking…";
    update({ status });
    const onText = (text: string) => {
      signal.throwIfAborted();
      update({ status, response: { ...response, primaryText: text } });
    };
    let text: string;
    if (translated) {
      const result = await this.translation.translate(
        request.text.trim(),
        selection.detectedLanguage,
        target,
        signal,
        onText,
      );
      text = result.translatedText;
      response.translation!.provider = result.provider;
    } else
      text = await this.ai.generate(
        { ...request, text: request.text.trim() },
        signal,
        onText,
      );
    signal.throwIfAborted();
    return {
      ...response,
      primaryText: text,
      citations: search ? sourceCitations(text, search.sources) : undefined,
      isStreaming: false,
    };
  }
}

// Latest action wins; closing or changing documents cancels generation and ignores stale results.
export class KittyActionController {
  private active?: AbortController;
  constructor(private router: KittyRouter) {}
  cancel() {
    this.active?.abort();
    this.active = undefined;
  }
  async run(
    request: KittyRequest,
    update: (value: KittyUpdate) => void,
    complete: (response: KittyResponse) => void,
    fail: (message: string) => void,
  ) {
    this.cancel();
    const controller = new AbortController();
    this.active = controller;
    try {
      const result = await this.router.run(
        request,
        controller.signal,
        (value) => {
          if (!controller.signal.aborted) update(value);
        },
      );
      if (!controller.signal.aborted) complete(result);
    } catch (error) {
      if (!controller.signal.aborted)
        fail(
          error instanceof Error
            ? error.message
            : "Kitty could not answer. Try again.",
        );
    }
  }
}
