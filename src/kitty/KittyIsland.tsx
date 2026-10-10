import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Citation, KittyAction, KittyResponse } from "./types";
import KittyControls, { WebSearchToggle } from "./KittyControls";

type Props = {
  status: string;
  pending: boolean;
  selectedText: string;
  askedQuestion?: string;
  response?: KittyResponse;
  error: string;
  feedback: string;
  targetLanguage: "en" | "ne";
  canInsert: boolean;
  canReplace: boolean;
  onClose: () => void;
  onRetry: () => void;
  onAction: (
    action: KittyAction,
    language?: "en" | "ne",
    question?: string,
    conversationHistory?: string,
  ) => void;
  onCopy: () => void;
  onInsert: () => void;
  onReplace: () => void;
  onAddNote: () => void;
};
type ChatTurn = { question: string; answer?: string; error?: string };
function citedText(text: string, citations: Citation[] = []) {
  const parts: ReactNode[] = [];
  let position = 0;
  for (const [i, citation] of [...citations]
    .sort((a, b) => a.start - b.start)
    .entries()) {
    if (
      !/^https?:\/\//i.test(citation.url) ||
      citation.start < position ||
      citation.end > text.length ||
      citation.end <= citation.start
    )
      continue;
    parts.push(
      text.slice(position, citation.start),
      <a
        key={i}
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        title={citation.title}
      >
        {text.slice(citation.start, citation.end) || `[${i + 1}]`}
      </a>,
    );
    position = citation.end;
  }
  parts.push(text.slice(position));
  return parts;
}
// Render a deliberately small Markdown subset as React nodes (no raw HTML).
function formattedText(text: string, citations: Citation[] = []) {
  const inline = (value: string, offset: number): ReactNode[] => {
    const render = (part: string, start: number) =>
      citedText(
        part,
        citations
          .filter((c) => c.start >= start && c.end <= start + part.length)
          .map((c) => ({ ...c, start: c.start - start, end: c.end - start })),
      );
    const result: ReactNode[] = [];
    let cursor = 0;
    for (const match of value.matchAll(/\*\*(.+?)\*\*/g)) {
      result.push(...render(value.slice(cursor, match.index), offset + cursor));
      result.push(
        <strong key={offset + match.index}>
          {render(match[1], offset + match.index + 2)}
        </strong>,
      );
      cursor = match.index + match[0].length;
    }
    result.push(...render(value.slice(cursor), offset + cursor));
    return result;
  };
  const blocks: ReactNode[] = [];
  let items: ReactNode[] = [];
  let listType = "";
  let position = 0;
  const flush = () => {
    if (items.length) {
      blocks.push(
        listType === "ol" ? (
          <ol key={blocks.length}>{items}</ol>
        ) : (
          <ul key={blocks.length}>{items}</ul>
        ),
      );
      items = [];
    }
  };
  for (const line of text.split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const item = line.match(/^\s*(?:([-*\u2022])|\d+[.)])\s+(.+)/);
    if (item) {
      const kind = item[1] ? "ul" : "ol";
      if (kind !== listType) flush();
      listType = kind;
      items.push(
        <li key={position}>
          {inline(item[2], position + line.indexOf(item[2]))}
        </li>,
      );
    } else {
      flush();
      if (heading)
        blocks.push(
          <h3 key={position}>
            {inline(heading[1], position + line.indexOf(heading[1]))}
          </h3>,
        );
      else if (line.trim())
        blocks.push(<p key={position}>{inline(line, position)}</p>);
    }
    position += line.length + 1;
  }
  flush();
  return blocks;
}
export default function KittyIsland(props: Props) {
  const { response, error, status, pending: busy } = props;
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const turnsRef = useRef<ChatTurn[]>([]);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const hasPdfContext = !!props.selectedText.trim();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (response || busy) return;
    // Commit the canvas text editor before moving focus into the portal.
    const editor = document.activeElement;
    if (editor instanceof HTMLElement && editor.matches(".excalidraw-wysiwyg"))
      editor.blur();
    const timer = setTimeout(
      () => inputRef.current?.focus({ preventScroll: true }),
      150,
    );
    return () => clearTimeout(timer);
  }, []);
  const reducedMotion = useReducedMotion();
  const saveTurns = (next: ChatTurn[]) => {
    turnsRef.current = next;
    setTurns(next);
  };
  const historyText = () =>
    turnsRef.current
      .slice(-12)
      .map(
        (turn) =>
          `User: ${turn.question}\nKitty: ${turn.answer ?? turn.error ?? ""}`,
      )
      .join("\n\n")
      .slice(-8000);
  useEffect(() => {
    if (activeTurnIndex === null) return;
    if (!props.response?.primaryText && !props.error) return;
    const next = [...turnsRef.current];
    const turn = next[activeTurnIndex];
    if (!turn) return;
    next[activeTurnIndex] = {
      ...turn,
      answer: props.response?.primaryText || turn.answer,
      error: props.error || undefined,
    };
    saveTurns(next);
  }, [activeTurnIndex, props.error, props.response]);
  const sources = [
    ...new Map(
      [...(response?.webSources ?? []), ...(response?.citations ?? [])].map(
        (source) => [source.url, source],
      ),
    ).values(),
  ];
  const submit = () => {
    if (question.trim() && !busy) {
      const asked = question.trim();
      const history = historyText();
      const index = turnsRef.current.length;
      saveTurns([...turnsRef.current, { question: asked }]);
      setActiveTurnIndex(index);
      props.onAction("ASK", undefined, asked, history);
      setQuestion("");
    }
  };
  const action = (value: KittyAction, button: HTMLButtonElement) => {
    button.closest("details")?.removeAttribute("open");
    setActiveTurnIndex(null);
    props.onAction(value, undefined, undefined, historyText());
  };
  return (
    <motion.section
      layout="size"
      transition={{ duration: reducedMotion ? 0 : 0.2 }}
      className="kitty-surface kitty-island kitty-chat is-expanded"
      aria-label="Kitty answer"
      aria-busy={busy}
    >
      <header className="kitty-chat-header">
        <span className="kitty-brand">
          <img className="kitty-orb" src="/reader-kitty-cat.png" alt="" />
          Kitty
        </span>
        <KittyControls
          disabled={busy}
          needsSetup={
            !!error &&
            /connect|api key|set up|model is not available/i.test(error)
          }
        />
        <button
          className="kitty-close"
          aria-label={busy ? "Cancel Kitty" : "Close Kitty"}
          onClick={props.onClose}
        >
          &times;
        </button>
      </header>
      {hasPdfContext ? (
        <details className="kitty-chat-context">
          <summary>
            {props.selectedText.slice(0, 110)}
            {props.selectedText.length > 110 ? "..." : ""}
          </summary>
          <p>{props.selectedText}</p>
        </details>
      ) : null}
      <div className="kitty-answer-body">
        {turns.slice(0, activeTurnIndex ?? turns.length).map((turn, index) => (
          <div className="kitty-chat-turn" key={`${index}-${turn.question}`}>
            <p className="kitty-user-question">{turn.question}</p>
            {turn.answer && (
              <div className="kitty-answer-text">
                {formattedText(turn.answer)}
              </div>
            )}
            {turn.error && <p className="kitty-chat-error">{turn.error}</p>}
          </div>
        ))}
        {props.askedQuestion && (
          <p className="kitty-user-question">{props.askedQuestion}</p>
        )}
        {error ? (
          <div className="kitty-chat-error">
            <p role="alert">{error}</p>
            <button onClick={props.onRetry}>Try again</button>
          </div>
        ) : response ? (
          <div className="kitty-current-answer">
            {response.type === "TRANSLATION" && hasPdfContext && (
              <label className="kitty-language-label">
                Translation
                <select
                  aria-label="Translation language"
                  disabled={busy}
                  value={
                    response.translation?.targetLanguage ?? props.targetLanguage
                  }
                  onChange={(e) =>
                    props.onAction(
                      "TRANSLATE",
                      e.target.value as "en" | "ne",
                      undefined,
                      historyText(),
                    )
                  }
                >
                  <option value="ne">Nepali</option>
                  <option value="en">English</option>
                </select>
              </label>
            )}
            <div className="kitty-response-box">
              <div
                className={`kitty-answer-text ${response.type === "TRANSLATION" ? "kitty-translated" : ""}`}
              >
                {formattedText(response.primaryText, response.citations)}
              </div>
              {response.searchNotice && (
                <p className="kitty-search-notice">{response.searchNotice}</p>
              )}
            </div>
            {!!sources.length && (
              <details className="kitty-sources">
                <summary>
                  {sources.length} sources
                  {response.searchProvider
                    ? ` from ${response.searchProvider}`
                    : ""}
                </summary>
                <div>
                  {sources.map(
                    (source) =>
                      /^https?:\/\//i.test(source.url) && (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {source.title}
                        </a>
                      ),
                  )}
                </div>
              </details>
            )}
            {!busy && (
              <footer className="kitty-answer-tools">
                <button
                  onClick={props.onCopy}
                  title="Copy answer"
                  aria-label="Copy answer"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 20 20"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <rect x="7" y="6" width="10" height="12" rx="2" />
                    <path d="M13 6V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
                  </svg>
                </button>
                <span className="kitty-response-source">
                  {response.source === "CLOUD_AI" ? "Cloud" : "On device"}
                </span>
              </footer>
            )}
          </div>
        ) : (
          !busy && (
            <p className="kitty-chat-empty">
              Ask about this PDF or anything else. Kitty will use the PDF when
              it helps.
            </p>
          )
        )}
        {busy && (
          <p className="kitty-status" role="status">
            <span className="kitty-spinner" aria-hidden="true" />
            {status}
          </p>
        )}
        {props.feedback && (
          <p className="kitty-feedback" role="status">
            {props.feedback}
          </p>
        )}
      </div>
      <form
        className="kitty-composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={inputRef}
          aria-label="Ask Kitty"
          placeholder="Ask Kitty anything..."
          value={question}
          disabled={busy}
          maxLength={2000}
          rows={2}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="kitty-composer-toolbar">
          {(hasPdfContext || !!response) && (
            <details className="kitty-more kitty-action-picker">
              <summary aria-label="More actions" title="More actions">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="4" cy="10" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="16" cy="10" r="1.5" />
                </svg>
              </summary>
              <div className="kitty-dropdown">
                {hasPdfContext && (
                  <>
                    {(
                      ["EXPLAIN", "SUMMARIZE", "SIMPLIFY", "TRANSLATE"] as const
                    ).map((value) => (
                      <button
                        type="button"
                        disabled={busy}
                        key={value}
                        onClick={(e) => action(value, e.currentTarget)}
                      >
                        {value[0] + value.slice(1).toLowerCase()}
                      </button>
                    ))}
                  </>
                )}
                {response && (
                  <>
                    {hasPdfContext && <hr />}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        props.onAddNote();
                      }}
                    >
                      Save as note
                    </button>
                    {props.canInsert && hasPdfContext && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.currentTarget
                            .closest("details")
                            ?.removeAttribute("open");
                          props.onInsert();
                        }}
                      >
                        Insert into note
                      </button>
                    )}
                    {props.canReplace &&
                      hasPdfContext &&
                      response.type === "TRANSLATION" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.currentTarget
                              .closest("details")
                              ?.removeAttribute("open");
                            props.onReplace();
                          }}
                        >
                          Replace text
                        </button>
                      )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                        props.onRetry();
                      }}
                    >
                      Regenerate
                    </button>
                  </>
                )}
              </div>
            </details>
          )}
          <WebSearchToggle disabled={busy} />
          <button
            type="submit"
            className="kitty-send"
            disabled={busy || !question.trim()}
            aria-label="Send question"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M10 16V4m-5 5 5-5 5 5" />
            </svg>
          </button>
        </div>
      </form>
    </motion.section>
  );
}
