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
import type { PdfMark } from './reader/types';

function drawMarks(ctx: CanvasRenderingContext2D, marks: PdfMark[], width: number, height: number) {
  for (const mark of marks) {
    const color = mark.color || '#f2a900';
    if (mark.kind === 'text' && mark.text && mark.points.length >= 2) {
      ctx.fillStyle = color;
      ctx.font = `${Math.max(6, mark.width * width)}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(mark.text, mark.points[0] * width, mark.points[1] * height);
      continue;
    }
    if (mark.rects.length) {
      ctx.globalAlpha = mark.kind === 'highlight' ? 0.3 : 0.5;
      ctx.fillStyle = color;
      for (const rect of mark.rects) ctx.fillRect(rect.x * width, rect.y * height, rect.width * width, rect.height * height);
    }
    if (mark.points.length >= 4) {
      ctx.globalAlpha = mark.kind === 'marker' ? 0.32 : 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, mark.width * width);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(mark.points[0] * width, mark.points[1] * height);
      for (let index = 2; index < mark.points.length; index += 2) ctx.lineTo(mark.points[index] * width, mark.points[index + 1] * height);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function PdfPageView({ node, updateAttributes, selected, extension }: NodeViewProps) {
  const { documentId, pageNum, width = 480, marks = [] } = node.attrs as { documentId: string; pageNum: number; width: number; marks: PdfMark[] };
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
        drawMarks(ctx, marks, vp.width, vp.height);
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
  }, [documentId, pageNum, width, marks]);

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
      marks: {
        default: [],
        parseHTML: el => {
          try { return JSON.parse(el.getAttribute('data-pdf-marks') || '[]'); } catch { return []; }
        },
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
        'data-pdf-marks': JSON.stringify(node.attrs.marks || []),
      },
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PdfPageView);
  },
});
