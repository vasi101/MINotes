import { nearbyContext } from './selection';
export type KittySelection = { text: string; context: string; x: number; y: number; replace?: (text: string) => Promise<void>; insert?: (text: string) => Promise<void> };
let canvasSelection: (() => KittySelection | undefined) | undefined;
export function registerCanvasSelection(getter: () => KittySelection | undefined) {
  canvasSelection = getter;
  return () => { if (canvasSelection === getter) canvasSelection = undefined; };
}
export function captureSelection(): KittySelection | undefined {
  const active = document.activeElement;
  if (active?.closest('.kitty-surface')) return;
  const canvas = canvasSelection?.();
  if (canvas) return canvas;
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  if (!element?.closest('.pdf-text-layer')) return;
  const text = selection.toString().trim(); if (!text) return;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  return { text, context: nearbyContext(element.closest('.pdf-text-layer')?.textContent ?? '', text), x: rect.left, y: rect.bottom + 12 };
}
