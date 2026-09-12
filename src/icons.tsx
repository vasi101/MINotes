import type { ButtonHTMLAttributes } from "react";
const paths: Record<string, string> = {
  read: 'M12 5Q7 1 2 4v16q5-3 10 0 5-3 10 0V4q-5-3-10 1v15',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M16 4v16',
  palette: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h3.5A5.5 5.5 0 0 0 12 3zM7 10h.01M9 6.5h.01M15 6.5h.01M18 10h.01',
  keyboard: 'M3 5h18q1 0 1 1v12q0 1-1 1H3q-1 0-1-1V6q0-1 1-1zm3 4h.01m3 0h.01m3 0h.01m3 0h.01m3 0h.01M6 13h.01m3 0h.01m3 0h.01m3 0h.01M6 16h12',
  select: 'M5 2h5M7.5 2v20M5 22h5M14 2h5m-2.5 0v20M14 22h5',
  eraser: 'm3 13 9-10q1-1 2 0l7 6q1 1 0 2l-9 10H8l-5-5q-1-2 0-3zm4-4 10 9M12 21h10',
  back: "M22 12H3m8-8-8 8 8 8",
  undo: "m10 3-7 7 7 7M3 10h11q8 0 8 11",
  redo: "m14 3 7 7-7 7m7-7h-11q-8 0-8 11",
  settings: "m12 1 9 5v12l-9 5-9-5V6z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  sun: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5z",
  folder: "M2 7V5q0-2 2-2h5l3 3h8q2 0 2 2v11q0 2-2 2H4q-2 0-2-2V7zm0 0h20",
  check: "m3 12 7 8L23 3",
  checkbox: "M6 2h12q4 0 4 4v12q0 4-4 4H6q-4 0-4-4V6q0-4 4-4m1 10 4 4 6-7",
  image:
    "M6 2h12q4 0 4 4v12q0 4-4 4H6q-4 0-4-4V6q0-4 4-4M2 12q7-1 12 10m-5-6q6-7 13-6M8 7h.01",
  draw: "M2 19Q13-1 17 3T12 16q-3 5 4 1t4 4h3",
  format: "m6 1-2 15 14 3 4-14M9 7l5 1M7 20l-1 3h8l1-2",
  map: "M3 5h1m5 0h12M3 12h1m5 0h12M3 19h1m5 0h12",
  share: "M14 3h8v8m0-8L11 14M9 4H5q-3 0-3 3v12q0 3 3 3h13q3 0 3-3v-5",
  more: "M12 3h.01M12 12h.01M12 21h.01",
  plus: "M12 2v20M2 12h20",
  repeat: "M3 9a9 9 0 0 1 16-3l2 3m0-6v6h-6M21 15a9 9 0 0 1-16 3l-2-3m0 6v-6h6",
  focus: "M3 10V3h7m4 18h7v-7M12 12h.01",
  trash: "M3 6h18M9 6V2h6v4M5 6l1 16h12l1-16M10 10v8m4-8v8",
  search: "M16 16l6 6M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  pin: "m8 2 9 3-2 7 3 4-7-2-5 4 1-6 1-10m3 12-5 9",
  close: "m5 5 14 14M5 19 19 5",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z",
  unlock: "M7 10V7a5 5 0 0 1 9-3M5 10h14v11H5z",
  download: "M12 2v14m-6-6 6 6 6-6M3 16v6h18v-6",
  move: "M12 2v20M2 12h20m-14-6 4-4 4 4m0 12-4 4-4-4M6 8l-4 4 4 4m12 0 4-4-4-4",
};
export function Icon({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "notes" ? (
        <>
          <rect
            x="3"
            y="1"
            width="18"
            height="22"
            rx="3"
            fill="currentColor"
            stroke="none"
          />
          <path d="M7 7h10M7 12h10M7 17h7" stroke="var(--bg)" />
        </>
      ) : name === "tasks" ? (
        <>
          <rect
            x="2"
            y="2"
            width="20"
            height="20"
            rx="3"
            fill="currentColor"
            stroke="none"
          />
          <path d="m7 12 4 4 7-9" stroke="var(--bg)" />
        </>
      ) : (
        <path d={paths[name] || paths.more} />
      )}
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}
