import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { browserDriveStartToken, browserDriveChanges, browserSearchDrive, browserDriveStatus, configureBrowserDrive, prepareBrowserDrive, connectBrowserDrive, disconnectBrowserDrive, browserListDrive, browserDriveMetadata, browserDownloadDrive } from './googleDriveBrowser';
import { useStore } from '../store';
import { loadPdf } from './pdf';
import { deletePdfFile, deletePdfFiles, deleteDirectoryHandle, getDirectoryHandles, saveDirectoryHandle, savePdfFile } from './storage';

export type DriveStatus = { configured: boolean; connected: boolean; persistent?: boolean; email?: string; accountId?: string };
export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; parents?: string[]; trashed?: boolean };
export type DriveChange = { changeType?: string; fileId?: string; removed?: boolean; file?: DriveFile };
export type DriveChangesPage = { changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string };
export type DriveSource = { provider: 'google-drive'; folderId: string; name: string; accountId: string; excludedPaths?: string[]; changeToken?: string; snapshot?: Record<string, DriveFile[]> };
export type SavedDriveSource = { id: string; handle: DriveSource; basePath?: string; directories?: string[] };
export const DRIVE_FOLDER = 'application/vnd.google-apps.folder';
const colors = ['#8ce47b', '#79dedf', '#afa0e9', '#dfc28a', '#df8ab7', '#e8c934', '#e77c2c', '#715bb4'];
export const driveStatus = () => isTauri() ? invoke<DriveStatus>('drive_status') : Promise.resolve(browserDriveStatus());
export const configureDrive = (configJson: string) => isTauri() ? invoke<void>('drive_configure', { configJson }) : Promise.resolve(configureBrowserDrive(configJson));
export const prepareDrive = () => isTauri() ? Promise.resolve() : prepareBrowserDrive();
export const disconnectDrive = async () => {
  if (isTauri()) await invoke<void>('drive_disconnect'); else await disconnectBrowserDrive();
  useDriveSync.setState(state => ({ folders: Object.fromEntries(Object.keys(state.folders).map(id => [id, 'pending' as const])), error: '', lastSynced: undefined }));
};
export const connectDrive = () => isTauri() ? invoke<DriveStatus>('drive_connect') : connectBrowserDrive();
export const searchDrive = (name: string, accountId: string) => isTauri() ? invoke<DriveFile[]>('drive_search', { name, accountId }) : browserSearchDrive(name, accountId);
export const listDrive = (folderId: string, accountId: string) => isTauri() ? invoke<DriveFile[]>('drive_list', { folderId, accountId }) : browserListDrive(folderId, accountId);
export const driveMetadata = (fileId: string, accountId: string) => isTauri() ? invoke<DriveFile>('drive_metadata', { fileId, accountId }) : browserDriveMetadata(fileId, accountId);
export async function driveSources(): Promise<SavedDriveSource[]> {
  return (await getDirectoryHandles()).filter((source): source is SavedDriveSource => !!source.handle && typeof source.handle === 'object' && 'provider' in source.handle && source.handle.provider === 'google-drive');
}
const segment = (name: string) => name.replaceAll('/', '?').trim() || 'Untitled';
let syncing: Promise<void> | undefined;
export const useDriveSync = create<{ busy: boolean; message: string; error: string; lastSynced?: number; folders: Record<string, 'pending' | 'synced' | 'error'> }>(() => ({ folders: {}, busy: false, message: '', error: '' }));
const pendingSources = new Map<string, Promise<void>>();
export function syncDriveSource(source: SavedDriveSource, onProgress?: (message: string) => void): Promise<void> {
  const pending = pendingSources.get(source.id);
  if (pending) return pending;
  const task = queueLibraryTask(async () => {
    useDriveSync.setState(state => ({ folders: { ...state.folders, [source.id]: 'pending' } }));
    useDriveSync.setState({ busy: true, error: '', message: `Checking ${source.handle.name}...` });
    try {
      const latest = (await driveSources()).find(item => item.id === source.id);
      if (latest) await reconcile(latest, message => {
        useDriveSync.setState({ message }); onProgress?.(message);
      });
      useDriveSync.setState(state => ({ folders: { ...state.folders, [source.id]: 'synced' } }));
      useDriveSync.setState({ lastSynced: Date.now(), message: 'Drive is up to date' });
    } catch (error) {
      useDriveSync.setState(state => ({ folders: { ...state.folders, [source.id]: 'error' } }));
      useDriveSync.setState({ error: error instanceof Error ? error.message : String(error), message: 'Sync needs attention' });
      throw error;
    } finally { useDriveSync.setState({ busy: false }); }
  });
  pendingSources.set(source.id, task);
  void task.finally(() => pendingSources.delete(source.id)).catch(() => {});
  return task;
}
let backgroundRunning = false;
export async function refreshDriveInBackground() {
  if (backgroundRunning || pendingSources.size || !navigator.onLine) return;
  backgroundRunning = true;
  try {
    const sources = await driveSources();
    useDriveSync.setState(state => ({ folders: Object.fromEntries(sources.map(source => [source.id, state.folders[source.id] || 'pending'])) }));
    if (!sources.length) return;
    const status = await driveStatus();
    if (!status.connected) {
      useDriveSync.setState({ folders: Object.fromEntries(sources.map(source => [source.id, 'pending' as const])), error: 'Sign in to resume Drive sync.' });
      return;
    }
    for (const source of sources.filter(source => source.handle.accountId === status.accountId)) {
      try { await syncDriveSource(source); } catch { /* Reported in the profile; retry on the next check. */ }
    }
  } catch (error) {
    useDriveSync.setState({ error: error instanceof Error ? error.message : String(error) });
  } finally { backgroundRunning = false; }
}
export function startDriveBackgroundSync() {
  const refresh = () => { void refreshDriveInBackground(); };
  refresh();
  const timer = window.setInterval(refresh, 30000);
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
  };
}
function queueLibraryTask(action: () => Promise<void>): Promise<void> {
  const task = (syncing || Promise.resolve()).catch(() => {}).then(action);
  syncing = task;
  void task.finally(() => { if (syncing === task) syncing = undefined; }).catch(() => {});
  return task;
}
const startToken = (accountId: string) => isTauri() ? invoke<string>('drive_start_token', { accountId }) : browserDriveStartToken(accountId);
const changesPage = (pageToken: string, accountId: string) => isTauri() ? invoke<DriveChangesPage>('drive_changes', { pageToken, accountId }) : browserDriveChanges(pageToken, accountId);
async function changedSnapshot(source: SavedDriveSource): Promise<{ snapshot?: Record<string, DriveFile[]>; token: string; relevant: boolean }> {
  const { accountId, folderId, changeToken, snapshot } = source.handle;
  if (!changeToken || !snapshot || !snapshot[folderId]) return { token: await startToken(accountId), relevant: true };
  let pageToken = changeToken;
  const seen = new Set<string>();
  const changes = new Map<string, DriveChange>();
  let reset = false;
  let token = '';
  try {
    for (;;) {
      if (seen.has(pageToken)) throw new Error('Google Drive repeated a changes page. Try again.');
      seen.add(pageToken);
      const page = await changesPage(pageToken, accountId);
      if (!Array.isArray(page.changes)) throw new Error('Google Drive returned incomplete changes. Try again.');
      for (const change of page.changes) {
        if (change.changeType === 'drive') { reset = true; continue; }
        if (!change.fileId) throw new Error('Google Drive returned an invalid change. Try again.');
        changes.set(change.fileId, change);
      }
      if (page.nextPageToken) { pageToken = page.nextPageToken; continue; }
      if (!page.newStartPageToken) throw new Error('Google Drive did not return the next change marker.');
      token = page.newStartPageToken; break;
    }
  } catch (error) {
    if (String(error).includes('DRIVE_CURSOR_INVALID')) return { token: await startToken(accountId), relevant: true };
    throw error;
  }
  if (reset) return { token: await startToken(accountId), relevant: true };
  const known = new Set([folderId, ...Object.keys(snapshot), ...Object.values(snapshot).flat().map(file => file.id)]);
  const relevant = [...changes.values()].some(change => known.has(change.fileId!) || change.file?.parents?.some(parent => Object.hasOwn(snapshot, parent)));
  if (!relevant) return { snapshot, token, relevant: false };
  const next = Object.fromEntries(Object.entries(snapshot).map(([id, entries]) => [id, [...entries]]));
  for (const [fileId, change] of changes) {
    if (fileId === folderId) {
      if (change.removed || change.file?.trashed) throw new Error('The linked Drive folder is unavailable. Your downloaded PDFs are kept offline.');
      continue;
    }
    // Missing parent information cannot safely determine moves or membership.
    if (!change.removed && !change.file?.trashed && (!change.file || !Array.isArray(change.file.parents))) {
      if (known.has(fileId)) return { token: await startToken(accountId), relevant: true };
      continue;
    }
    for (const parent of Object.keys(next)) next[parent] = next[parent].filter(file => file.id !== fileId);
    const file = change.file;
    if (change.removed || file?.trashed || !file) {
      delete next[fileId];
      continue;
    }
    if (file.mimeType !== DRIVE_FOLDER && file.mimeType !== 'application/pdf') continue;
    for (const parent of file.parents || []) if (Object.hasOwn(next, parent)) next[parent].push(file);
  }
  return { snapshot: next, token, relevant: true };
}
async function reconcile(source: SavedDriveSource, onProgress?: (message: string) => void) {
  const { folderId, accountId } = source.handle;
  // Capture a marker BEFORE the initial scan so concurrent uploads cannot be missed.
  const delta = await changedSnapshot(source);
  if (!delta.relevant) {
    await saveDirectoryHandle(source.id, { ...source.handle, changeToken: delta.token }, source.basePath || '', source.directories);
    return;
  }
  if (!delta.snapshot) {
    const root = await driveMetadata(folderId, accountId);
    if (root.mimeType !== DRIVE_FOLDER) throw new Error('Choose a Google Drive folder.');
  }
  const snapshot: Record<string, DriveFile[]> = {};
  const destination = (path: string) => [source.basePath, path].filter(Boolean).join('/');
  const directories: string[] = [];
  const files: Array<{ file: DriveFile; path: string; folder: string }> = [];
  const visited = new Set<string>();
  const visit = async (id: string, path: string) => {
    if (visited.has(id) || source.handle.excludedPaths?.some(excluded => path === excluded || path.startsWith(`${excluded}/`))) return;
    visited.add(id); directories.push(path);
    onProgress?.(`Checking ${path}...`);
    // Only newly discovered folders need listing; existing folders use the saved index.
    const entries = delta.snapshot?.[id] ?? await listDrive(id, accountId);
    snapshot[id] = entries;
    const folders = entries.filter(file => file.mimeType === DRIVE_FOLDER);
    for (const file of entries) {
      const duplicate = folders.filter(item => segment(item.name) === segment(file.name)).length > 1;
      const name = segment(file.name) + (file.mimeType === DRIVE_FOLDER && duplicate ? ` (${file.id})` : '');
      const child = `${path}/${name}`;
      if (file.mimeType === DRIVE_FOLDER) await visit(file.id, child);
      else if (file.mimeType === 'application/pdf') files.push({ file, path: child, folder: destination(path) });
    }
  };
  // A complete scan must succeed before any missing documents are removed.
  await visit(folderId, segment(source.handle.name));
  for (let index = 0; index < files.length; index++) {
    const { file, path, folder } = files[index];
    onProgress?.(`Syncing PDF ${index + 1} of ${files.length}`);
    const store = useStore.getState();
    const current = store.readDocuments.find(doc => doc.sourceId === source.id && doc.sourceFileId === file.id);
    const modified = file.modifiedTime ? Date.parse(file.modifiedTime) : undefined;
    const metadata = { name: file.name.replace(/\.pdf$/i, ''), folder, sourcePath: path, sourceFileId: file.id, sourceModified: modified };
    if (current && modified !== undefined && current.sourceModified === modified && current.size === Number(file.size)) {
      if (current.name !== metadata.name || current.folder !== folder || current.sourcePath !== path) store.updateReadDocument(current.id, metadata);
      continue;
    }
    const bytes = isTauri() ? new Uint8Array(await invoke<number[]>('drive_download', { fileId: file.id, accountId })) : await browserDownloadDrive(file.id, accountId);
    const task = loadPdf(bytes);
    let pages: number;
    try { pages = (await task.promise).numPages; } finally { await task.destroy(); }
    const id = current?.id || crypto.randomUUID();
    await savePdfFile(id, bytes);
    if (current) store.updateReadDocument(id, { ...metadata, pages, size: bytes.length, thumbnail: undefined, lastPage: Math.min(current.lastPage, pages) });
    else store.addReadDocument({ id, ...metadata, pages, size: bytes.length, addedAt: new Date().toISOString(), lastPage: 1, zoom: 0, marks: [], sourceId: source.id });
  }
  const ids = new Set(files.map(item => item.file.id));
  for (const doc of useStore.getState().readDocuments.filter(doc => doc.sourceId === source.id && !ids.has(doc.sourceFileId || ''))) {
    await deletePdfFile(doc.id);
    useStore.getState().removeReadDocument(doc.id);
  }
  for (const path of directories) {
    const state = useStore.getState();
    if (!state.readFolders.includes(destination(path))) state.addReadFolder(destination(path), colors[state.readFolders.length % colors.length]);
  }
  const removed = new Set((source.directories || []).filter(path => !directories.includes(path)).map(destination));
  useStore.setState(state => ({ readFolders: state.readFolders.filter(path => !removed.has(path) || state.readDocuments.some(doc => doc.folder === path || doc.folder?.startsWith(`${path}/`))) }));
  await saveDirectoryHandle(source.id, { ...source.handle, changeToken: delta.token, snapshot }, source.basePath || '', directories);
}
export async function importDriveFolder(file: DriveFile, accountId: string, basePath: string, onProgress?: (message: string) => void, background = false) {
  const id = `google-drive:${accountId}:${file.id}`;
  const existing = (await driveSources()).find(source => source.id === id);
  let name = file.name;
  const folderExists = (name: string) => useStore.getState().readFolders.includes([basePath, segment(name)].filter(Boolean).join('/'));
  if (!existing && folderExists(name)) {
    name = `${file.name} (Drive)`;
    for (let index = 2; folderExists(name); index++) name = `${file.name} (Drive ${index})`;
  }
  const source: SavedDriveSource = existing || { id, handle: { provider: 'google-drive', folderId: file.id, name, accountId }, basePath, directories: [] };
  // Save before downloads so an interrupted import can be resumed with Refresh.
  await saveDirectoryHandle(id, source.handle, source.basePath || '', source.directories || []);
  const rootPath = [basePath, segment(name)].filter(Boolean).join('/');
  if (!useStore.getState().readFolders.includes(rootPath)) useStore.getState().addReadFolder(rootPath, colors[0]);
  const task = syncDriveSource(source, onProgress);
  if (background) { void task.catch(() => {}); return; }
  await task;
}


export function removeLibraryFolder(fullPath: string): Promise<void> {
  return queueLibraryTask(async () => {
    const inside = (path: string) => path === fullPath || path.startsWith(`${fullPath}/`);
    // Detach roots or exclude a removed subfolder before deleting any local data.
    // The shared queue prevents an in-flight refresh from recreating removed items.
    for (const source of await getDirectoryHandles()) {
      const handle = source.handle as { name?: string; provider?: string; excludedPaths?: string[]; changeToken?: string; snapshot?: Record<string, DriveFile[]> };
      const rootName = source.directories?.[0] || handle?.name;
      if (!rootName) continue;
      const legacyBase = source.id.slice(0, source.id.lastIndexOf(':'));
      const basePath = source.basePath ?? (legacyBase === 'root' ? '' : legacyBase);
      const root = [basePath, segment(rootName)].filter(Boolean).join('/');
      if (inside(root)) await deleteDirectoryHandle(source.id);
      else if (fullPath.startsWith(`${root}/`) && handle.provider === 'google-drive') {
        const relative = basePath ? fullPath.slice(basePath.length + 1) : fullPath;
        await saveDirectoryHandle(source.id, { ...handle, excludedPaths: [...new Set([...(handle.excludedPaths || []), relative])] }, basePath, source.directories);
      }
    }
    const ids = useStore.getState().readDocuments.filter(doc => doc.folder && inside(doc.folder)).map(doc => doc.id);
    await deletePdfFiles(ids);
    const removed = new Set(ids);
    useStore.setState(state => ({ readDocuments: state.readDocuments.filter(doc => !removed.has(doc.id)) }));
    useStore.getState().deleteReadFolder(fullPath);
  });
}
