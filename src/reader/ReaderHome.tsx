import { useRef, useState, useMemo, useEffect } from 'react';
import { useStore } from '../store';
import { loadPdf } from './pdf';
import { savePdfFile, deletePdfFile, getDirectoryHandles } from './storage';
import { Icon, IconButton } from '../icons';
import { FolderArtwork } from '../FolderHome';
import { Sheet } from '../App';
import type { ReadDocument } from './types';
import DocumentThumbnail from './DocumentThumbnail';
import RemoveFolderSheet from './RemoveFolderSheet';
import GoogleDriveSheet from './GoogleDriveSheet';
import { driveSources, driveStatus, syncDriveSource } from './googleDrive';


interface Props {
  onOpen: (id: string) => void;
  folder: string;
  onSelectFolder: (folder: string) => void;
  onOpenFolderHome?: () => void;
}

const colors = [
  "#8ce47b",
  "#67b96d",
  "#43834a",
  "#79dedf",
  "#dfc28a",
  "#df8ab7",
  "#bc658d",
  "#b84278",
  "#ede978",
  "#e8c934",
  "#e77c2c",
  "#b8313a",
  "#702d2a",
  "#afa0e9",
  "#715bb4",
];

export default function ReaderHome({ onOpen, folder, onSelectFolder }: Props) {
  const {
    readDocuments,
    readFolders,
    readFolderColors,
    addReadDocument,
    removeReadDocument,
    updateReadDocument,
    addReadFolder,
    customizeReadFolder,
  } = useStore();

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);

  const [shelf, setShelf] = useState<'Library' | 'Recent' | 'Favourite' | 'To Read'>('Library');
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [driveOpen, setDriveOpen] = useState(false);
  const [driveAction, setDriveAction] = useState('');
  const [removeFolder, setRemoveFolder] = useState<string | null>(null);
  const [savedRoots, setSavedRoots] = useState<string[]>([]);
  useEffect(() => {
    if (driveOpen) return;
    let cancelled = false;
    void getDirectoryHandles().then(sources => {
      if (cancelled) return;
      setSavedRoots(sources.flatMap(source => {
        const handle = source.handle as { name?: string } | undefined;
        const name = source.directories?.[0] || handle?.name;
        if (!name) return [];
        const legacyBase = source.id.slice(0, source.id.lastIndexOf(':'));
        const basePath = source.basePath ?? (legacyBase === 'root' ? '' : legacyBase);
        return [[basePath, name.replaceAll('/', '\u2215')].filter(Boolean).join('/')];
      }));
    }).catch(() => { if (!cancelled) setSavedRoots([]); });
    return () => { cancelled = true; };
  }, [driveOpen, folder, importing, removeFolder]);
  const connectedRoots = useMemo(() => {
    const roots = new Set(savedRoots);
    for (const doc of readDocuments) {
      if (!doc.folder || (!doc.sourceId && !doc.sourcePath)) continue;
      const parts = doc.sourcePath?.split('/') || [];
      const relativeFolder = parts.slice(0, -1).join('/');
      if (parts.length > 1 && doc.folder.endsWith(relativeFolder)) {
        roots.add(doc.folder.slice(0, -relativeFolder.length) + parts[0]);
      } else roots.add(doc.folder);
    }
    return [...roots];
  }, [savedRoots, readDocuments]);
  const [headerMenu, setHeaderMenu] = useState<'add' | 'more' | null>(null);
  const headerActions = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!headerMenu) return;
    const outside = (event: PointerEvent) => {
      if (!headerActions.current?.contains(event.target as Node)) setHeaderMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        headerActions.current?.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
        setHeaderMenu(null);
        event.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [headerMenu]);
  useEffect(() => setHeaderMenu(null), [folder]);
  const driveBusy = useRef(false);
  const syncInProgress = useRef(false);
  type SourceDirectory = {
    name: string;
    values: () => AsyncIterable<{ kind: 'directory' | 'file'; name: string; values?: () => AsyncIterable<unknown>; getFile?: () => Promise<File> }>;
  };
  const refreshSources = async (interactive = true) => {
    if (syncInProgress.current || driveBusy.current || importing) return;
    syncInProgress.current = true;
    setSyncing(true);
    if (interactive) { setError(''); setDriveAction(''); }
    try {
      const status = await driveStatus();
      const sources = await driveSources();
      if (!status.connected || !sources.length) {
        if (interactive) {
          setError(sources.length
            ? 'Your Drive folders are still linked. Sign in again to refresh them; your downloaded PDFs and annotations are saved.'
            : 'This imported folder has no Google Drive link. Choose a Drive folder to enable refresh.');
          setDriveAction(sources.length ? 'Sign in to refresh' : 'Choose Drive folder');
        }
        return;
      }
      const failures: string[] = [];
      for (const source of sources) {
        try { await syncDriveSource(source); }
        catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
      }
      if (failures.length) setError(failures.join(' '));
      else { setError(''); setDriveAction(''); }
    } catch (error) {
      if (interactive) setError(error instanceof Error ? error.message : String(error));
    } finally {
      syncInProgress.current = false;
      setSyncing(false);
    }
  };


  // Batch selection
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const deleteSelected = async () => {
    for (const id of selectedIds) {
      removeReadDocument(id);
      try { await deletePdfFile(id); } catch { /* ignore */ }
    }
    exitSelectMode();
  };

  // Folder creation / customization modal
  const [editingFolder, setEditingFolder] = useState<{
    originalPath: string | null;
    name: string;
    color: string;
  } | null>(null);
  const [folderFormError, setFolderFormError] = useState('');

  // Normalize path: 'All' means root ''
  const currentPath = folder === 'All' ? '' : folder;
  const pathSegments = currentPath ? currentPath.split('/') : [];

  /* ── 1. Calculate direct subfolders at this level ── */
  const directSubfolders = useMemo(() => {
    const prefix = currentPath ? `${currentPath}/` : '';
    const set = new Set<string>();
    for (const f of readFolders) {
      if (!currentPath) {
        const seg = f.split('/')[0];
        if (seg) set.add(seg);
      } else if (f.startsWith(prefix)) {
        const rest = f.slice(prefix.length);
        if (rest) {
          const seg = rest.split('/')[0];
          if (seg) set.add(seg);
        }
      }
    }
    return Array.from(set).sort();
  }, [readFolders, currentPath]);

  /* ── 2. Calculate direct documents at this level ── */
  const directDocs = useMemo(() => {
    return readDocuments.filter(d => {
      if (!currentPath) return !d.folder;
      return d.folder === currentPath;
    });
  }, [readDocuments, currentPath]);

  /* ── 3. Shelf lists (only shown at root) ── */
  const recentDocs = useMemo(() => {
    return [...readDocuments]
      .filter(d => !!d.lastOpenedAt)
      .sort((a, b) => Date.parse(b.lastOpenedAt!) - Date.parse(a.lastOpenedAt!));
  }, [readDocuments]);

  const favouriteDocs = useMemo(() =>
    readDocuments.filter(d => d.favourite),
  [readDocuments]);

  const toReadDocs = useMemo(() =>
    readDocuments.filter(d => d.toRead),
  [readDocuments]);

  // Context menu state
  const visibleDocs = shelf === 'Recent' ? recentDocs : shelf === 'Favourite' ? favouriteDocs : shelf === 'To Read' ? toReadDocs : directDocs;
  /* ── Recursive item count helper ── */
  const getSubfolderStats = (subName: string) => {
    const subFullPath = currentPath ? `${currentPath}/${subName}` : subName;
    const docCount = readDocuments.filter(
      d => d.folder === subFullPath || (d.folder && d.folder.startsWith(`${subFullPath}/`))
    ).length;
    return { subFullPath, docCount };
  };

  /* ── Batch / Folder import ── */
  const importFiles = async (files: File[], isFolderImport: boolean = false, directories: string[] = [], importPath = currentPath) => {
    // Preserve the tree before parsing PDFs, including non-PDF and empty folders.
    if (isFolderImport) {
      const paths = new Set(directories);
      for (const file of files) {
        const parts = file.webkitRelativePath.split('/').slice(0, -1);
        for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
      }
      for (const path of paths) {
        const fullPath = importPath ? `${importPath}/${path}` : path;
        if (!useStore.getState().readFolders.includes(fullPath)) addReadFolder(fullPath, colors[(useStore.getState().readFolders.length * 4) % colors.length]);
      }
    }
    const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfFiles.length) {
      setError(isFolderImport ? '' : 'No PDF files found to import.');
      return;
    }

    setImporting(true);
    setError('');

    let successCount = 0;
    const failures: string[] = [];
    for (let i = 0; i < pdfFiles.length; i++) {
      const file = pdfFiles[i];
      setImportStatus(`Importing ${i + 1} of ${pdfFiles.length}…`);

      try {
        const relativeFolder = isFolderImport ? file.webkitRelativePath.split('/').slice(0, -1).join('/') : '';
        const assignedFolder = [importPath, relativeFolder].filter(Boolean).join('/') || undefined;
        const name = file.name.replace(/\.pdf$/i, '');
        const sourcePath = isFolderImport ? file.webkitRelativePath : undefined;
        const existing = useStore.getState().readDocuments.find(doc => !doc.sourceId && doc.folder === assignedFolder && doc.name === name);

        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = existing?.id || crypto.randomUUID();

        // Page count & thumbnail
        const task = loadPdf(bytes);
        const pdfDoc = await task.promise;
        const pages = pdfDoc.numPages;
        await task.destroy();

        await savePdfFile(id, bytes);

        const doc: ReadDocument = {
          id,
          name: file.name.replace(/\.pdf$/i, ''),
          pages,
          size: bytes.length,
          addedAt: new Date().toISOString(),
          lastPage: Math.min(existing?.lastPage || 1, pages),
          zoom: existing?.zoom || 0,
          marks: existing?.marks || [],
          folder: assignedFolder,
          sourceId: undefined,
          sourcePath,
          sourceModified: undefined,
        };

        try { if (existing) updateReadDocument(id, { ...doc, addedAt: existing.addedAt }); else addReadDocument(doc); } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') throw error;
          // Cached previews must never prevent the document metadata from being saved.
          useStore.setState(state => ({ readDocuments: state.readDocuments.map(item => ({ ...item, thumbnail: undefined })) }));
        }
        successCount++;
      } catch (err) {
        failures.push(`${file.name}: ${err instanceof Error ? err.message : 'Import failed'}`);
      }
    }

    setImporting(false);
    setImportStatus('');
    if (failures.length) setError(`${successCount} imported, ${failures.length} failed. ${failures.join('; ')}`);
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      importFiles(Array.from(e.target.files), false);
    }
    e.target.value = '';
  };

  const pickFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<SourceDirectory> }).showDirectoryPicker;
    if (!picker) { folderInput.current?.click(); return; }
    try {
      const root = await picker();
      const files: File[] = [], directories: string[] = [];
      const visit = async (directory: SourceDirectory, path: string) => {
        directories.push(path);
        for await (const entry of directory.values()) {
          if (entry.kind === 'directory' && entry.values) await visit(entry as SourceDirectory, `${path}/${entry.name}`);
          else if (entry.kind === 'file' && entry.getFile && /\.pdf$/i.test(entry.name)) {
            const file = await entry.getFile();
            Object.defineProperty(file, 'webkitRelativePath', { value: `${path}/${entry.name}` });
            files.push(file);
          }
        }
      };
      await visit(root, root.name);
      await importFiles(files, true, directories);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError(error instanceof Error ? error.message : String(error));
    }
  };
  const onFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) void importFiles(Array.from(e.target.files), true);
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) importFiles(files, false);
  };

  const doDeleteDoc = async (id: string) => {
    removeReadDocument(id);
    try { await deletePdfFile(id); } catch { /* ignore */ }
    setConfirmDeleteDoc(null);
  };

  /* ── Folder creation & modal helpers ── */
  const openCreateFolder = () => {
    setFolderFormError('');
    setEditingFolder({
      originalPath: null,
      name: '',
      color: colors[0],
    });
  };

  const openEditFolder = (subFullPath: string, subName: string, color: string) => {
    setFolderFormError('');
    setEditingFolder({
      originalPath: subFullPath,
      name: subName,
      color,
    });
  };

  const handleFolderFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFolder) return;
    const trimmed = editingFolder.name.trim();
    if (!trimmed) {
      setFolderFormError('Please enter a folder name.');
      return;
    }

    if (editingFolder.originalPath === null) {
      // Create new folder
      const newFullPath = currentPath ? `${currentPath}/${trimmed}` : trimmed;
      if (readFolders.includes(newFullPath)) {
        setFolderFormError('A folder with this name already exists.');
        return;
      }
      addReadFolder(newFullPath, editingFolder.color);
    } else {
      // Rename existing folder
      const newFullPath = currentPath ? `${currentPath}/${trimmed}` : trimmed;
      if (newFullPath !== editingFolder.originalPath && readFolders.includes(newFullPath)) {
        setFolderFormError('A folder with this name already exists.');
        return;
      }
      customizeReadFolder(editingFolder.originalPath, newFullPath, editingFolder.color);
    }
    setEditingFolder(null);
  };

  const handleDeleteFolder = (fullPath: string) => {
    setRemoveFolder(fullPath);
    setEditingFolder(null);
  };

  return (
    <div
      className="reader-home"
      ref={dragRef}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {removeFolder && <RemoveFolderSheet path={removeFolder} onClose={() => setRemoveFolder(null)} onRemoved={() => {
        if (currentPath === removeFolder || currentPath.startsWith(`${removeFolder}/`)) onSelectFolder(removeFolder.split('/').slice(0, -1).join('/') || 'All');
        setRemoveFolder(null);
      }}/>}
      {driveOpen && <GoogleDriveSheet basePath={currentPath} onClose={() => setDriveOpen(false)} onBusy={busy => { driveBusy.current = busy; }}/>}
      {/* Explorer Breadcrumb & Actions Bar */}
      <div className="reader-explorer-bar">
        <div className="reader-location-heading">
        {currentPath ? (
          <nav className="reader-breadcrumb-nav" aria-label="Folder path">
            <button
              className="breadcrumb-btn"
              onClick={() => onSelectFolder('All')}
              title="Back to all folders"
            >
              <Icon name="folder" size={16} />
              <span>Library</span>
            </button>
            {pathSegments.map((segment, idx) => {
              const segmentPath = pathSegments.slice(0, idx + 1).join('/');
              const isLast = idx === pathSegments.length - 1;
              return (
                <span key={segmentPath} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span className="breadcrumb-sep">›</span>
                  <button
                    className={`breadcrumb-btn ${isLast ? 'active' : ''}`}
                    onClick={() => onSelectFolder(segmentPath)}
                    disabled={isLast}
                    title={segment}
                  >
                    <span>{segment}</span>
                  </button>
                </span>
              );
            })}
          </nav>
        ) : (
          <div className="folder-home-heading" style={{ margin: 0 }}>
            <div className="reader-folder-title">
              <h2>Document folders</h2>

            </div>
          </div>
        )}

        {connectedRoots.some(root => !currentPath || root === currentPath || currentPath.startsWith(`${root}/`) || root.startsWith(`${currentPath}/`)) && (
          <button className={`reader-refresh-button ${syncing ? 'is-syncing' : ''}`} aria-label="Refresh connected folders" title="Refresh connected folders" disabled={syncing || importing} onClick={() => void refreshSources()}>
            <Icon name="repeat" size={22}/>
          </button>
        )}
        </div>

        <div className="reader-header-actions" ref={headerActions}>
          {importing && <span className="reader-import-status" role="status">{importStatus || 'Importing...'}</span>}
          {selectMode && <button className="text-button" onClick={exitSelectMode}>Cancel selection</button>}
          <button className="new-folder-button reader-add-button" aria-label="Add to library" aria-expanded={headerMenu === 'add'} aria-controls="reader-add-menu" disabled={importing || syncing} onClick={() => setHeaderMenu(headerMenu === 'add' ? null : 'add')}>
            <Icon name="plus" size={18}/> Add
          </button>
          <button className="icon-button reader-more-button" aria-label="More library actions" aria-expanded={headerMenu === 'more'} aria-controls="reader-more-menu" onClick={() => setHeaderMenu(headerMenu === 'more' ? null : 'more')}>
            <Icon name="more" size={20}/>
          </button>
          {headerMenu === 'add' && <div className="reader-header-menu" id="reader-add-menu" role="group" aria-label="Add to library" onClick={() => setHeaderMenu(null)}>
            <button onClick={() => setDriveOpen(true)}><Icon name="folder" size={18}/>Google Drive</button>
            <button onClick={() => fileInput.current?.click()}><Icon name="read" size={18}/>Import PDF</button>
            <button onClick={() => void pickFolder()}><Icon name="folder" size={18}/>Import folder</button>
            <button onClick={openCreateFolder}><Icon name="plus" size={18}/>New folder</button>
          </div>}
          {headerMenu === 'more' && <div className="reader-header-menu" id="reader-more-menu" role="group" aria-label="More library actions" onClick={() => setHeaderMenu(null)}>
            {currentPath && <button disabled={importing} onClick={() => setRemoveFolder(currentPath)}><Icon name="trash" size={18}/>Remove this folder</button>}
            <button disabled={!visibleDocs.length} onClick={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}><Icon name="checkbox" size={18}/>{selectMode ? 'Cancel selection' : 'Select documents'}</button>
            <button disabled={syncing || importing} onClick={() => setDriveOpen(true)}><Icon name="folder" size={18}/>Google Drive</button>
          </div>}

          <input
            ref={fileInput}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            hidden
            onChange={onFileChange}
            aria-label="PDF file input"
            data-testid="pdf-file-input"
          />

          <input
            ref={folderInput}
            type="file"
            /* @ts-expect-error webkitdirectory is standard for folder picker */
            webkitdirectory=""
            directory=""
            multiple
            hidden
            onChange={onFolderChange}
            aria-label="PDF folder input"
            data-testid="pdf-folder-input"
          />
        </div>
      </div>

      <nav className="reader-shelves" aria-label="Document collections">
        {(['Library', 'Recent', 'Favourite', 'To Read'] as const).map(name => (
          <button key={name} aria-pressed={shelf === name} onClick={() => {
            setShelf(name);
            exitSelectMode();
          }}>{name}</button>
        ))}
      </nav>

      {shelf !== 'Library' && visibleDocs.length === 0 && !importing && (
        <p className="reader-shelf-empty">{shelf === 'Recent' ? 'No reading history yet' : shelf === 'Favourite' ? 'No favourites yet' : 'Nothing in To Read yet'}</p>
      )}

      {error && <p className="reader-error" role="alert">{error}{driveAction && <button className="text-button" onClick={() => setDriveOpen(true)}>{driveAction}</button>}</p>}

      {/* ── Subfolders Grid (Xiaomi Artwork) ── */}
      {shelf === 'Library' && directSubfolders.length > 0 && (
        <div className="reader-subfolders-wrap">
          {currentPath && (
            <div className="reader-section-header">
              <h3 className="reader-section-title">Folders</h3>
              <span className="reader-count-pill">{directSubfolders.length}</span>
            </div>
          )}
          <div className="folder-grid">
            {directSubfolders.map((subName, index) => {
              const { subFullPath, docCount } = getSubfolderStats(subName);
              const color = readFolderColors[subFullPath] || readFolderColors[subName] || colors[index % colors.length];

              return (
                <article className="folder-tile" key={subFullPath}>
                  <button
                    className="folder-open"
                    aria-label={subName}
                    onClick={() => onSelectFolder(subFullPath)}
                  >
                    <FolderArtwork color={color} />
                    <span className="folder-label">{subName}</span>
                    <span className="folder-count">
                      {docCount} {docCount === 1 ? 'document' : 'documents'}
                    </span>
                  </button>
                  <IconButton icon="trash" label={`Remove folder ${subName}`} className="reader-folder-remove" disabled={importing} onClick={() => setRemoveFolder(subFullPath)}/>
                  <IconButton
                    icon="more"
                    label={`Options for ${subName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditFolder(subFullPath, subName, color);
                    }}
                  />
                </article>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Documents Grid ── */}
      {visibleDocs.length > 0 && (
        <div className="reader-docs-wrap">
          {(directSubfolders.length > 0 || currentPath) && (
            <div className="reader-section-header">
              <h3 className="reader-section-title">{shelf === 'Library' ? 'Documents' : shelf}</h3>
              <span className="reader-count-pill">{visibleDocs.length}</span>
            </div>
          )}
          <div className="pdf-grid" role="list">
            {visibleDocs.map(doc => (
              <div
                className={`pdf-card ${selectMode && selectedIds.has(doc.id) ? 'selected' : ''}`}
                key={doc.id}
                role="listitem"
              >
                <button
                  className="pdf-card-main"
                  onClick={() => {
                    if (selectMode) { toggleSelect(doc.id); return; }
                    updateReadDocument(doc.id, { lastOpenedAt: new Date().toISOString() });
                    onOpen(doc.id);
                  }}
                  aria-label={`${selectMode ? 'Select' : 'Open'} ${doc.name}`}
                  data-testid={`pdf-card-${doc.id}`}
                >
                  <div className="pdf-thumb">
                    <DocumentThumbnail key={`${doc.id}:${doc.sourceModified || 0}`} id={doc.id} name={doc.name} legacy={doc.thumbnail}/>
                    {selectMode && (
                      <div className={`pdf-select-check ${selectedIds.has(doc.id) ? 'checked' : ''}`}>
                        {selectedIds.has(doc.id) && <Icon name="check" size={14} />}
                      </div>
                    )}
                  </div>
                  <div className="pdf-card-info">
                    <h3 className="pdf-card-name" title={doc.name}>{doc.name}</h3>
                    <span className="pdf-page-count">{doc.pages} {doc.pages === 1 ? 'page' : 'pages'}</span>
                  </div>
                </button>
                {!selectMode && (
                  <>
                    <div className="pdf-shelf-actions">
                      <button aria-label={`${doc.favourite ? 'Remove' : 'Add'} ${doc.name} ${doc.favourite ? 'from' : 'to'} Favourite`} aria-pressed={!!doc.favourite}
                        onClick={() => updateReadDocument(doc.id, { favourite: !doc.favourite })}>Favourite</button>
                      <button aria-label={`${doc.toRead ? 'Remove' : 'Add'} ${doc.name} ${doc.toRead ? 'from' : 'to'} To Read`} aria-pressed={!!doc.toRead}
                        onClick={() => updateReadDocument(doc.id, { toRead: !doc.toRead })}>To Read</button>
                    </div>
                    <IconButton
                      icon="trash"
                      label={`Delete ${doc.name}`}
                      className="pdf-card-delete"
                      onClick={() => setConfirmDeleteDoc(doc.id)}
                    />
                    {confirmDeleteDoc === doc.id && (
                      <div className="pdf-delete-confirm">
                        <p>Remove "{doc.name}"?</p>
                        <div>
                          <button className="text-button" onClick={() => setConfirmDeleteDoc(null)}>Cancel</button>
                          <button className="accent-button danger-accent" onClick={() => doDeleteDoc(doc.id)}>Remove</button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {shelf === 'Library' && directSubfolders.length === 0 && directDocs.length === 0 && !importing && (
        <div
          className={`reader-empty ${dragging ? 'dragging' : ''}`}
          onClick={() => fileInput.current?.click()}
          role="button"
          tabIndex={0}
        >
          <div className="reader-empty-icon-wrap">
            <Icon name="keyboard" size={44} />
          </div>
          <h3>Keyboard shortcuts</h3>
          <div className="reader-shortcuts" onClick={e => e.stopPropagation()}>
            <div><kbd>T</kbd><span>Open tools</span></div>
            <div><kbd>F</kbd><span>Toggle fullscreen</span></div>
            <div><kbd>H</kbd><span>Highlight</span></div>
            <div><kbd>P</kbd><span>Pen</span></div>
            <div><kbd>G</kbd><span>Move annotations</span></div>
            <div><kbd>Ctrl</kbd><span>+ scroll to zoom</span></div>
          </div>
        </div>
      )}

      {/* Drop overlay */}
      {dragging && (
        <div className="reader-drop-overlay">
          <Icon name="read" size={48} />
          <p>Drop to import PDF into {currentPath || 'Library'}</p>
        </div>
      )}

      {/* ── Batch delete bar ── */}
      {selectMode && (
        <div className="reader-select-bar">
          <span className="reader-select-count">
            {selectedIds.size} selected
          </span>
          <div className="reader-select-actions">
            <button
              className="text-button"
              onClick={exitSelectMode}
            >
              Cancel
            </button>
            <button
              className="accent-button danger-accent"
              disabled={selectedIds.size === 0}
              onClick={deleteSelected}
            >
              <Icon name="trash" size={16} />
              Delete {selectedIds.size > 0 ? selectedIds.size : ''}
            </button>
          </div>
        </div>
      )}

      {/* ── Floating Action Button (FAB) matching Image 3 ── */}


      {/* ── Xiaomi Folder Sheet Modal ── */}
      {editingFolder && (
        <Sheet
          title={editingFolder.originalPath === null ? "New folder" : "Customize folder"}
          onClose={() => setEditingFolder(null)}
        >
          <form onSubmit={handleFolderFormSubmit} className="folder-form">
            <label className="field">
              Folder label
              <input
                autoFocus
                aria-label="Folder label"
                maxLength={80}
                value={editingFolder.name}
                onChange={(e) => {
                  setEditingFolder({ ...editingFolder, name: e.target.value });
                  setFolderFormError("");
                }}
                required
              />
            </label>
            <fieldset className="folder-colors">
              <legend>Folder color</legend>
              {colors.map((color) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`Folder color ${color}`}
                  aria-pressed={editingFolder.color === color}
                  className={editingFolder.color === color ? "active" : ""}
                  style={{ background: color }}
                  onClick={() => setEditingFolder({ ...editingFolder, color })}
                />
              ))}
            </fieldset>
            {folderFormError && <p className="error" role="alert">{folderFormError}</p>}
            <div className="form-actions">
              {editingFolder.originalPath !== null && (
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() => handleDeleteFolder(editingFolder.originalPath!)}
                >
                  Delete folder
                </button>
              )}
              <button className="accent-button" type="submit">
                {editingFolder.originalPath === null ? "Create folder" : "Save"}
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}
