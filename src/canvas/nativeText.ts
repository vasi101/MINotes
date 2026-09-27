import { CaptureUpdateAction, convertToExcalidrawElements, newElementWith } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export function formatNativeText(text: string) {
  const heading = text.match(/^(#{1,3}) (\S[\s\S]*)$/);
  if (heading) return { text: heading[2], fontSize: [40, 32, 28][heading[1].length - 1] };
  return { text: text.replace(/^([ \t]*)[-*+] /gm, '$1• '), fontSize: undefined };
}

// 0.18.1 has no public WYSIWYG input callback. Only Enter continuation needs
// this narrow bridge to the existing native textarea. We never create an input,
// replace its handlers, or edit its value during an API scene update.
// Dispatching input lets Excalidraw update text, bounds and persistence itself.
export function continueNativeList(event: ReactKeyboardEvent<HTMLDivElement>) {
  const input = event.target;
  if (!(input instanceof HTMLTextAreaElement) || !input.matches('.excalidraw-wysiwyg')) return;
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  const { value, selectionStart: start, selectionEnd: end } = input;
  if (start !== end) return;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', start);
  const current = value.slice(lineStart, lineEnd < 0 ? value.length : lineEnd);
  const match = current.match(/^([ \t]*)([-*+•]|\d+\.) (.*)$/);
  if (!match || start < lineStart + match[1].length + match[2].length + 1) return;
  event.preventDefault(); event.stopPropagation();
  if (!match[3].trim()) {
    input.setRangeText('', lineStart, lineEnd < 0 ? value.length : lineEnd, 'end');
  } else {
    const numeric = /^\d/.test(match[2]);
    const next = numeric ? `${Number.parseInt(match[2], 10) + 1}. ` : '• ';
    const prefix = numeric ? match[2] + ' ' : '• ';
    const contentStart = lineStart + match[1].length + match[2].length + 1;
    input.setRangeText(match[1] + prefix + value.slice(contentStart, start) + '\n' + match[1] + next, lineStart, start, 'end');
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

export function nativeTextLifecycle(api: ExcalidrawImperativeAPI) {
  let editingId: string | undefined;
  let disposed = false;
  let pending = Promise.resolve();
  const stop = api.onChange((_elements, state) => {
    const next = state.editingTextElement?.id;
    const completed = editingId;
    editingId = next;
    if (!completed || next === completed) return;
    // Wait for Excalidraw's submit/undo snapshot before recording formatting.
    pending = pending.then(() => new Promise<void>(resolve => requestAnimationFrame(() => {
      if (!disposed) {
        const elements = api.getSceneElementsIncludingDeleted();
        const element = elements.find(element => element.id === completed);
        if (element?.type === 'text' && !element.isDeleted) {
          const formatted = formatNativeText(element.originalText);
          if (formatted.text !== element.originalText) {
            const fontSize = formatted.fontSize ?? element.fontSize;
            const [measured] = convertToExcalidrawElements([{
              type: 'text', x: element.x, y: element.y, text: formatted.text,
              fontFamily: element.fontFamily, fontSize, lineHeight: element.lineHeight,
              textAlign: element.textAlign,
              ...(element.autoResize ? {} : { width: element.width, autoResize: false }),
            }]);
            const updated = newElementWith(element, {
              originalText: formatted.text, text: measured.type === 'text' ? measured.text : formatted.text,
              fontSize, width: measured.width, height: measured.height,
            });
            api.updateScene({ elements: elements.map(e => e.id === completed ? updated : e), captureUpdate: CaptureUpdateAction.IMMEDIATELY });
          }
        }
      }
      resolve();
    })));
  });
  return {
    async flush() {
      const focused = document.activeElement;
      if (focused instanceof HTMLTextAreaElement && focused.matches('.canvas-stage .excalidraw-wysiwyg')) focused.blur();
      await new Promise(resolve => setTimeout(resolve, 0));
      await pending;
    },
    dispose() { disposed = true; stop(); },
  };
}
