import { useEffect, useState } from 'react';
import { Icon } from './icons';
import { useStore, type Note } from './store';
import { loadPreview } from './canvas/previewStorage';
import './note-cards.css';

function modifiedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export default function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const theme = useStore(state => state.theme);
  const [preview, setPreview] = useState<{ url?: string; empty: boolean }>({ empty: note.canvasEmpty === true });
  useEffect(() => {
    let active = true, url: string | undefined;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const cached = await loadPreview(note.id);
        if (!active || generation !== current) return;
        if (url) URL.revokeObjectURL(url);
        const blob = cached?.[theme];
        url = blob ? URL.createObjectURL(blob) : undefined;
        setPreview({ url, empty: cached?.empty ?? note.canvasEmpty === true });
      } catch { /* The themed placeholder remains available without the cache. */ }
    };
    void refresh();
    const changed = (event: Event) => { if ((event as CustomEvent).detail === note.id) void refresh(); };
    window.addEventListener('minotes-preview', changed);
    return () => { active = false; window.removeEventListener('minotes-preview', changed); if (url) URL.revokeObjectURL(url); };
  }, [note.id, note.canvasEmpty, theme]);
  return <button className="note-card canvas-note-card" onClick={onOpen} aria-label={`Open ${note.title || 'Untitled'}`}>
    <div className="note-cover">
      {preview.url ? <img src={preview.url} alt="Canvas preview" loading="lazy" decoding="async"/> :
        <div className="note-cover-placeholder"><Icon name="notes" size={28}/><span>{preview.empty ? 'Empty note' : 'Canvas note'}</span></div>}
    </div>
    <div className="note-cover-meta">
      <h2 title={note.title || 'Untitled'}>{note.pinned && <Icon name="pin" size={13}/>} {note.title || 'Untitled'}</h2>
      <time dateTime={note.date}>{modifiedDate(note.date)}</time>
    </div>
  </button>;
}
