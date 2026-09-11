import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useRef, useState } from "react";
import { useStore } from "./store";

function DrawingView({ node, extension, getPos, updateAttributes }: NodeViewProps) {
  const note = useStore((s) => s.notes.find((item) => item.id === node.attrs.noteId));
  const updateNote = useStore((s) => s.updateNote);
  const drawing = note?.drawings?.find((item) => item.id === node.attrs.drawingId);
  const preview = drawing?.preview || (node.attrs.drawingId ? undefined : note?.drawingPreview);
  const [selected, setSelected] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const width = node.attrs.displayWidth || drawing?.displayWidth || note?.drawingWidth;
  const saveWidth = (nextWidth: number) => {
    updateAttributes({ displayWidth: nextWidth });
    if (note) {
      if (node.attrs.drawingId && node.attrs.drawingId !== "legacy") {
        updateNote(note.id, {
          drawings: (note.drawings || []).map((item) => item.id === node.attrs.drawingId ? { ...item, displayWidth: nextWidth } : item),
        });
      } else {
        updateNote(note.id, { drawingWidth: nextWidth });
      }
    }
  };
  return (
    <NodeViewWrapper className={`drawing-block ${selected ? "is-selected" : ""}`} contentEditable={false}>
      <div
        className="drawing-preview"
        role="button"
        tabIndex={0}
        aria-label="Edit drawing"
        onClick={() => setSelected(true)}
        onDoubleClick={() => extension.options.onEdit(getPos(), node.attrs.drawingId || "legacy")}
      >
        {preview ? <img src={preview} alt="Saved drawing" style={width ? { width } : undefined} /> : "Edit drawing"}
        {selected && <button
          type="button"
          className="drawing-resize-handle"
          aria-label="Resize drawing"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const image = event.currentTarget.parentElement?.querySelector("img");
            if (!image) return;
            start.current = { x: event.clientX, width: image.getBoundingClientRect().width };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            saveWidth(Math.max(120, Math.round(start.current.width + event.clientX - start.current.x)));
          }}
          onPointerUp={() => { start.current = null; }}
        />}
      </div>
    </NodeViewWrapper>
  );
}

export const DrawingBlock = Node.create<{
  onEdit: (position: number | undefined, drawingId?: string) => void;
}>({
  name: "drawing",
  group: "block",
  atom: true,
  addOptions() {
    return { onEdit: () => {} };
  },
  addAttributes() {
    return {
      noteId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-drawing"),
      },
      drawingId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-drawing-id"),
      },
      displayWidth: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("data-drawing-width")) || null,
        renderHTML: (attributes) => attributes.displayWidth ? { "data-drawing-width": attributes.displayWidth } : {},
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-drawing]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-drawing": node.attrs.noteId, "data-drawing-id": node.attrs.drawingId }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView);
  },
});
