import { useRef, useState } from "react";
import Image from "@tiptap/extension-image";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";

function ResizableImageView({ node, updateAttributes }: NodeViewProps) {
  const [selected, setSelected] = useState(false);
  const start = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const width = node.attrs.width as number | null;
  const height = node.attrs.height as number | null;

  return (
    <NodeViewWrapper
      className={`resizable-image ${selected ? "is-selected" : ""}`}
      contentEditable={false}
      onClick={() => setSelected(true)}
    >
      <img
        src={node.attrs.src}
        alt={node.attrs.alt || "Inserted image"}
        style={{ width: width || undefined, height: height || undefined }}
        draggable={false}
      />
      {selected && (
        <button
          type="button"
          className="image-resize-handle"
          aria-label="Resize image"
          onPointerDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const image = event.currentTarget.parentElement?.querySelector("img");
            if (!image) return;
            start.current = {
              x: event.clientX,
              y: event.clientY,
              width: image.getBoundingClientRect().width,
              height: image.getBoundingClientRect().height,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!start.current) return;
            updateAttributes({
              width: Math.max(40, Math.round(start.current.width + event.clientX - start.current.x)),
              height: Math.max(40, Math.round(start.current.height + event.clientY - start.current.y)),
            });
          }}
          onPointerUp={() => {
            start.current = null;
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("width")) || null,
        renderHTML: (attributes) => attributes.width ? { width: attributes.width } : {},
      },
      height: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute("height")) || null,
        renderHTML: (attributes) => attributes.height ? { height: attributes.height } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});
