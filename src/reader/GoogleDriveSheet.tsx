import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { Sheet } from '../App';
import { Icon } from '../icons';
import { useDriveSync, refreshDriveInBackground, connectDrive, configureDrive, prepareDrive, disconnectDrive, DRIVE_FOLDER, driveMetadata, driveStatus, driveSources, importDriveFolder, listDrive, searchDrive, type SavedDriveSource, type DriveFile, type DriveStatus } from './googleDrive';

export default function GoogleDriveSheet({ basePath, onClose, onBusy, profile = false }: { profile?: boolean; basePath: string; onClose: () => void; onBusy: (busy: boolean) => void }) {
  const sync = useDriveSync();
  const [showFolders, setShowFolders] = useState(!profile);
  const [status, setStatus] = useState<DriveStatus>();
  const [busy, setBusy] = useState(false);
  const [linkedSources, setLinkedSources] = useState<SavedDriveSource[]>([]);
  const [hasSources, setHasSources] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [trail, setTrail] = useState<DriveFile[]>([{ id: 'root', name: 'My Drive', mimeType: DRIVE_FOLDER }]);
  const [link, setLink] = useState('');
  const [matches, setMatches] = useState<DriveFile[]>();
  const upload = useRef<HTMLInputElement>(null);
  const current = trail[trail.length - 1];
  const run = async (action: () => Promise<void>) => {
    setBusy(true); onBusy(true); setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); onBusy(false); setProgress(''); }
  };
  const browse = async (next: DriveFile[], accountId: string) => {
    const entries = await listDrive(next[next.length - 1].id, accountId);
    setFolders(entries.filter(file => file.mimeType === DRIVE_FOLDER).sort((a, b) => a.name.localeCompare(b.name)));
    setTrail(next); setMatches(undefined);
  };
  useEffect(() => {
    void run(async () => {
      const result = await driveStatus(); setStatus(result);
      setHasSources((await driveSources()).length > 0);
      if (result.configured) await prepareDrive();
      if (showFolders && result.connected && result.accountId) await browse(trail, result.accountId);
    });
  }, []);
  useEffect(() => {
    let active = true;
    void driveSources().then(sources => { if (active) { setLinkedSources(sources); setHasSources(sources.length > 0); } }).catch(() => {});
    return () => { active = false; };
  }, [sync.busy]);
  return <Sheet title={profile ? "Profile" : "Google Drive"} onClose={() => { if (!busy) onClose(); }}>
    <div className="drive-connection">
      <div className="drive-profile-heading">
        <div className="drive-avatar"><Icon name="profile" size={26}/></div>
        <div><strong>{status?.connected ? 'Your Google account' : 'Bring your Drive PDFs into Mi Notes'}</strong><p className="drive-hint">{status?.connected ? 'Linked folders stay in sync while Mi Notes is open.' : 'Sign in once, then choose a folder.'}</p></div>
      </div>
      <>
          <input ref={upload} type="file" accept=".json,application/json" hidden aria-label="Google OAuth configuration" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = '';
            if (file) void run(async () => { await configureDrive(await file.text()); setStatus(await driveStatus()); await prepareDrive(); });
          }}/>
        {!status && <p role="status">Checking Google connection...</p>}
        {status && !status.configured && isTauri() && <div className="drive-setup">
          <h3>Sign in with Google</h3>
          <p>Google sign-in is not available in this build yet. The app developer needs to finish Google sign-in setup.</p>
          <button className="accent-button" disabled>Continue with Google</button>
        </div>}
        {status && !status.configured && !isTauri() && <div className="drive-setup">
          <h3>One-time Google setup</h3>
          <ol>
            <li>In Google Cloud, create a project and enable the Google Drive API.</li>
            <li>Configure Google Auth Platform and add your Google account as a test user.</li>
            <li>Create an OAuth client with application type <strong>{isTauri() ? 'Desktop app' : 'Web application'}</strong> and download its JSON.</li>
            {!isTauri() && <li>Add <code>{window.location.origin}</code> to <strong>Authorized JavaScript origins</strong> before downloading the JSON.</li>}
          </ol>
          <p>Load that JSON here, then sign in in your browser. Google will request read-only Drive access.</p>
          <button className="accent-button" disabled={busy} onClick={() => upload.current?.click()}>Load Google OAuth JSON</button>

        </div>}
        {status?.configured && <div className="drive-account">
          <span>{status.connected ? `Connected: ${status.email || 'Google account'}` : hasSources ? 'Your folders are linked. Sign in again to resume updates.' : 'Ready to connect your Google account'}</span>
          {(!status.persistent || !status.connected) && <button className="accent-button" disabled={busy} onClick={() => void run(async () => {
            setProgress('Complete sign-in in your browser…');
            const result = await connectDrive(); setStatus(result);
            void refreshDriveInBackground();
            if (showFolders) await browse([{ id: 'root', name: 'My Drive', mimeType: DRIVE_FOLDER }], result.accountId!);
          })}>{status.persistent ? 'Continue with Google' : status.connected ? 'Reconnect account' : 'Connect Google Drive'}</button>}
          {!status.connected && !status.persistent && <button className="text-button" disabled={busy} onClick={() => upload.current?.click()}>Change configuration</button>}
          {status.connected && <button className="text-button" disabled={busy} onClick={() => void run(async () => {
            await disconnectDrive(); setStatus(await driveStatus()); setFolders([]); setMatches(undefined);
          })}>{status.persistent ? 'Sign out' : 'Disconnect'}</button>}
        </div>}
        {status?.connected && <div className="drive-sync-card">
          <div><Icon name={sync.busy ? 'repeat' : 'check'} size={18}/><strong>{sync.busy ? 'Syncing in background' : sync.error ? 'Sync paused' : 'Automatic sync on'}</strong></div>
          <p className="drive-hint">{sync.busy ? sync.message : 'New and changed PDFs are checked every 30 seconds.'}</p>
          {sync.busy && <progress aria-label="Google Drive sync progress"/>}
          {sync.error && <p className="error" role="alert">{sync.error}</p>}
          {!sync.busy && sync.lastSynced && <p className="drive-hint">Last synced {new Date(sync.lastSynced).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
          <p className="drive-hint">Drive to Mi Notes. Your annotations stay on this device.</p>
        </div>}
        {profile && linkedSources.length > 0 && <div className="profile-folder-status" aria-label="Linked folder sync status">
          <strong>Linked folders</strong>
          {linkedSources.map(source => {
            const synced = !!status?.connected && status.accountId === source.handle.accountId && sync.folders[source.id] === 'synced';
            return <div className="profile-folder-row" key={source.id}>
              <span className={`folder-sync-dot ${synced ? 'is-synced' : ''}`} aria-hidden="true"/>
              <span>{source.handle.name}</span><small>{synced ? 'Synced' : sync.folders[source.id] === 'pending' && sync.busy ? 'Syncing' : 'Not synced'}</small>
            </div>;
          })}
        </div>}
        {status?.connected && !showFolders && <button className="accent-button" disabled={busy} onClick={() => void run(async () => {
          await browse([{ id: 'root', name: 'My Drive', mimeType: DRIVE_FOLDER }], status.accountId!); setShowFolders(true);
        })}>Choose a Drive folder</button>}
        {status?.connected && showFolders && <>
          {hasSources && <button className="text-button" disabled={busy || sync.busy} aria-label="Refresh Google Drive folders" onClick={() => void refreshDriveInBackground()}><Icon name="repeat" size={16}/> Refresh now</button>}
          <form className="drive-link-form" onSubmit={event => { event.preventDefault(); void run(async () => {
            const name = link.trim();
            setMatches(undefined);
            if (!name.startsWith('https://')) {
              const results = await searchDrive(name, status.accountId!);
              setMatches(results.sort((a, b) => a.name.localeCompare(b.name)));
              return;
            }
            let id = name;
            if (id.startsWith('https://')) {
              const url = new URL(id);
              if (url.hostname !== 'drive.google.com') throw new Error('Paste a Google Drive folder link.');
              id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1] || '';
            }
            if (!/^[\w-]+$/.test(id)) throw new Error('Paste a Google Drive folder link or folder ID.');
            const folder = await driveMetadata(id, status.accountId!);
            if (folder.mimeType !== DRIVE_FOLDER) throw new Error('Choose a folder link, not a file link.');
            await browse([{ id: 'root', name: 'My Drive', mimeType: DRIVE_FOLDER }, folder], status.accountId!);
          }); }}>
            <label className="field">Folder name<input value={link} onChange={event => setLink(event.target.value)} placeholder="e.g. Books or Study notes" disabled={busy}/></label>
            <button className="text-button" disabled={busy || !link.trim()}>Find folder</button>
          </form>
          {matches !== undefined && <section aria-label="Folder search results">
            <p role="status">{matches.length ? 'Choose a folder to open, then import it.' : 'No folders found. Try another name.'}</p>
            <div className="drive-folder-list">{matches.map(folder => <button key={folder.id} disabled={busy} onClick={() => void run(() => browse([{ id: 'root', name: 'My Drive', mimeType: DRIVE_FOLDER }, folder], status.accountId!))}><Icon name="folder" size={22}/><span>{folder.name}</span></button>)}</div>
            <button className="text-button" disabled={busy} onClick={() => setMatches(undefined)}>Back to folders</button>
          </section>}
          {matches === undefined && <>
          <nav className="drive-breadcrumb" aria-label="Google Drive folder path">{trail.map((folder, index) => <button key={`${folder.id}:${index}`} disabled={busy || index === trail.length - 1} onClick={() => void run(() => browse(trail.slice(0, index + 1), status.accountId!))}>{folder.name}</button>)}</nav>
          <div className="drive-folder-list" aria-label="Google Drive folders">
            {folders.map(folder => <button key={folder.id} disabled={busy} onClick={() => void run(() => browse([...trail, folder], status.accountId!))}><Icon name="folder" size={22}/><span>{folder.name}</span></button>)}
            {!folders.length && !busy && <p>No subfolders. You can still import PDFs in this folder.</p>}
          </div>
          <button className="accent-button" disabled={busy || current.id === 'root'} onClick={() => void run(async () => {
            await importDriveFolder(current, status.accountId!, basePath, undefined, true);
            onClose();
          })}>Import this Drive folder</button>
          {current.id === 'root' && <p className="drive-hint">Open a folder above, or find it by name.</p>}
          </>}
        </>}
      </>
      {!isTauri() && status?.configured && <p className="drive-hint">{status.persistent ? 'Stay signed in across visits. Choose which folders to import; Mi Notes does not change your Drive files. Your library is saved on this device.' : 'Browser sign-in lasts for this page session. Reconnect after reloading or when access expires; your downloaded PDFs stay saved.'}</p>}
      {busy && <div className="drive-loading" role="status"><progress aria-label="Loading Google Drive"/><span>{progress || "Loading..."}</span></div>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </Sheet>;
}
