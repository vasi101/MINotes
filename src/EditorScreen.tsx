import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import { Icon, IconButton } from "./icons";
import { useStore, dateLabel, type Note } from "./store";
import { Sheet } from "./App";
import { DrawingBlock } from "./DrawingBlock";
export default function EditorScreen({
  note,
  onBack,
  onDraw,
  drawingPosition,
  focusAfterDrawing,
}: {
  note: Note;
  onBack: () => void;
  onDraw: (position?: number) => void;
  drawingPosition?: number;
  focusAfterDrawing?: boolean;
}) {
  const { updateNote, folders } = useStore();
  const [panel, setPanel] = useState<"format" | "more" | "map" | null>(null);
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const save = (patch: Partial<Note>) =>
    updateNote(note.id, { ...patch, date: new Date().toISOString() });
  const addImage = (f: File) => {
    if (!f.type.startsWith("image/")) return;
    if (f.size > 3 * 1024 * 1024) {
      setError("Choose an image smaller than 3 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      editor
        ?.chain()
        .focus()
        .setImage({ src: String(reader.result) })
        .run();
    reader.readAsDataURL(f);
  };
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      FontSize,
      DrawingBlock.configure({ onEdit: onDraw }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: "Start typing" }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: note.html,
    onUpdate: ({ editor }) =>
      save({ html: editor.getHTML(), preview: editor.getText() }),
    onTransaction: () => refresh((n) => n + 1),
    editorProps: {
      attributes: { "aria-label": "Note content" },
      handlePaste: (_view, event) => {
        const f = Array.from(event.clipboardData?.files || []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (f) {
          addImage(f);
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const f = Array.from(event.dataTransfer?.files || []).find((f) =>
          f.type.startsWith("image/"),
        );
        if (f) {
          event.preventDefault();
          addImage(f);
          return true;
        }
        return false;
      },
    },
  });
  const drawingRestored = useRef(false);
  useEffect(() => {
    if (!editor || drawingRestored.current) return;
    drawingRestored.current = true;
    if (!note.drawingPreview) return;
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "drawing" && node.attrs.noteId === note.id)
        position = pos;
    });
    if (
      position === undefined &&
      (focusAfterDrawing || !note.drawingEmbedded)
    ) {
      const insertion = Math.max(
        0,
        Math.min(
          drawingPosition ?? editor.state.doc.content.size,
          editor.state.doc.content.size,
        ),
      );
      editor
        .chain()
        .insertContentAt(insertion, [
          { type: "drawing", attrs: { noteId: note.id } },
          { type: "paragraph" },
        ])
        .run();
      updateNote(note.id, { drawingEmbedded: true });
      if (focusAfterDrawing) editor.commands.focus();
    } else if (position !== undefined && focusAfterDrawing) {
      const after = position + editor.state.doc.nodeAt(position)!.nodeSize;
      if (editor.state.doc.nodeAt(after)?.type.name !== "paragraph") {
        editor.commands.insertContentAt(after, { type: "paragraph" });
      }
      editor
        .chain()
        .setTextSelection(after + 1)
        .focus()
        .run();
    }
  }, [
    editor,
    note.id,
    note.drawingPreview,
    note.drawingEmbedded,
    drawingPosition,
    focusAfterDrawing,
    updateNote,
  ]);
  const fontSize =
    Number.parseFloat(editor?.getAttributes("textStyle").fontSize) || 17;
  const changeFontSize = (delta: number) => {
    editor
      ?.chain()
      .focus(undefined, { scrollIntoView: false })
      .setFontSize(`${Math.max(13, Math.min(35, fontSize + delta))}px`)
      .run();
  };
  const exportNote = () => {
    const blob = new Blob([note.title + "\n\n" + (editor?.getText() || "")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (note.title || "Untitled") + ".txt";
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="editor-screen">
      <header className="editor-topbar">
        <IconButton icon="back" label="Back to notes" onClick={onBack} />
        <div>
          <IconButton
            icon="undo"
            label="Undo"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          />
          <IconButton
            icon="redo"
            label="Redo"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          />
          <IconButton
            icon="more"
            label="Note options"
            onClick={() => setPanel("more")}
          />
        </div>
      </header>
      <div className="editor-body">
        {note.folder && (
          <button className="folder-badge" onClick={() => setPanel("more")}>
            <Icon name="folder" size={15} />
            {note.folder}
          </button>
        )}
        <input
          className="note-title"
          aria-label="Note title"
          placeholder="Title"
          value={note.title}
          onChange={(e) => save({ title: e.target.value })}
        />
        <div className="metadata">
          {dateLabel(note.date)} <span>|</span> {editor?.getText().length || 0}{" "}
          characters
        </div>
        <div className="writing-area">
          <EditorContent editor={editor} />
          {editor?.isEmpty && (
            <button className="mind-map-button" onClick={() => setPanel("map")}>
              <Icon name="map" size={15} />
              Create a mind map
            </button>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      <div
        className="editor-toolbar"
        role="toolbar"
        aria-label="Note formatting"
      >
        <IconButton
          icon="image"
          label="Insert image"
          onClick={() => file.current?.click()}
        />
        <IconButton
          icon="draw"
          label="Draw"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onDraw(editor?.state.selection.from)}
        />
        <IconButton
          icon="checkbox"
          label="Checklist"
          aria-pressed={editor?.isActive("taskList")}
          onClick={() => editor?.chain().focus().toggleTaskList().run()}
        />
        <IconButton
          icon="format"
          label="Formatting"
          onClick={() => setPanel("format")}
        />
        <button
          aria-label="Increase text size"
          type="button"
          disabled={!editor || fontSize >= 35}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeFontSize(2)}
        >
          A<sup>+</sup>
        </button>
        <button
          aria-label="Decrease text size"
          type="button"
          disabled={!editor || fontSize <= 13}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => changeFontSize(-2)}
        >
          A<sup>−</sup>
        </button>
        <button
          aria-label="Bold"
          aria-pressed={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          B
        </button>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) addImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {panel === "format" && (
        <Sheet title="Formatting" onClose={() => setPanel(null)}>
          <div className="format-grid">
            {[
              [
                "Heading",
                () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              ],
              ["Italic", () => editor?.chain().focus().toggleItalic().run()],
              [
                "Underline",
                () => editor?.chain().focus().toggleUnderline().run(),
              ],
              ["Strike", () => editor?.chain().focus().toggleStrike().run()],
              [
                "Bullet list",
                () => editor?.chain().focus().toggleBulletList().run(),
              ],
              [
                "Numbered list",
                () => editor?.chain().focus().toggleOrderedList().run(),
              ],
              ["Quote", () => editor?.chain().focus().toggleBlockquote().run()],
              [
                "Clear",
                () =>
                  editor?.chain().focus().clearNodes().unsetAllMarks().run(),
              ],
            ].map(([label, action]) => (
              <button
                key={String(label)}
                onClick={() => {
                  (action as () => void)();
                  setPanel(null);
                }}
              >
                {String(label)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {panel === "more" && (
        <Sheet title="Note options" onClose={() => setPanel(null)}>
          <label className="setting-row">
            Folder
            <select
              value={note.folder}
              onChange={(e) => save({ folder: e.target.value })}
            >
              <option value="">None</option>
              {folders.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <button
            className="setting-row"
            onClick={() => {
              save({ pinned: !note.pinned });
              setPanel(null);
            }}
          >
            {note.pinned ? "Unpin" : "Pin note"}
            <Icon name="pin" />
          </button>
          <button className="setting-row" onClick={exportNote}>
            Export text
            <Icon name="share" />
          </button>
          <button className="setting-row" onClick={() => window.print()}>
            Print / Save as PDF
            <Icon name="download" />
          </button>
          <button
            className="setting-row danger"
            onClick={() => {
              save({ deleted: !note.deleted });
              setPanel(null);
              onBack();
            }}
          >
            {note.deleted ? "Restore note" : "Move to recently deleted"}
            <Icon name="trash" />
          </button>
        </Sheet>
      )}
      {panel === "map" && (
        <Sheet title="Create a mind map" onClose={() => setPanel(null)}>
          <p className="helper">Add an outline to organize this note.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              editor
                ?.chain()
                .focus()
                .insertContent([
                  {
                    type: "heading",
                    attrs: { level: 2 },
                    content: [
                      { type: "text", text: String(data.get("topic")) },
                    ],
                  },
                  {
                    type: "bulletList",
                    content: String(data.get("branches"))
                      .split("\n")
                      .filter(Boolean)
                      .map((text) => ({
                        type: "listItem",
                        content: [
                          {
                            type: "paragraph",
                            content: [{ type: "text", text }],
                          },
                        ],
                      })),
                  },
                ])
                .run();
              setPanel(null);
            }}
          >
            <input
              name="topic"
              aria-label="Central topic"
              placeholder="Central topic"
              required
            />
            <textarea
              name="branches"
              aria-label="Branches"
              placeholder="One branch per line"
              required
            />
            <button className="accent-button">Insert outline</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}
