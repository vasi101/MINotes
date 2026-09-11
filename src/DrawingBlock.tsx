import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useStore } from "./store";

function DrawingView({ node, extension, getPos }: NodeViewProps) {
  const preview = useStore(
    (s) =>
      s.notes.find((note) => note.id === node.attrs.noteId)?.drawingPreview,
  );
  return (
    <NodeViewWrapper className="drawing-block" contentEditable={false}>
      <button
        type="button"
        className="drawing-preview"
        aria-label="Edit drawing"
        onClick={() => extension.options.onEdit(getPos())}
      >
        {preview ? <img src={preview} alt="Saved drawing" /> : "Edit drawing"}
      </button>
    </NodeViewWrapper>
  );
}

export const DrawingBlock = Node.create<{
  onEdit: (position: number | undefined) => void;
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
    };
  },
  parseHTML() {
    return [{ tag: "div[data-drawing]" }];
  },
  renderHTML({ node }) {
    return ["div", { "data-drawing": node.attrs.noteId }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawingView);
  },
});
