let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('minotes-pdf-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
let handleDatabase: Promise<IDBDatabase> | undefined;
function openHandleDatabase() {
  return handleDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('minotes-directory-handles', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { handleDatabase = undefined; reject(request.error); };
  });
}
export async function savePdfFile(id: string, bytes: Uint8Array) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(bytes, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
export async function getPdfFile(id: string): Promise<Uint8Array> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id);
    request.onsuccess = () => request.result ? resolve(request.result) : reject(new Error('This PDF file is missing from this browser. Import it again.'));
    request.onerror = () => reject(request.error);
  });
}
export async function deletePdfFile(id: string) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete(id);
    tx.objectStore('files').delete(`thumbnail:${id}`);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

export async function deleteAllPdfFiles() {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPdfThumbnail(id: string): Promise<Blob | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(`thumbnail:${id}`);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function savePdfThumbnail(id: string, blob: Blob) {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(blob, `thumbnail:${id}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function saveDirectoryHandle(id: string, handle: unknown) {
  const db = await openHandleDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('directory-handles').put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDirectoryHandles() {
  const db = await openHandleDatabase();
  return new Promise<Array<{ id: string; handle: unknown }>>((resolve, reject) => {
    const request = db.transaction('handles').objectStore('handles').openCursor();
    const handles: Array<{ id: string; handle: FileSystemDirectoryHandle }> = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(handles);
      handles.push({ id: String(cursor.key), handle: cursor.value });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
