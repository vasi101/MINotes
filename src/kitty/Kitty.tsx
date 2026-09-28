import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DictionaryService } from "./dictionary";
import { dictionaryTerm } from "./selection";
import { captureSelection, type KittySelection } from "./selectionBridge";
import { KittyActionController, KittyRouter } from "./router";
import {
  LocalAIProvider,
  LocalTranslationProvider,
  ManagedRuntime,
} from "./localAI";
import { useKittySettings } from "./settings";
import { useStore } from "../store";
import KittyIsland from "./KittyIsland";

import type { KittyAction, KittyRequest, KittyResponse } from "./types";
import type { DictionaryResult } from "./types";
import "./kitty.css";

// Selection capture remains shared with the canvas and PDF reader.
export default function Kitty({ scope }: { scope: string }) {
  const askOnSelection = useKittySettings((s) => s.askOnSelection);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<KittyResponse>();
  const [aiError, setAiError] = useState("");
  const [aiStatus, setAiStatus] = useState("Thinking...");
  const [pending, setPending] = useState(false);
  const controller = useRef<KittyActionController | undefined>(undefined);
  const lastRequest = useRef<KittyRequest | undefined>(undefined);
  const [selection, setSelection] = useState<KittySelection>();
  const [popup, setPopup] = useState<"menu" | "actions">();
  const [island, setIsland] = useState(false);
  const [response, setResponse] = useState<DictionaryResult>();
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const session = useRef(0);
  const service = useRef<DictionaryService | undefined>(undefined);
  const closeAI = () => {
    controller.current?.cancel();
    setAiOpen(false);
    setPending(false);
    setAiResponse(undefined);
    setAiError("");
  };
  const close = () => {
    closeAI();
    session.current++;
    setIsland(false);
    setPopup(undefined);
    setResponse(undefined);
    setError("");
    setFeedback("");
  };
  useEffect(() => {
    close();
    setSelection(undefined);
    return () => {
      session.current++;
      controller.current?.cancel();
    };
  }, [scope]);
  useEffect(() => {
    const resize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("minotes:kitty-reader-visibility", { detail: aiOpen }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("minotes:kitty-reader-visibility", { detail: false }),
      );
    };
  }, [aiOpen, scope]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const insideKitty = (target: EventTarget | null) =>
      target instanceof Element &&
      !!target.closest(".kitty-surface,.reader-page-jump");
    const show = (
      mode: "menu" | "actions",
      position?: { x: number; y: number },
    ) => {
      const next = captureSelection();
      if (!next) return false;
      closeAI();

      session.current++;
      setIsland(false);
      setResponse(undefined);
      setError("");
      setFeedback("");
      setSelection({ ...next, ...position });
      setPopup(mode);
      return true;
    };
    const context = (event: MouseEvent) => {
      if (insideKitty(event.target)) return;
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".canvas-stage,.pdf-text-layer")
      )
        return;
      clearTimeout(timer);
      if (show("menu", { x: event.clientX, y: event.clientY })) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const selected = (event: Event) => {
      if (!askOnSelection) return;
      if (
        insideKitty(event.target) ||
        (event instanceof MouseEvent && event.button !== 0)
      )
        return;
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".canvas-stage,.pdf-text-layer")
      )
        return;
      if (
        event instanceof KeyboardEvent &&
        ![
          "Shift",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "a",
        ].includes(event.key)
      )
        return;
      clearTimeout(timer);
      // Capture before a PDF highlighter clears the browser selection.
      const next = captureSelection();
      if (next)
        timer = setTimeout(() => {
          closeAI();

          session.current++;
          setIsland(false);
          setSelection(next);
          setPopup("actions");
        }, 120);
    };
    const outside = (event: PointerEvent) => {
      if (!insideKitty(event.target)) {
        clearTimeout(timer);
        close();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearTimeout(timer);
        close();
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        if (show("actions")) event.preventDefault();
      }
    };
    const scroll = (event: Event) => {
      if (!insideKitty(event.target)) {
        clearTimeout(timer);
        close();
      }
    };
    const readerAsk = (event: Event) => {
      const next = (event as CustomEvent<KittySelection>).detail;
      if (
        !next ||
        (event.type !== "minotes:open-kitty-chat" && !next.text?.trim())
      )
        return;
      clearTimeout(timer);
      closeAI();

      session.current++;
      setIsland(false);
      setResponse(undefined);
      setError("");
      setFeedback("");
      setSelection(next);
      if (event.type === "minotes:open-kitty-chat") {
        setPopup(undefined);
        setAiOpen(true);
        lastRequest.current = undefined;
      } else setPopup("actions");
    };
    window.addEventListener("minotes:open-kitty-chat", readerAsk);
    window.addEventListener("minotes:ask-kitty", readerAsk);
    window.addEventListener("minotes:close-kitty", close);
    document.addEventListener("contextmenu", context, true);
    document.addEventListener("pointerup", selected, true);
    document.addEventListener("keyup", selected, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("minotes:close-kitty", close);
      window.removeEventListener("minotes:ask-kitty", readerAsk);
      window.removeEventListener("minotes:open-kitty-chat", readerAsk);
      document.removeEventListener("contextmenu", context, true);
      document.removeEventListener("pointerup", selected, true);
      document.removeEventListener("keyup", selected, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [scope, askOnSelection]);

  const run = async () => {
    if (!selection) return;
    closeAI();
    const current = ++session.current;
    setPopup(undefined);
    setIsland(true);
    setResponse(undefined);
    setError("");
    setFeedback("");
    service.current ??= new DictionaryService();
    try {
      const result =
        service.current.peek(selection.text) ??
        (await service.current.lookup(
          selection.text,
          new AbortController().signal,
        ));
      if (session.current !== current) return;
      if (result.found) setResponse(result);
      else
        setError(
          result.status === "INVALID_TERM"
            ? "Dictionary currently supports individual words."
            : result.status === "NOT_FOUND"
              ? `No definition found for "${dictionaryTerm(selection.text)}".`
              : navigator.onLine === false
                ? "Dictionary unavailable while offline."
                : "Couldn't retrieve the definition.",
        );
    } catch {
      if (session.current === current)
        setError("Couldn't retrieve the definition.");
    }
  };
  const runAI = (
    action: KittyAction,
    language?: "en" | "ne",
    asked?: string,
    previousAnswer?: string,
  ) => {
    if (!selection) return;
    service.current ??= new DictionaryService();
    if (!controller.current) {
      const runtime = new ManagedRuntime(useKittySettings.getState);
      controller.current = new KittyActionController(
        new KittyRouter(
          service.current,
          new LocalAIProvider(runtime),
          new LocalTranslationProvider(runtime),
        ),
      );
    }
    const settings = useKittySettings.getState();
    const next: KittyRequest = {
      text: selection.text,
      context: selection.context,
      action,
      question: asked,
      previousAnswer:
        action === "ASK"
          ? (previousAnswer ?? aiResponse?.primaryText)
          : undefined,
      targetLanguage: language ?? settings.targetLanguage,
      mode: settings.aiMode,
      model: settings.cloudModel,
      webSearch: settings.webSearch,
    };
    lastRequest.current = next;
    session.current++;
    setPopup(undefined);
    setIsland(false);
    setAiOpen(true);
    setPending(true);
    setAiResponse(undefined);
    setAiError("");
    setFeedback("");
    setAiStatus(
      action === "TRANSLATE"
        ? "Translating..."
        : action === "SUMMARIZE"
          ? "Finding the key points..."
          : "Thinking...",
    );
    void controller.current.run(
      next,
      (update) => {
        setAiStatus(update.status);
        if (update.response) setAiResponse(update.response);
      },
      (response) => {
        setAiResponse(response);
        setPending(false);
      },
      (message) => {
        setAiError(message);
        setPending(false);
      },
    );
  };
  const openAsk = () => {
    closeAI();
    session.current++;
    setPopup(undefined);
    setIsland(false);
    setAiOpen(true);
    setFeedback("");
    lastRequest.current = undefined;
  };
  const perform = async (action: () => Promise<void>, message: string) => {
    const current = session.current;
    try {
      await action();
      if (session.current === current) setFeedback(message);
    } catch (error) {
      if (session.current === current)
        setFeedback(
          error instanceof Error
            ? error.message
            : "Could not complete this action.",
        );
    }
  };
  const answer = aiResponse?.primaryText ?? "";
  const sourceUrls = [
    ...new Set([
      ...(aiResponse?.citations?.map((c) => c.url) ?? []),
      ...(aiResponse?.webSources?.map((s) => s.url) ?? []),
    ]),
  ];
  const answerWithSources =
    answer +
    (sourceUrls.length ? "\n\nSources:\n" + sourceUrls.join("\n") : "");
  const addNote = async () => {
    const [{ convertToExcalidrawElements }, { saveScene }] = await Promise.all([
      import("@excalidraw/excalidraw"),
      import("../canvas/storage"),
    ]);
    const id = crypto.randomUUID();
    const elements = convertToExcalidrawElements([
      {
        type: "text",
        text: `${aiResponse?.title ?? "Kitty"}\n\n${answerWithSources}`,
        x: 80,
        y: 80,
        width: 600,
        autoResize: false,
        fontSize: 20,
      },
    ]);
    await saveScene(id, { version: 1, elements, appState: {}, files: {} });
    useStore.setState((state) => ({
      notes: [
        {
          id,
          title: aiResponse?.title.slice(0, 80) ?? "Kitty",
          html: "",
          preview: answerWithSources.slice(0, 1000),
          folder: "",
          date: new Date().toISOString(),
          editor: "excalidraw",
          canvasEmpty: false,
        },
        ...state.notes,
      ],
    }));
  };
  const word = selection ? dictionaryTerm(selection.text) : "";
  const copy = async () => {
    if (!response) return;
    const current = session.current;
    const text = [
      word,
      response.pronunciation,
      ...response.definitions.map(
        (d, i) =>
          `${d.partOfSpeech}\n${i + 1}. ${d.text}${d.example ? `\nExample: ${d.example}` : ""}`,
      ),
      response.synonyms.length
        ? `Synonyms: ${response.synonyms.join(" \u00b7 ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      if (session.current === current) setFeedback("Copied");
    } catch {
      if (session.current === current)
        setFeedback(
          "Could not copy. Select the definition to copy it manually.",
        );
    }
  };
  const panelHeight = Math.min(380, viewport.height * 0.5);
  const position = {
    left: Math.max(
      12,
      Math.min(selection?.x ?? 12, viewport.width - (island ? 344 : 252)),
    ),
    top: Math.max(
      12,
      Math.min(
        selection?.y ?? 12,
        viewport.height -
          (island ? panelHeight : Math.min(360, viewport.height - 24)) -
          12,
      ),
    ),
  };
  return (
    <>
      {createPortal(
        <>
          {popup && selection && (
            <section
              className="kitty-surface kitty-popup kitty-selection-menu"
              aria-label="Selection menu"
              style={position}
            >
              <header className="kitty-menu-heading">
                <span title={selection.text}>
                  {selection.text.slice(0, 80)}
                </span>
                <button
                  className="kitty-close"
                  aria-label="Close Kitty actions"
                  onClick={close}
                >
                  &times;
                </button>
              </header>
              <div
                className="kitty-action-list"
                onPointerDown={(e) => e.preventDefault()}
              >
                <button onClick={() => void run()}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    Aa
                  </span>
                  <span>Meaning</span>
                </button>
                <button onClick={() => runAI("EXPLAIN")}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    ?
                  </span>
                  <span>Explain</span>
                </button>
                <button onClick={() => runAI("SUMMARIZE")}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    &#8801;
                  </span>
                  <span>Summarize</span>
                </button>
                <button onClick={() => runAI("SIMPLIFY")}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    &#8722;
                  </span>
                  <span>Simplify</span>
                </button>
                <button onClick={() => runAI("TRANSLATE")}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    A&#8644;
                  </span>
                  <span>Translate</span>
                </button>
                <button className="kitty-ask-action" onClick={openAsk}>
                  <span aria-hidden="true" className="kitty-action-symbol">
                    &#10023;
                  </span>
                  <span>Ask AI</span>
                  <span aria-hidden="true" className="kitty-action-arrow">
                    &#8599;
                  </span>
                </button>
              </div>
            </section>
          )}
          {island && selection && (
            <section
              className="kitty-surface dictionary-panel"
              role="region"
              aria-label="Dictionary meaning"
              style={position}
            >
              <header>
                <strong>{word}</strong>
                <button
                  className="kitty-close"
                  aria-label="Close dictionary"
                  onClick={close}
                >
                  &times;
                </button>
              </header>
              <div className="dictionary-content">
                {!response && !error && <p role="status">Looking up...</p>}
                {error && (
                  <>
                    <p role="alert">{error}</p>
                    {!error.startsWith("Dictionary currently") &&
                      !error.startsWith("No definition") && (
                        <button onClick={() => void run()}>Retry</button>
                      )}
                  </>
                )}
                {response && (
                  <>
                    {response.pronunciation && <p>{response.pronunciation}</p>}
                    {[
                      ...new Set(
                        response.definitions.map((d) => d.partOfSpeech),
                      ),
                    ].map((part) => (
                      <div key={part}>
                        <em>{part}</em>
                        <ol>
                          {response.definitions
                            .filter((d) => d.partOfSpeech === part)
                            .map((d, i) => (
                              <li key={i}>
                                {d.text}
                                {d.example && (
                                  <p className="dictionary-example">
                                    Example: &ldquo;{d.example}&rdquo;
                                  </p>
                                )}
                              </li>
                            ))}
                        </ol>
                      </div>
                    ))}
                    {response.attribution && (
                      <p className="dictionary-attribution">
                        <a
                          href={response.attribution.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Wiktionary
                        </a>{" "}
                        via{" "}
                        <a
                          href="https://freedictionaryapi.com"
                          target="_blank"
                          rel="noreferrer"
                        >
                          FreeDictionaryAPI.com
                        </a>{" "}
                        &middot;{" "}
                        <a
                          href="https://creativecommons.org/licenses/by-sa/4.0/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          CC BY-SA 4.0
                        </a>
                      </p>
                    )}
                    {!!response.synonyms.length && (
                      <p>
                        <strong>Synonyms</strong>
                        <br />
                        {response.synonyms.join(" \u00b7 ")}
                      </p>
                    )}
                  </>
                )}
              </div>
              {response && (
                <footer>
                  <span role="status">{feedback}</span>
                  <button onClick={() => void copy()}>Copy</button>
                </footer>
              )}
            </section>
          )}
        </>,
        document.fullscreenElement ?? document.body,
      )}
      {createPortal(
        aiOpen && (
          <KittyIsland
            status={aiStatus}
            pending={pending}
            selectedText={selection?.text ?? ""}
            askedQuestion={lastRequest.current?.question}
            response={aiResponse}
            error={aiError}
            feedback={feedback}
            targetLanguage={lastRequest.current?.targetLanguage ?? "ne"}
            canInsert={!!selection?.insert}
            canReplace={!!selection?.replace}
            onClose={close}
            onRetry={() => {
              const request = lastRequest.current;
              if (request)
                runAI(
                  request.action,
                  request.targetLanguage,
                  request.question,
                  request.previousAnswer,
                );
            }}
            onAction={runAI}
            onCopy={() =>
              void perform(
                () => navigator.clipboard.writeText(answerWithSources),
                "Copied",
              )
            }
            onInsert={() =>
              void perform(
                () => selection!.insert!(answerWithSources),
                "Inserted into your note",
              )
            }
            onReplace={() =>
              void perform(
                () => selection!.replace!(answer),
                "Replaced selected text",
              )
            }
            onAddNote={() => void perform(addNote, "Saved as a new note")}
          />
        ),
        document.querySelector("[data-kitty-reader-host]") ??
          document.fullscreenElement ??
          document.body,
      )}
    </>
  );
}
