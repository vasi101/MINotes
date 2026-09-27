import { exportToBlob } from '@excalidraw/excalidraw';
import type { NoteScene } from './storage';
import { loadPreview, savePreview } from './previewStorage';

export const meaningfulElements = (scene: NoteScene) => scene.elements.filter(element =>
  !element.isDeleted && element.opacity > 0 && (element.width > 0 || element.height > 0) &&
  (element.type !== 'text' || element.text.trim().length > 0));
function signature(scene: NoteScene) {
  return JSON.stringify([scene.appState.viewBackgroundColor,
    scene.elements.map(e => [e.id, e.version, e.versionNonce, e.isDeleted]),
    Object.values(scene.files).map(f => [f.id, f.version, f.dataURL.length])]);
}
type Job = { scene: NoteScene; key: string; timer?: ReturnType<typeof setTimeout>; running?: Promise<void> };
const jobs = new Map<string, Job>();

export function schedulePreview(id: string, scene: NoteScene) {
  const key = signature(scene);
  let job = jobs.get(id);
  if (job?.key === key) return;
  if (job?.timer) clearTimeout(job.timer);
  if (!job) { job = { scene, key }; jobs.set(id, job); }
  job.scene = scene; job.key = key;
  job.timer = setTimeout(() => { void flushPreview(id); }, 1200);
}
export async function flushPreview(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  if (job.timer) { clearTimeout(job.timer); job.timer = undefined; }
  if (job.running) { await job.running; if (jobs.get(id) === job) await flushPreview(id); return; }
  const { key, scene } = job;
  job.running = (async () => {
    try {
      const cached = await loadPreview(id);
      if (cached?.signature === key) return;
      const elements = meaningfulElements(scene);
      if (!elements.length) {
        if (job.key === key) await savePreview(id, { signature: key, empty: true });
        return;
      }
      // The native exporter frames nondeleted content bounds, not the viewport.
      // Export both themes once; card theme changes never rerender the scene.
      const render = (dark: boolean) => exportToBlob({
        elements, files: scene.files, maxWidthOrHeight: 600, exportPadding: 24,
        mimeType: 'image/png', appState: { ...scene.appState, exportBackground: true,
          viewBackgroundColor: scene.appState.viewBackgroundColor || '#ffffff',
          exportWithDarkMode: dark, exportEmbedScene: false },
      });
      const light = await render(false);
      const dark = await render(true);
      if (job.key === key) await savePreview(id, { signature: key, empty: false, light, dark });
    } catch (error) {
      // A cache failure must never prevent scene saves or navigation.
      console.warn('Canvas preview unavailable', error);
    }
  })();
  await job.running;
  job.running = undefined;
  if (job.key === key) jobs.delete(id);
  else if (!job.timer) await flushPreview(id);
}
