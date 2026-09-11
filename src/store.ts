import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReadDocument } from './reader/types';
export type Stroke = {
  id: string;
  points: number[];
  color: string;
  width: number;
  opacity: number;
  tool: string;
};
export type DrawingImage = {
  id: string;
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};
export type Drawing = { strokes: Stroke[]; images: DrawingImage[] };
export type DrawingPage = {
  id: string;
  drawing: Drawing;
  preview?: string;
  width: number;
  height: number;
  displayWidth?: number;
};
export type Note = {
  id: string;
  title: string;
  html: string;
  preview: string;
  folder: string;
  date: string;
  pinned?: boolean;
  deleted?: boolean;
  drawing?: Drawing;
  drawingPreview?: string;
  drawingEmbedded?: boolean;
  drawingWidth?: number;
  drawings?: DrawingPage[];
};
export type Task = {
  id: string;
  title: string;
  completed: boolean;
  reminder: string;
  repeat: string;
};
type State = {
  readDocuments: ReadDocument[];
  addReadDocument: (document:ReadDocument)=>void;
  updateReadDocument: (id:string,patch:Partial<ReadDocument>)=>void;
  removeReadDocument: (id:string)=>void;
  clearReadLibrary: () => void;
  readFolders: string[];
  readFolderColors: Record<string, string>;
  addReadFolder: (name: string, color?: string) => void;
  customizeReadFolder: (oldName: string, name: string, color: string) => void;
  deleteReadFolder: (name: string) => void;
  notes: Note[];
  tasks: Task[];
  folders: string[];
  folderColors: Record<string, string>;
  theme: "dark" | "light";
  updateNote: (id: string, patch: Partial<Note>) => void;
  addNote: (folder?: string) => string;
  saveTask: (task: Task) => void;
  deleteTask: (id: string) => void;
  addFolder: (name: string, color?: string) => void;
  customizeFolder: (oldName: string, name: string, color: string) => void;
  setTheme: (theme: "dark" | "light") => void;
};
export const useStore = create<State>()(
  persist(
    (set) => ({
      readDocuments: [],
      addReadDocument: document=>set(s=>({readDocuments:[document,...s.readDocuments]})),
      updateReadDocument: (id,patch)=>set(s=>({readDocuments:s.readDocuments.map(doc=>doc.id===id?{...doc,...patch}:doc)})),
      removeReadDocument: id=>set(s=>({readDocuments:s.readDocuments.filter(doc=>doc.id!==id)})),
      clearReadLibrary: () => set({ readDocuments: [], readFolders: [], readFolderColors: {} }),
      readFolders: [],
      readFolderColors: {},
      addReadFolder: (name, color) =>
        set((s) => ({
          readFolders: s.readFolders.includes(name) ? s.readFolders : [...s.readFolders, name],
          readFolderColors: color ? { ...s.readFolderColors, [name]: color } : s.readFolderColors,
        })),
      customizeReadFolder: (oldName, name, color) =>
        set((s) => {
          if (!s.readFolders.includes(oldName) || !name.trim() || (name !== oldName && s.readFolders.includes(name))) return s;
          const readFolderColors = { ...s.readFolderColors };
          delete readFolderColors[oldName];
          readFolderColors[name] = color;
          const renamePath = (p: string) => {
            if (p === oldName) return name;
            if (p.startsWith(oldName + '/')) return name + p.slice(oldName.length);
            return p;
          };
          return {
            readFolders: s.readFolders.map(renamePath),
            readFolderColors,
            readDocuments: s.readDocuments.map(d => d.folder ? { ...d, folder: renamePath(d.folder) } : d),
          };
        }),
      deleteReadFolder: (name) =>
        set((s) => {
          const readFolderColors = { ...s.readFolderColors };
          Object.keys(readFolderColors).forEach(k => {
            if (k === name || k.startsWith(name + '/')) delete readFolderColors[k];
          });
          const isDeleted = (p: string) => p === name || p.startsWith(name + '/');
          return {
            readFolders: s.readFolders.filter(f => !isDeleted(f)),
            readFolderColors,
            readDocuments: s.readDocuments.map(d => (d.folder && isDeleted(d.folder)) ? { ...d, folder: undefined } : d),
          };
        }),
      notes: [],
      tasks: [],
      folders: [],
      folderColors: {},
      theme: "dark",
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
        })),
      addNote: (folder = "") => {
        const id = crypto.randomUUID();
        set((s) => ({
          notes: [
            {
              id,
              title: "",
              html: "",
              preview: "",
              folder,
              date: new Date().toISOString(),
            },
            ...s.notes,
          ],
        }));
        return id;
      },
      saveTask: (task) =>
        set((s) => ({
          tasks: s.tasks.some((t) => t.id === task.id)
            ? s.tasks.map((t) => (t.id === task.id ? task : t))
            : [...s.tasks, task],
        })),
      deleteTask: (id) =>
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
      addFolder: (name, color) =>
        set((s) => ({
          folders: s.folders.includes(name) ? s.folders : [...s.folders, name],
          folderColors: color
            ? { ...s.folderColors, [name]: color }
            : s.folderColors,
        })),
      customizeFolder: (oldName, name, color) =>
        set((s) => {
          if (
            !s.folders.includes(oldName) ||
            !name.trim() ||
            (name !== oldName && s.folders.includes(name))
          )
            return s;
          const folderColors = { ...s.folderColors };
          delete folderColors[oldName];
          folderColors[name] = color;
          return {
            folders: s.folders.map((f) => (f === oldName ? name : f)),
            folderColors,
            notes: s.notes.map((n) =>
              n.folder === oldName ? { ...n, folder: name } : n,
            ),
          };
        }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: "minotes-v1" },
  ),
);
export function dateLabel(date: string) {
  return !/^\d{4}-\d{2}-\d{2}T/.test(date) || Number.isNaN(Date.parse(date))
    ? date
    : new Date(date).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
      }) +
        "  " +
        new Date(date).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        });
}
