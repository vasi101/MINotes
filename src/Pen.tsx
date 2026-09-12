import {useId} from "react";
export const penNames = [
  "Pencil",
  "Brush",
  "Marker",
  "Fountain pen",
  "Eraser",
] as const;
export default function Pen({ kind, color }: { kind: string; color: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 60 190" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-body`}>
          <stop stopColor="#e1e1df" />
          <stop offset=".23" stopColor="#fff" />
          <stop offset=".58" stopColor="#f6f6f4" />
          <stop offset="1" stopColor="#dcdcdc" />
        </linearGradient>
        <linearGradient id={`${id}-tip`} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor={color} stopOpacity=".15" />
          <stop offset="1" stopColor={color} />
        </linearGradient>
      </defs>
      {kind === "Pencil" ? (
        <>
          <path
            d="M15 190V73L28 7q2-6 4 0l13 66v117"
            fill={`url(#${id}-body)`}
          />
          <path d="m28 7-3 18q5 7 10 0L32 7q-2-6-4 0" fill="#252525" />
          <path
            d="m15 73 7-6 8 8 8-8 7 6M22 68v122m16-122v122"
            fill="none"
            stroke="#e2e2e2"
          />
        </>
      ) : kind === "Brush" ? (
        <>
          <path d="M22 75Q15 45 30 4q15 42 8 71" fill={`url(#${id}-tip)`} />
          <path d="M16 190V75h28v115" fill={`url(#${id}-body)`} />
          <path d="M17 75h26m-26 34h26" stroke="#ccc" strokeWidth="2" />
          <circle cx="30" cy="96" r="2.3" fill="#40b7f4" />
          <rect x="23" y="130" width="14" height="65" rx="7" fill="#eaeae8" />
        </>
      ) : kind === "Marker" ? (
        <>
          <path d="M17 34V17L42 6v28" fill={`url(#${id}-tip)`} stroke={color} />
          <path d="m15 33-3 40h35l-4-40" fill={`url(#${id}-body)`} />
          <path d="M7 190V76h46v114" fill={`url(#${id}-body)`} />
          <path d="M10 75h40" stroke="#b5b5b5" strokeWidth="3" />
          <rect x="22" y="100" width="15" height="85" rx="7.5" fill="#e9e9e9" />
          <circle cx="30" cy="134" r="2.4" fill={color} />
        </>
      ) : kind === "Fountain pen" ? (
        <>
          <path
            d="M29 4Q29 31 18 43l7 34h10l7-34Q31 28 31 4"
            fill={`url(#${id}-body)`}
            stroke="#ccc"
          />
          <path d="M30 10v51" stroke="#b4b4b4" />
          <path d="M30 43v16" stroke={color} strokeWidth="2" />
          <path
            d="M15 190V78q0-3 3-3h24q3 0 3 3v112"
            fill={`url(#${id}-body)`}
          />
          <rect x="27" y="92" width="6" height="95" rx="3" fill={color} />
        </>
      ) : (
        <>
          <rect
            x="1"
            y="4"
            width="58"
            height="190"
            rx="17"
            fill={`url(#${id}-body)`}
            stroke="#eee"
          />
          <rect
            x="5"
            y="28"
            width="50"
            height="165"
            rx="8"
            fill="#e9e9e9"
            opacity=".7"
          />
          <path d="M26 49h4v4h-4zm4 4h4v4h-4zm-4 4h4v4h-4z" fill="#c8c8c8" />
          <path
            d="M21 70h18m-11 7q10 2 1 10t4 10"
            fill="none"
            stroke="#ccc"
            strokeWidth="2"
          />
        </>
      )}
    </svg>
  );
}
