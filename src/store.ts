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
};
export type Task = {
  id: string;
  title: string;
  completed: boolean;
  reminder: string;
  repeat: string;
};
const seeds = [
  ["This is not good as hell", "FILLING WITH THE STOCK", "9:03 AM"],
  ["legitimate interests of citizens.”", "", "Yesterday 3:59 PM"],
  ["Bhadra 26", "Public service delivery", "Yesterday 12:54 PM"],
  ["prudent", "", "Yesterday 12:05 PM"],
  ["Eternal Sunshine of the Spotless Mind", "", "Yesterday 9:08 AM"],
  ["TRANSPARANCY", "Fish in flood -", "September 3"],
];
type State = {
  readDocuments: ReadDocument[];
  addReadDocument: (document:ReadDocument)=>void;
  updateReadDocument: (id:string,patch:Partial<ReadDocument>)=>void;
  removeReadDocument: (id:string)=>void;
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
      notes: seeds.map(([title, preview, date], i) => ({
        id: `note-${i}`,
        title,
        preview,
        html: preview ? `<p>${preview}</p>` : "",
        date,
        folder: i === 2 ? "Excerpts" : "ANSWER IDEAS",
      })),
      tasks: [
        {
          id: "task-1",
          title: "Code of Conduct",
          completed: false,
          reminder: "",
          repeat: "",
        },
        {
          id: "task-2",
          title: "Test",
          completed: false,
          reminder: "2026-09-06T14:24",
          repeat: "every day",
        },
        {
          id: "task-3",
          title: "POLICY",
          completed: false,
          reminder: "",
          repeat: "",
        },
      ],
      folders: ["ANSWER IDEAS", "Excerpts", "Rishi Expensive"],
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
