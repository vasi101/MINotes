import { useState } from "react";
import { useStore } from "../store";
import { Icon, IconButton } from "../icons";
import { Sheet } from "../App";
import { FolderArtwork } from "../FolderHome";

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

export default function ReadFolderHome({
  onOpen,
}: {
  onOpen: (name: string) => void;
}) {
  const {
    readDocuments,
    readFolders,
    readFolderColors,
    addReadFolder,
    customizeReadFolder,
    deleteReadFolder,
  } = useStore();

  const [editing, setEditing] = useState<{
    original: string | null;
    name: string;
    color: string;
  } | null>(null);
  const [error, setError] = useState("");

  const folderColor = (name: string, index: number) =>
    readFolderColors[name] || colors[[0, 3, 13][index % 3]];

  const openForm = (original: string | null, name: string, color: string) => {
    setError("");
    setEditing({ original, name, color });
  };

  return (
    <section className="folder-home" aria-label="Your document folders">
      <div className="folder-home-heading">
        <div>
          <h2>Document folders</h2>
          <p>Organize your textbooks, papers, and notes.</p>
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
            aria-label="All documents"
            onClick={() => onOpen("All")}
          >
            <FolderArtwork color="#dfc28a" />
            <span className="folder-label">All documents</span>
            <span className="folder-count">
              {readDocuments.length} document{readDocuments.length !== 1 ? "s" : ""}
            </span>
          </button>
        </article>

        {readFolders.map((name, index) => {
          const docCount = readDocuments.filter((d) => d.folder === name || (d.folder && d.folder.startsWith(name + '/'))).length;
          const displayLabel = name.includes('/') ? name.replace(/\//g, ' / ') : name;
          return (
            <article className="folder-tile" key={name}>
              <button
                className="folder-open"
                aria-label={`Open folder ${name}`}
                onClick={() => onOpen(name)}
              >
                <FolderArtwork color={folderColor(name, index)} />
                <span className="folder-label">{displayLabel}</span>
                <span className="folder-count">
                  {docCount} document{docCount !== 1 ? "s" : ""}
                </span>
              </button>
              <IconButton
                icon="more"
                label={`Customize ${name}`}
                onClick={() => openForm(name, name, folderColor(name, index))}
              />
            </article>
          );
        })}
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
                name.toLowerCase() === "all documents" ||
                readFolders.some(
                  (f) =>
                    f.toLowerCase() === name.toLowerCase() &&
                    f !== editing.original,
                )
              ) {
                setError("Choose a different folder name.");
                return;
              }
              if (editing.original === null) addReadFolder(name, editing.color);
              else customizeReadFolder(editing.original, name, editing.color);
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
                  className={editing.color === color ? "active" : ""}
                  style={{ background: color }}
                  onClick={() => setEditing({ ...editing, color })}
                />
              ))}
            </fieldset>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="form-actions">
              {editing.original !== null && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    deleteReadFolder(editing.original!);
                    setEditing(null);
                  }}
                >
                  Delete folder
                </button>
              )}
              <button className="accent-button">
                {editing.original === null ? "Create folder" : "Save"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </section>
  );
}
