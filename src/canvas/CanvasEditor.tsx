import { useCallback, useEffect, useRef, useState } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import './canvas.css';
import { IconButton } from '../icons';
import { useStore, type Note } from '../store';
import { loadScene, saveScene, sceneState, type NoteScene } from './storage';
import { legacyScene } from './legacy';
import { schedulePreview, flushPreview, meaningfulElements } from './previews';
import { continueNativeList, nativeTextLifecycle } from './nativeText';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

declare global { interface Window { EXCALIDRAW_ASSET_PATH: string; } }
window.EXCALIDRAW_ASSET_PATH = '/excalidraw/';

export default function CanvasEditor({ note, onBack, onNewNote }: { note: Note; onBack: () => void; onNewNote: () => void }) {
  const theme = useStore(state => state.theme);
  const updateNote = useStore(state => state.updateNote);
  const [initial, setInitial] = useState<NoteScene>();
  const [api, setApi] = useState<ExcalidrawImperativeAPI>();
  const [status, setStatus] = useState('Loading canvas…');
  const [error, setError] = useState('');
  const last = useRef('');
  const latest = useRef<NoteScene | undefined>(undefined);
  const pending = useRef(Promise.resolve());
  const revision = useRef(0);
  const contentVersion = useRef('');
  const smartText = useRef<ReturnType<typeof nativeTextLifecycle> | undefined>(undefined);
  useEffect(() => {
    if (!api) return;
    const lifecycle = nativeTextLifecycle(api);
    smartText.current = lifecycle;
    return () => { lifecycle.dispose(); smartText.current = undefined; };
  }, [api]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const scene = await loadScene(note.id) ?? await legacyScene(note);
        if (active) { setInitial(scene); setStatus('Saved locally'); }
      } catch { if (active) setError('Could not load this note. Reopen it to retry. Its saved scene has not been changed.'); }
    })();
    return () => { active = false; };
  }, [note.id]);
  const change = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    if (appState.isLoading) return;
    const durable = sceneState(appState);
    const content = JSON.stringify([elements.map(e => [e.id, e.version, e.versionNonce]), Object.values(files).map(f => [f.id, f.version, f.dataURL.length])]);
    const signature = JSON.stringify([content, durable]);
    if (signature === last.current) return;
    last.current = signature;
    const scene: NoteScene = { version: 1, elements: structuredClone(elements), appState: durable, files: structuredClone(files) };
    latest.current = scene;
    const current = ++revision.current;
    setStatus('Saving…');
    // Start an IDB transaction on each change. Transactions are ordered, including
    // during note switches, and images are saved atomically with their elements.
    pending.current = saveScene(note.id, scene).then(() => {
      if (revision.current === current) { setStatus('Saved locally'); setError(''); schedulePreview(note.id, scene); }
    }).catch(() => { setError('Could not save this canvas. Use Excalidraw’s menu to export a backup, then retry.'); throw new Error('Save failed'); });
    void pending.current.catch(() => {});
    const preview = elements.filter(e => !e.isDeleted && e.type === 'text').map(e => e.type === 'text' ? e.text : '').join(' ').slice(0, 1000);
    const stored = useStore.getState().notes.find(n => n.id === note.id);
    if (stored?.preview !== preview || stored?.editor !== 'excalidraw' || stored?.canvasEmpty !== !meaningfulElements(scene).length || (contentVersion.current && contentVersion.current !== content)) updateNote(note.id, { editor: 'excalidraw', canvasEmpty: !meaningfulElements(scene).length, preview, date: new Date().toISOString() });
    contentVersion.current = content;
  }, [note.id, updateNote]);
  const leave = async (action: () => void) => {
    await smartText.current?.flush();
    try { await pending.current; await flushPreview(note.id); action(); } catch { /* Keep the note open on failure. */ }
  };
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault(); event.stopImmediatePropagation();
        void (async () => { await smartText.current?.flush(); await pending.current; await flushPreview(note.id); onNewNote(); })().catch(() => setError('Could not save. Export a backup before creating another note.'));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); event.stopPropagation();
        if (latest.current) { pending.current = saveScene(note.id, latest.current); void pending.current.then(() => { setError(''); setStatus('Saved locally'); }).catch(() => setError('Could not save. Export a backup from the canvas menu.')); }
      }
    };
    window.addEventListener('keydown', save, true);
    return () => window.removeEventListener('keydown', save, true);
  }, [note.id, onNewNote]);
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested(event => {
      event.preventDefault();
      void (async () => { await smartText.current?.flush(); await pending.current; await flushPreview(note.id); await getCurrentWindow().destroy(); })().catch(() => setError('Could not save. Export a backup before closing Mi Notes.'));
    }).then(stop => { if (disposed) stop(); else unlisten = stop; });
    return () => { disposed = true; unlisten?.(); };
  }, []);
  return <section className="canvas-editor" aria-label="Note canvas editor">
    <header className="canvas-note-bar">
      <IconButton icon="back" label="Back to notes" onClick={() => void leave(onBack)}/>
      <div className="canvas-title-wrap"><span aria-hidden="true">{note.title || 'Untitled note'}</span><input onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Note title" placeholder="Untitled note" value={note.title} onChange={event => updateNote(note.id, { title: event.target.value, date: new Date().toISOString() })}/></div>
      <span className="canvas-save-status" role="status">{status}</span>
    </header>
    {error && <p className="canvas-error" role="alert">{error}</p>}
    <div className="canvas-stage" onKeyDownCapture={continueNativeList}>
      {initial && <Excalidraw initialData={{ ...initial, scrollToContent: !initial.appState.zoom }} excalidrawAPI={setApi} onChange={change} theme={theme} name={note.title || 'Untitled note'} autoFocus UIOptions={{ canvasActions: { toggleTheme: false } }}/>}
    </div>
  </section>;
}
