import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import type { Citation, KittyAction, KittyResponse } from "./types";
import KittyControls, { WebSearchToggle } from "./KittyControls";
import { useKittySettings } from "./settings";

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
  ) => void;
  onCopy: () => void;
  onInsert: () => void;
  onReplace: () => void;
  onAddNote: () => void;
};
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
  const settings = useKittySettings();
  const reducedMotion = useReducedMotion();
  const sources = [
    ...new Map(
      [...(response?.webSources ?? []), ...(response?.citations ?? [])].map(
        (source) => [source.url, source],
      ),
    ).values(),
  ];
  const submit = () => {
    if (question.trim() && !busy) {
      props.onAction("ASK", undefined, question);
      setQuestion("");
    }
  };
  const action = (value: KittyAction, button: HTMLButtonElement) => {
    button.closest("details")?.removeAttribute("open");
    props.onAction(value);
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
          <span className="kitty-orb" aria-hidden="true">
            &#10023;
          </span>
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
      <details className="kitty-chat-context">
        <summary>
          {props.selectedText.slice(0, 110) ||
            "No page text available - ask Kitty a question"}
          {props.selectedText.length > 110 ? "..." : ""}
        </summary>
        <p>{props.selectedText}</p>
      </details>
      <div className="kitty-answer-body">
        {props.askedQuestion && (
          <p className="kitty-user-question">{props.askedQuestion}</p>
        )}
        {error ? (
          <div className="kitty-chat-error">
            <p role="alert">{error}</p>
            <button onClick={props.onRetry}>Try again</button>
          </div>
        ) : response ? (
          <>
            {response.type === "TRANSLATION" && (
              <label className="kitty-language-label">
                Translation
                <select
                  aria-label="Translation language"
                  disabled={busy}
                  value={
                    response.translation?.targetLanguage ?? props.targetLanguage
                  }
                  onChange={(e) =>
                    props.onAction("TRANSLATE", e.target.value as "en" | "ne")
                  }
                >
                  <option value="ne">Nepali</option>
                  <option value="en">English</option>
                </select>
              </label>
            )}
            <div
              className={`kitty-answer-text ${response.type === "TRANSLATION" ? "kitty-translated" : ""}`}
            >
              {formattedText(response.primaryText, response.citations)}
            </div>
            {response.searchNotice && (
              <p className="kitty-search-notice">{response.searchNotice}</p>
            )}
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
                <button onClick={props.onCopy} title="Copy answer">
                  Copy
                </button>
                <button
                  onClick={props.onAddNote}
                  title="Save answer as a new note"
                >
                  Save as note
                </button>
                <details className="kitty-more">
                  <summary aria-label="More answer options">More</summary>
                  <div className="kitty-dropdown">
                    {props.canInsert && (
                      <button onClick={props.onInsert}>Insert into note</button>
                    )}
                    {props.canReplace && response.type === "TRANSLATION" && (
                      <button onClick={props.onReplace}>Replace</button>
                    )}
                    <button onClick={props.onRetry}>Regenerate</button>
                  </div>
                </details>
                <span className="kitty-response-source">
                  {response.source === "CLOUD_AI" ? "Cloud" : "On device"}
                </span>
              </footer>
            )}
          </>
        ) : (
          !busy && (
            <p className="kitty-chat-empty">
              What would you like to explore? Ask about the text, or start a
              conversation.
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
          placeholder="Ask about this selection..."
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
          <details className="kitty-more kitty-action-picker">
            <summary aria-label="AI actions">Actions</summary>
            <div className="kitty-dropdown">
              {(["EXPLAIN", "SUMMARIZE", "SIMPLIFY", "TRANSLATE"] as const).map(
                (value) => (
                  <button
                    type="button"
                    disabled={busy}
                    key={value}
                    onClick={(e) => action(value, e.currentTarget)}
                  >
                    {value[0] + value.slice(1).toLowerCase()}
                  </button>
                ),
              )}
            </div>
          </details>
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
        {settings.webSearch && (
          <p className="kitty-search-hint">
            {settings.aiMode === "local"
              ? "Search goes online. Your answer is generated on this device."
              : "Use online sources for questions and explanations."}
          </p>
        )}
      </form>
    </motion.section>
  );
}
