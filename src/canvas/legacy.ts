import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { Note } from '../store';
import type { NoteScene } from './storage';

// The original note fields remain intact. Import its text and image previews once.
export async function legacyScene(note: Note): Promise<NoteScene> {
  const doc = new DOMParser().parseFromString(note.html || '', 'text/html');
  const skeletons: ExcalidrawElement[] = [];
  const files: BinaryFiles = {};
  let y = 60;
  const blocks = [...doc.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre')].filter(node => !node.parentElement?.closest('li, pre'));
  for (const block of blocks) {
    const text = (block.textContent || '').trim();
    if (!text) continue;
    const heading = /^H[1-6]$/.test(block.tagName);
    const fontSize = heading ? 36 : 20;
    const elements = convertToExcalidrawElements([{ type: 'text', x: 60, y, text: (block.tagName === 'LI' ? '• ' : '') + text, fontSize }]);
    skeletons.push(...elements);
    y += elements[0].height + 20;
  }
  if (!blocks.length && note.preview) {
    const elements = convertToExcalidrawElements([{ type: 'text', x: 60, y, text: note.preview }]);
    skeletons.push(...elements); y += elements[0].height + 20;
  }
  const images = [...doc.images].map(image => image.src);
  if (note.drawingPreview) images.push(note.drawingPreview);
  for (const drawing of note.drawings || []) if (drawing.preview) images.push(drawing.preview);
  for (const dataURL of new Set(images)) {
    if (!dataURL.startsWith('data:image/')) continue;
    const image = new Image(); image.src = dataURL;
    await image.decode();
    const id = crypto.randomUUID() as BinaryFileData['id'];
    files[id] = { id, dataURL: dataURL as BinaryFileData['dataURL'], mimeType: dataURL.slice(5, dataURL.indexOf(';')) as BinaryFileData['mimeType'], created: Date.now() };
    const width = Math.min(800, image.naturalWidth), height = image.naturalHeight * width / image.naturalWidth;
    skeletons.push(...convertToExcalidrawElements([{ type: 'image', x: 60, y, width, height, fileId: id, status: 'saved' }])); y += height + 24;
  }
  return { version: 1, elements: skeletons, appState: {}, files };
}
