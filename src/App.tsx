import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Icon, IconButton } from "./icons";
import { useStore, dateLabel, type Task } from "./store";
import EditorScreen from "./EditorScreen";
import DrawingScreen from "./DrawingScreen";
import FolderHome from "./FolderHome";

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="sheet"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet-heading">
        <h2>{title}</h2>
        <IconButton icon="close" label="Close" onClick={onClose} />
      </div>
      {children}
    </dialog>
  );
}
export default function App() {
  const {
    notes,
    tasks,
    folders,
    theme,
    setTheme,
    addNote,
    updateNote,
    saveTask,
    deleteTask,
  } = useStore();
  const [tab, setTab] = useState<"notes" | "tasks">("notes");
  const [screen, setScreen] = useState<"list" | "editor" | "drawing">("list");
  const [noteId, setNoteId] = useState("");
  const [drawingPosition, setDrawingPosition] = useState<number>();
  const [focusAfterDrawing, setFocusAfterDrawing] = useState(false);
  const [folder, setFolder] = useState("All");
  const [folderHome, setFolderHome] = useState(true);
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<"settings" | "task" | null>(null);
  const [draft, setDraft] = useState<Task | null>(null);

  const [trash, setTrash] = useState(false);
  const [search, setSearch] = useState(false);
  const note = notes.find((n) => n.id === noteId);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const openNote = (id: string) => {
    setFolderHome(false);
    setDrawingPosition(undefined);
    setFocusAfterDrawing(false);
    setNoteId(id);
    setScreen("editor");
  };
  const newTask = () => {
    setDraft({
      id: crypto.randomUUID(),
      title: "",
      completed: false,
      reminder: "",
      repeat: "",
    });
    setPanel("task");
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        openNote(addNote(!folderHome && folder !== "All" ? folder : ""));
      }
      if (
        e.key === "Escape" &&
        screen !== "list" &&
        !document.querySelector("dialog[open]")
      )
        setScreen(screen === "drawing" ? "editor" : "list");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen, addNote, folderHome, folder]);
  const visible = notes
    .filter(
      (n) =>
        Boolean(n.deleted) === trash &&
        (folder === "All" || n.folder === folder) &&
        `${n.title} ${n.preview}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  return (
    <div className={`app ${screen === "drawing" ? "drawing-mode" : ""}`}>
      {isTauri() && (
        <div className="window-bar" data-tauri-drag-region>
          <span data-tauri-drag-region>Mi Notes</span>
          <div>
            <button
              aria-label="Minimize"
              onClick={() => getCurrentWindow().minimize()}
            >
              −
            </button>
            <button
              aria-label="Maximize"
              onClick={() => getCurrentWindow().toggleMaximize()}
            >
              □
            </button>
            <button
              aria-label="Close window"
              onClick={() => getCurrentWindow().close()}
            >
              ×
            </button>
          </div>
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.main
          className="main"
          key={screen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {screen === "list" && (
            <div className="list-screen">
              <header className="topbar">
                {tab === "notes" && !folderHome && !trash && (
                  <div className="home-back">
                    <IconButton
                      icon="back"
                      label="Back to folders"
                      onClick={() => {
                        setFolderHome(true);
                        setSearch(false);
                        setQuery("");
                      }}
                    />
                  </div>
                )}
                <h1>
                  {trash
                    ? "Recently deleted"
                    : tab === "notes"
                      ? !folderHome && folder !== "All"
                        ? folder
                        : "Notes"
                      : "Tasks"}
                </h1>
                <div className="top-actions">
                  {tab === "notes" && (
                    <IconButton
                      icon="folder"
                      label="Folders"
                      onClick={() => {
                        setFolderHome(true);
                        setTrash(false);
                      }}
                    />
                  )}
                  <IconButton
                    icon="settings"
                    label="Settings"
                    onClick={() => setPanel("settings")}
                  />
                </div>
              </header>
              {tab === "notes" && !folderHome && (
                <>
                  <nav className="folder-tabs" aria-label="Note folders">
                    {["All", ...folders].map((f) => (
                      <button
                        key={f}
                        className={folder === f ? "selected" : ""}
                        onClick={() => setFolder(f)}
                      >
                        {f}
                      </button>
                    ))}
                  </nav>
                  {search && (
                    <label className="search">
                      <Icon name="search" />
                      <input
                        autoFocus
                        placeholder="Search notes"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <IconButton
                        icon="close"
                        label="Close search"
                        onClick={() => {
                          setSearch(false);
                          setQuery("");
                        }}
                      />
                    </label>
                  )}
                </>
              )}
              {tab === "notes" && folderHome && !trash ? (
                <FolderHome
                  onOpen={(name) => {
                    setFolder(name);
                    setFolderHome(false);
                    setQuery("");
                    setSearch(false);
                  }}
                />
              ) : (
                <div className={`cards ${tab}`}>
                  {tab === "notes"
                    ? visible.map((n) => (
                        <button
                          className="note-card"
                          key={n.id}
                          onClick={() => openNote(n.id)}
                        >
                          <div>
                            <h2>
                              {n.pinned && <Icon name="pin" size={16} />}{" "}
                              {n.title || "Untitled"}
                            </h2>
                            <p>{n.preview || "No text"}</p>
                            <time>{dateLabel(n.date)}</time>
                          </div>
                          {n.drawingPreview && (
                            <img src={n.drawingPreview} alt="Drawing preview" />
                          )}
                        </button>
                      ))
                    : tasks.map((t) => (
                        <div
                          className={`task-card ${t.completed ? "completed" : ""}`}
                          key={t.id}
                        >
                          <button
                            className="task-checkbox"
                            aria-label={`Complete ${t.title}`}
                            aria-pressed={t.completed}
                            onClick={() =>
                              saveTask({ ...t, completed: !t.completed })
                            }
                          >
                            {t.completed && <Icon name="check" size={16} />}
                          </button>
                          <button
                            className="task-content"
                            onClick={() => {
                              setDraft({ ...t });
                              setPanel("task");
                            }}
                          >
                            <h2>{t.title}</h2>
                            {t.reminder && (
                              <p>
                                {new Date(t.reminder).toLocaleDateString(
                                  "en-US",
                                  { month: "2-digit", day: "2-digit" },
                                )}{" "}
                                {new Date(t.reminder).toLocaleTimeString(
                                  "en-GB",
                                  { hour: "2-digit", minute: "2-digit" },
                                )}
                                {t.repeat ? `, ${t.repeat}` : ""}
                                {new Date(t.reminder) < new Date()
                                  ? " Expired"
                                  : ""}{" "}
                                {t.repeat && <Icon name="repeat" size={14} />}
                              </p>
                            )}
                          </button>
                        </div>
                      ))}
                  {!(tab === "notes" ? visible.length : tasks.length) && (
                    <div className="empty">
                      <Icon name={tab} size={40} />
                      <p>
                        {trash
                          ? "No deleted notes"
                          : tab === "notes"
                            ? "No notes here yet"
                            : "No tasks yet"}
                      </p>
                    </div>
                  )}
                </div>
              )}
              {!trash && (
                <button
                  className="fab"
                  aria-label={tab === "notes" ? "New note" : "New task"}
                  onClick={() =>
                    tab === "notes"
                      ? openNote(
                          addNote(
                            !folderHome && folder !== "All" ? folder : "",
                          ),
                        )
                      : newTask()
                  }
                >
                  <Icon name="plus" size={29} />
                </button>
              )}
              <nav className="bottom-nav" aria-label="Main navigation">
                {(["notes", "tasks"] as const).map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => {
                      setTab(t);
                      setTrash(false);
                      if (t === "notes") setFolderHome(true);
                    }}
                  >
                    <Icon name={t} size={23} />
                    <span>{t === "notes" ? "Notes" : "Tasks"}</span>
                  </button>
                ))}
              </nav>
            </div>
          )}
          {screen === "editor" && note && (
            <EditorScreen
              key={note.id}
              note={note}
              onBack={() => setScreen("list")}
              drawingPosition={drawingPosition}
              focusAfterDrawing={focusAfterDrawing}
              onDraw={(position) => {
                setDrawingPosition(position);
                setFocusAfterDrawing(false);
                setScreen("drawing");
              }}
            />
          )}
          {screen === "drawing" && note && (
            <DrawingScreen
              note={note}
              onDone={() => {
                setFocusAfterDrawing(true);
                setScreen("editor");
              }}
            />
          )}
        </motion.main>
      </AnimatePresence>
      {panel === "settings" && (
        <Sheet title="Settings" onClose={() => setPanel(null)}>
          <label className="setting-row">
            Appearance
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "dark" | "light")}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <button
            className="setting-row"
            onClick={() => {
              setSearch(true);
              setFolderHome(false);
              setFolder("All");
              setTab("notes");
              setPanel(null);
            }}
          >
            Search notes
            <Icon name="search" />
          </button>
          <button
            className="setting-row"
            onClick={() => {
              setTrash(!trash);
              setFolderHome(false);
              setTab("notes");
              setFolder("All");
              setPanel(null);
            }}
          >
            {trash ? "All notes" : "Recently deleted"}
            <Icon name="trash" />
          </button>
          <p className="helper">
            Notes and tasks are saved on this device. Ctrl + N creates a note.
          </p>
        </Sheet>
      )}
      {panel === "task" && draft && (
        <Sheet
          title={
            tasks.some((t) => t.id === draft.id) ? "Edit task" : "New task"
          }
          onClose={() => setPanel(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.title.trim()) {
                saveTask({ ...draft, title: draft.title.trim() });
                setPanel(null);
              }
            }}
          >
            <input
              aria-label="Task title"
              placeholder="What needs to be done?"
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <label className="field">
              Reminder
              <input
                type="datetime-local"
                value={draft.reminder}
                onChange={(e) =>
                  setDraft({ ...draft, reminder: e.target.value })
                }
              />
            </label>
            <label className="field">
              Repeat
              <select
                value={draft.repeat}
                onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
              >
                <option value="">Never</option>
                <option>every day</option>
                <option>every week</option>
                <option>every month</option>
              </select>
            </label>
            <p className="helper">
              Reminder dates are displayed in the task list. Background
              notifications are not enabled.
            </p>
            <div className="form-actions">
              {tasks.some((t) => t.id === draft.id) && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => {
                    deleteTask(draft.id);
                    setPanel(null);
                  }}
                >
                  Delete
                </button>
              )}
              <button className="accent-button" disabled={!draft.title.trim()}>
                Save
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}
