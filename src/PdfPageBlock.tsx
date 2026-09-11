import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Node,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from '@tiptap/react';
import { loadPdf } from './reader/pdf';
import { getPdfFile } from './reader/storage';
import { useStore } from './store';
import { Icon } from './icons';

function PdfPageView({ node, updateAttributes, selected, extension }: NodeViewProps) {
  const { documentId, pageNum, width = 480 } = node.attrs;
  const readDocs = useStore(s => s.readDocuments);
  const docMeta = readDocs.find(d => d.id === documentId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState(1.414); // standard A4 ratio default
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(width);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any = null;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const bytes = await getPdfFile(documentId);
        if (!bytes || cancelled) {
          if (!cancelled) setError('PDF file not found.');
          return;
        }
        const task = loadPdf(bytes);
        const pdfDoc = await task.promise;
        if (cancelled) { await task.destroy(); return; }
        const page = await pdfDoc.getPage(pageNum || 1);
        const baseVp = page.getViewport({ scale: 1 });
        const ratio = baseVp.height / baseVp.width;
        setAspect(ratio);

        const targetW = width || 480;
        const scale = targetW / baseVp.width;
        const vp = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) { await task.destroy(); return; }
        canvas.width = vp.width;
        canvas.height = vp.height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, vp.width, vp.height);

        renderTask = page.render({ canvas, canvasContext: ctx, viewport: vp });
        await renderTask.promise;
        await task.destroy();
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message || 'Failed to render PDF page.');
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [documentId, pageNum, width]);

  /* ── resize handle ── */
  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isResizing.current = true;
    startX.current = e.clientX;
    startW.current = width || 480;

    const onPointerMove = (ev: PointerEvent) => {
      if (!isResizing.current) return;
      const dx = ev.clientX - startX.current;
      const newWidth = Math.max(200, Math.min(840, Math.round(startW.current + dx)));
      updateAttributes({ width: newWidth });
    };

    const onPointerUp = () => {
      isResizing.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }, [width, updateAttributes]);

  const onDoubleClick = () => {
    extension.options.onOpenReader?.(documentId, pageNum);
  };

  return (
    <NodeViewWrapper className={`pdf-page-block ${selected ? 'selected' : ''}`} contentEditable={false}>
      <div
        className="pdf-page-block-inner"
        style={{ width: width || 480 }}
        onDoubleClick={onDoubleClick}
        title="Double-click to open in Reader"
      >
        <div className="pdf-page-block-badge">
          <Icon name="read" size={14} />
          <span>{docMeta ? docMeta.name : 'PDF'} • Page {pageNum || 1}</span>
        </div>
        <div className="pdf-page-block-canvas-wrap" style={{ minHeight: (width || 480) * aspect }}>
          <canvas ref={canvasRef} className="pdf-page-block-canvas" />
          {loading && (
            <div className="pdf-page-block-loading">
              <span>Loading PDF page {pageNum}…</span>
            </div>
          )}
          {error && (
            <div className="pdf-page-block-error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>
        {/* Resize handle */}
        <div
          className="pdf-resize-handle"
          onPointerDown={onResizeStart}
          aria-label="Resize PDF page block"
          title="Drag to resize"
        />
      </div>
    </NodeViewWrapper>
  );
}

export const PdfPageBlock = Node.create<{
  onOpenReader?: (documentId: string, pageNum: number) => void;
}>({
  name: 'pdfPage',
  group: 'block',
  atom: true,
  draggable: true,

  addOptions() {
    return {
      onOpenReader: undefined,
    };
  },

  addAttributes() {
    return {
      documentId: {
        default: null,
        parseHTML: el => el.getAttribute('data-pdf-doc'),
      },
      pageNum: {
        default: 1,
        parseHTML: el => Number(el.getAttribute('data-pdf-page')) || 1,
      },
      width: {
        default: 480,
        parseHTML: el => Number(el.getAttribute('data-pdf-width')) || 480,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-pdf-doc]',
      },
    ];
  },

  renderHTML({ node }) {
    return [
      'div',
      {
        'data-pdf-doc': node.attrs.documentId,
        'data-pdf-page': node.attrs.pageNum,
        'data-pdf-width': node.attrs.width,
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfPageView);
  },
});
