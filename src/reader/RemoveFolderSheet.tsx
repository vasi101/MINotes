import { useState } from 'react';
import { Sheet } from '../App';
import { useStore } from '../store';
import { removeLibraryFolder } from './googleDrive';

export default function RemoveFolderSheet({ path, onClose, onRemoved }: { path: string; onClose: () => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = useStore(state => state.readDocuments.filter(doc => doc.folder === path || doc.folder?.startsWith(`${path}/`)).length);
  return <Sheet title="Remove folder?" onClose={() => { if (!busy) onClose(); }}>
    <p>Remove <strong>{path.split('/').pop()}</strong>, its subfolders, and {count} {count === 1 ? 'document' : 'documents'} from Read?</p>
    <p>Downloaded copies and their local annotations will be removed. Original files in Google Drive or on your computer stay unchanged. This folder will stop refreshing.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-actions">
      <button className="text-button" autoFocus disabled={busy} onClick={onClose}>Cancel</button>
      <button className="accent-button danger-accent" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await removeLibraryFolder(path); onRemoved(); }
        catch (error) { setError(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(false); }
      }}>{busy ? 'Removing...' : 'Remove folder'}</button>
    </div>
  </Sheet>;
}
