import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReaderKittyControls from "./ReaderKittyControls";
import { captureSelection } from "../kitty/selectionBridge";
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export default function PageNavigator({
  current,
  count,
  ready,
  onGo,
  selecting,
  onSelectText,
}: {
  current: number;
  count: number;
  ready: boolean;
  onGo: (page: number) => void;
  selecting: boolean;
  onSelectText: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [kittyVisible, setKittyVisible] = useState(false);
  useEffect(() => {
    const visibility = (event: Event) => {
      const visible = (event as CustomEvent<boolean>).detail;
      setKittyVisible(visible);
      setEditing(visible);
    };
    window.addEventListener("minotes:kitty-reader-visibility", visibility);
    return () =>
      window.removeEventListener("minotes:kitty-reader-visibility", visibility);
  }, []);
  const close = () => {
    window.dispatchEvent(new Event("minotes:close-kitty"));
    setKittyVisible(false);
    setEditing(false);
  };
  const toggle = () => {
    if (kittyVisible) {
      close();
      return;
    }
    const selection = captureSelection();
    const layer = document.querySelector(
      `[data-page-number="${current}"] .pdf-text-layer`,
    );
    const pageText = Array.from(layer?.querySelectorAll("span") ?? [])
      .map((span) => span.textContent)
      .join(" ")
      .trim()
      .slice(0, 16000);
    onSelectText();
    window.dispatchEvent(
      new CustomEvent("minotes:open-kitty-chat", {
        detail: selection ?? { text: pageText, context: "", x: 0, y: 0 },
      }),
    );
    setEditing(true);
  };
  const dragged = useRef(false);
  const [position, setPosition] = useState(() => {
    try {
      const p = JSON.parse(
        localStorage.getItem("reader-page-control-position") || "null",
      );
      if (Number.isFinite(p?.x) && Number.isFinite(p?.y))
        return { x: clamp(p.x), y: clamp(p.y) };
    } catch {}
    return { x: 0.5, y: 0 };
  });
  const [size, setSize] = useState({ w: 280, h: 50 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() =>
      setSize({ w: el.offsetWidth, h: el.offsetHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const move = (x: number, y: number) => {
    const next = { x: clamp(x), y: clamp(y) };
    setPosition(next);
    try {
      localStorage.setItem(
        "reader-page-control-position",
        JSON.stringify(next),
      );
    } catch {}
  };
  return (
    <div
      ref={ref}
      role="form"
      className={`reader-page-jump ${editing ? "is-expanded" : ""} ${kittyVisible ? "is-kitty-answer" : ""}`}
      aria-label="Page navigation"
      style={{
        left: `calc(8px + ${position.x * 100}% - ${position.x * (size.w + 16)}px)`,
        top: `calc(12px + ${position.y * 100}% - ${position.y * (size.h + 24)}px)`,
        transform: "none",
      }}
      onKeyDown={(e) => {
        if (
          e.key !== "Enter" ||
          !(e.target instanceof HTMLInputElement) ||
          !e.target.matches(".reader-current-page")
        )
          return;
        e.preventDefault();
        const n = Number(value ?? current);
        if (ready && Number.isInteger(n) && n >= 1 && n <= count) {
          onGo(n);
          setValue(null);
          (document.activeElement as HTMLElement)?.blur();
          close();
        }
      }}
    >
      <div className="reader-island-header">
        <button
          type="button"
          className="reader-page-cat"
          aria-label="Ask Kitty about PDF text"
          aria-expanded={editing}
          title="Kitty — ask about selected text"
          onPointerDown={(e) => e.preventDefault()}
          onClick={toggle}
        >
          <span className="reader-cat-portrait" aria-hidden="true" />
        </button>
        <div
          role="group"
          tabIndex={0}
          className="reader-page-drag"
          aria-label="Page counter"
          title="Click to expand; drag to move"
          onClick={() => {
            if (!dragged.current) setEditing((v) => !v);
          }}
          onDoubleClick={() => setEditing(true)}
          onPointerDown={(e) => {
            if (e.target instanceof HTMLInputElement || e.button !== 0) return;
            dragged.current = false;
            const r = ref.current!.getBoundingClientRect();
            drag.current = { x: e.clientX - r.left, y: e.clientY - r.top };
            e.currentTarget.setPointerCapture(e.pointerId);
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2)
              dragged.current = true;
            if (!dragged.current) return;
            const r = ref.current!.parentElement!.getBoundingClientRect();
            move(
              (e.clientX - r.left - drag.current.x - 8) /
                Math.max(1, r.width - size.w - 16),
              (e.clientY - r.top - drag.current.y - 12) /
                Math.max(1, r.height - size.h - 24),
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onKeyDown={(e) => {
            if (e.target instanceof HTMLInputElement) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setEditing(true);
              return;
            }
            const offsets: Record<string, [number, number]> = {
              ArrowLeft: [-0.04, 0],
              ArrowRight: [0.04, 0],
              ArrowUp: [0, -0.04],
              ArrowDown: [0, 0.04],
            };
            if (offsets[e.key]) {
              e.preventDefault();
              e.stopPropagation();
              move(
                position.x + offsets[e.key][0],
                position.y + offsets[e.key][1],
              );
            }
          }}
        >
          Page{" "}
          <input
            className="reader-current-page"
            aria-label="Current page"
            title="Type a page number and press Enter"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={!ready}
            value={value ?? String(current)}
            style={{
              width: `${Math.max(1, (value ?? String(current)).length)}ch`,
            }}
            onFocus={(e) => {
              setValue(String(current));
              e.currentTarget.select();
            }}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={() => setValue(null)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setValue(null);
                e.currentTarget.blur();
              }
            }}
          />{" "}
          of {count}
        </div>
        <button
          type="button"
          className="reader-page-expand"
          aria-label="Toggle page card"
          aria-expanded={editing}
          onClick={() => {
            if (editing) close();
            else setEditing(true);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
            <path
              d={editing ? "m4 13 6-6 6 6" : "m4 7 6 6 6-6"}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {editing && !kittyVisible && (
        <ReaderKittyControls
          selecting={selecting}
          onSelectText={onSelectText}
          onClose={close}
        />
      )}
      <div data-kitty-reader-host hidden={!editing} />
    </div>
  );
}
