import { useId, useState } from "react";
import { useStore } from "./store";
import { Icon, IconButton } from "./icons";
import { Sheet } from "./App";

const colors = [
  "#8ce47b",
  "#67b96d",
  "#43834a",
  "#79dedf",
  "#dfc28a",
  "#df8ab7",
  "#bc658d",
  "#b84278",
  "#ede978",
  "#e8c934",
  "#e77c2c",
  "#b8313a",
  "#702d2a",
  "#afa0e9",
  "#715bb4",
];
export function FolderArtwork({ color }: { color: string }) {
  const id = useId();
  return (
    <svg
      className="folder-artwork"
      viewBox="0 0 220 172"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={`${id}-back`}
          x1="0"
          y1="0"
          x2="0"
          y2="172"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={color} />
          <stop offset="1" stopColor={color} />
        </linearGradient>
        <linearGradient
          id={`${id}-front`}
          x1="110"
          y1="24"
          x2="110"
          y2="166"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="white" stopOpacity=".18" />
          <stop offset=".3" stopColor="white" stopOpacity=".02" />
          <stop offset="1" stopColor="black" stopOpacity=".06" />
        </linearGradient>
      </defs>
      <path
        d="M9 15a8 8 0 0 1 8-8h48c6 0 8 3 11 8l5 7c2 3 5 4 9 4h113a8 8 0 0 1 8 8v121a8 8 0 0 1-8 8H17a8 8 0 0 1-8-8Z"
        fill={`url(#${id}-back)`}
      />
      <path
        d="M9 15a8 8 0 0 1 8-8h48c6 0 8 3 11 8l5 7c2 3 5 4 9 4h113"
        stroke="white"
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <rect x="9" y="31" width="202" height="132" rx="7" fill={color} />
      <rect
        x="9"
        y="31"
        width="202"
        height="132"
        rx="7"
        fill={`url(#${id}-front)`}
      />
      <rect
        x="10"
        y="32"
        width="200"
        height="130"
        rx="6"
        stroke="white"
        strokeOpacity=".12"
        strokeWidth="2"
      />
    </svg>
  );
}

export default function FolderHome({
  onOpen,
}: {
  onOpen: (name: string) => void;
}) {
  const { notes, folders, folderColors, addFolder, customizeFolder } =
    useStore();
  const [editing, setEditing] = useState<{
    original: string | null;
    name: string;
    color: string;
  } | null>(null);
  const [error, setError] = useState("");
  const folderColor = (name: string, index: number) =>
    folderColors[name] || colors[[0, 3, 13][index % 3]];
  const openForm = (original: string | null, name: string, color: string) => {
    setError("");
    setEditing({ original, name, color });
  };
  return (
    <section className="folder-home" aria-label="Your folders">
      <div className="folder-home-heading">
        <div>
          <h2>Your folders</h2>
          <p>A place for every thought.</p>
        </div>
        <button
          className="new-folder-button"
          onClick={() => openForm(null, "", colors[0])}
        >
          <Icon name="plus" size={18} />
          New folder
        </button>
      </div>
      <div className="folder-grid">
        <article className="folder-tile">
          <button
            className="folder-open"
            aria-label="All notes"
            onClick={() => onOpen("All")}
          >
            <FolderArtwork color="#dfc28a" />
            <span className="folder-label">All notes</span>
            <span className="folder-count">
              {notes.filter((n) => !n.deleted).length} notes
            </span>
          </button>
        </article>
        {folders.map((name, index) => (
          <article className="folder-tile" key={name}>
            <button
              className="folder-open"
              aria-label={`Open folder ${name}`}
              onClick={() => onOpen(name)}
            >
              <FolderArtwork color={folderColor(name, index)} />
              <span className="folder-label">{name}</span>
              <span className="folder-count">
                {notes.filter((n) => !n.deleted && n.folder === name).length}{" "}
                notes
              </span>
            </button>
            <IconButton
              icon="more"
              label={`Customize ${name}`}
              onClick={() => openForm(name, name, folderColor(name, index))}
            />
          </article>
        ))}
      </div>
      {editing && (
        <Sheet
          title={editing.original === null ? "New folder" : "Customize folder"}
          onClose={() => setEditing(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const name = editing.name.trim();
              if (!name) return;
              if (
                name.toLowerCase() === "all" ||
                name.toLowerCase() === "all notes" ||
                folders.some(
                  (f) =>
                    f.toLowerCase() === name.toLowerCase() &&
                    f !== editing.original,
                )
              ) {
                setError("Choose a different folder name.");
                return;
              }
              if (editing.original === null) addFolder(name, editing.color);
              else customizeFolder(editing.original, name, editing.color);
              setEditing(null);
            }}
          >
            <div className="folder-preview">
              <FolderArtwork color={editing.color} />
            </div>
            <label className="field">
              Folder label
              <input
                autoFocus
                aria-label="Folder label"
                maxLength={80}
                value={editing.name}
                onChange={(e) => {
                  setEditing({ ...editing, name: e.target.value });
                  setError("");
                }}
                required
              />
            </label>
            <fieldset className="folder-colors">
              <legend>Folder color</legend>
              {colors.map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`Folder color ${color}`}
                  aria-pressed={editing.color === color}
                  style={{ background: color }}
                  onClick={() => setEditing({ ...editing, color })}
                >
                  {editing.color === color && <Icon name="check" size={16} />}
                </button>
              ))}
            </fieldset>
            <label className="custom-folder-color">
              Custom color
              <input
                type="color"
                aria-label="Custom folder color"
                value={editing.color}
                onChange={(e) =>
                  setEditing({ ...editing, color: e.target.value })
                }
              />
              <span>{editing.color.toUpperCase()}</span>
            </label>
            {error && (
              <p role="alert" className="danger">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button className="accent-button" disabled={!editing.name.trim()}>
                Save folder
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  );
}
