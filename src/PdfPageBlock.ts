import { Node, ReactNodeViewRenderer } from '@tiptap/react';
import PdfPageView from './PdfPageView';

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
