export type CanvasPreview = { signature: string; empty: boolean; light?: Blob; dark?: Blob };
let database: Promise<IDBDatabase> | undefined;
function open() {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('minotes-previews', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('notes');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function loadPreview(id: string): Promise<CanvasPreview | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('notes').objectStore('notes').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function savePreview(id: string, preview: CanvasPreview) {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('notes', 'readwrite');
    tx.objectStore('notes').put(preview, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  window.dispatchEvent(new CustomEvent('minotes-preview', { detail: id }));
}
