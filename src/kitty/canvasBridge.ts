import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import { nearbyContext } from './selection';
import { registerCanvasSelection } from './selectionBridge';

export function connectKittyCanvas(api: ExcalidrawImperativeAPI) {
  return registerCanvasSelection(() => {
    const state = api.getAppState();
    const input = document.activeElement;
    const native = input instanceof HTMLTextAreaElement && input.matches('.excalidraw-wysiwyg') ? input : undefined;
    const element = state.editingTextElement ?? api.getSceneElements().find(e => state.selectedElementIds[e.id] && e.type === 'text');
    if (element?.type !== 'text') return;
    const original = native?.value ?? element.originalText;
    const start = native ? native.selectionStart : 0, end = native ? native.selectionEnd : original.length;
    const text = original.slice(start, end); if (!text.trim()) return;
    const rect = native?.getBoundingClientRect();
    const settle = async () => {
      const editing = document.querySelector<HTMLTextAreaElement>('.excalidraw-wysiwyg'); editing?.blur();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    return { text, context: nearbyContext(original, text, start), x: rect?.left ?? 200, y: rect ? rect.bottom + 12 : 160,
      replace: async (replacement: string) => {
        await settle();
        const elements = api.getSceneElementsIncludingDeleted(); const current = elements.find(e => e.id === element.id);
        if (current?.type !== 'text' || current.isDeleted || current.originalText !== original) throw new Error('The original text changed. Select it again before replacing.');
        const nextText = original.slice(0, start) + replacement + original.slice(end);
        const [measured] = convertToExcalidrawElements([{ type: 'text', text: nextText, x: current.x, y: current.y, fontSize: current.fontSize, fontFamily: current.fontFamily, lineHeight: current.lineHeight, textAlign: current.textAlign, ...(current.autoResize ? {} : { width: current.width, autoResize: false }) }]);
        const updated = newElementWith(current, { originalText: nextText, text: measured.type === 'text' ? measured.text : nextText, width: measured.width, height: measured.height });
        api.updateScene({ elements: elements.map(e => e.id === current.id ? updated : e), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      },
      insert: async (answer: string) => {
        await settle();
        const elements = api.getSceneElementsIncludingDeleted();
        const current = elements.find(e => e.id === element.id && !e.isDeleted);
        if (!current) throw new Error('The original text was removed. Select another passage.');
        const inserted = convertToExcalidrawElements([{ type: 'text', text: answer, x: current.x, y: current.y + current.height + 28, width: Math.max(current.width, 360), autoResize: false, fontSize: 20, strokeColor: element.strokeColor }]);
        api.updateScene({ elements: [...elements, ...inserted], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      } };
  });
}
