import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';

export type NoteScene = {
  version: 1;
  elements: readonly ExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
};
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('minotes-scenes', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('notes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function loadScene(noteId: string): Promise<NoteScene | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('notes').objectStore('notes').get(noteId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveScene(noteId: string, scene: NoteScene) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('notes', 'readwrite');
    transaction.objectStore('notes').put(scene, noteId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Saving was interrupted.'));
  });
}
// Persist only durable settings, never selection, dialogs, editing state or DOM refs.
export function sceneState(state: AppState): Partial<AppState> {
  return {
    scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom,
    viewBackgroundColor: state.viewBackgroundColor, gridSize: state.gridSize,
    gridModeEnabled: state.gridModeEnabled,
    currentItemFontFamily: state.currentItemFontFamily,
    currentItemFontSize: state.currentItemFontSize,
    currentItemStrokeColor: state.currentItemStrokeColor,
    currentItemBackgroundColor: state.currentItemBackgroundColor,
    currentItemFillStyle: state.currentItemFillStyle,
    currentItemStrokeWidth: state.currentItemStrokeWidth,
    currentItemStrokeStyle: state.currentItemStrokeStyle,
    currentItemRoughness: state.currentItemRoughness,
    currentItemOpacity: state.currentItemOpacity,
    currentItemTextAlign: state.currentItemTextAlign,
    currentItemStartArrowhead: state.currentItemStartArrowhead,
    currentItemEndArrowhead: state.currentItemEndArrowhead,
  };
}
