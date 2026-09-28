import { create } from "zustand";
import { kittyRequest, type RuntimeEvent } from "./managedBridge";
export type KittyModel = {
  id: string;
  displayName: string;
  description: string;
  sizeBytes: number;
  model: string;
  quantization: string;
  contextSize: number;
  licenseUrl: string;
};
export type Hardware = {
  ramGB: number;
  availableRamGB: number;
  cpu: string;
  cores: number;
  architecture: string;
  os: string;
  diskFreeBytes: number;
  gpus: {
    name: string;
    vendor: string;
    vramGB: number | null;
    shared: boolean;
  }[];
};
type Installed = KittyModel & {
  backend: string;
  path: string;
  external?: boolean;
};
type Status = {
  installed: Installed | null;
  progress: RuntimeEvent;
  busy: boolean;
  partials: { modelId: string; completed: number; total: number }[];
  loaded: boolean;
  models: KittyModel[];
};
type Analysis = {
  hardware: Hardware;
  recommendedId: string | null;
  compatibleIds: string[];
  reason: string;
  models: KittyModel[];
};
let installController: AbortController | undefined;
type SetupState = {
  status?: Status;
  analysis?: Analysis;
  selected: string;
  checking: boolean;
  installing: boolean;
  error: string;
  progress?: RuntimeEvent;
  choose: (id: string) => void;
  refresh: () => Promise<void>;
  analyze: () => Promise<void>;
  install: () => Promise<void>;
  pause: () => void;
  remove: () => Promise<void>;
};
export const useKittySetup = create<SetupState>((set, get) => ({
  selected: "",
  checking: false,
  installing: false,
  error: "",
  choose: (selected) => set({ selected }),
  refresh: async () => {
    try {
      const status = await kittyRequest<Status>("status");
      set({
        status,
        ...(!get().installing && status.busy
          ? { progress: status.progress }
          : {}),
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Kitty is unavailable.",
      });
    }
  },
  analyze: async () => {
    set({ checking: true, error: "" });
    try {
      const analysis = await kittyRequest<Analysis>("hardware");
      set({
        analysis,
        selected:
          get().status?.partials[0]?.modelId ?? analysis.recommendedId ?? "",
      });
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Could not check this computer.",
      });
    } finally {
      set({ checking: false });
    }
  },
  install: async () => {
    if (get().installing || !get().selected) return;
    const controller = new AbortController();
    installController = controller;
    set({
      installing: true,
      error: "",
      progress: { phase: "downloading", completed: 0, total: 0 },
    });
    try {
      await kittyRequest(
        "install",
        { modelId: get().selected },
        (progress) => set({ progress }),
        controller.signal,
      );
      set({ analysis: undefined });
    } catch (error) {
      set({
        error: controller.signal.aborted
          ? ""
          : error instanceof Error
            ? error.message
            : "Setup could not finish.",
        ...(controller.signal.aborted ? { progress: { phase: "paused" } } : {}),
      });
    } finally {
      set({ installing: false });
      installController = undefined;
      await get().refresh();
    }
  },
  pause: () => installController?.abort(),
  remove: async () => {
    set({ checking: true, error: "" });
    try {
      await kittyRequest("remove");
      set({ progress: undefined, analysis: undefined });
      await get().refresh();
    } catch (error) {
      set({
        error:
          error instanceof Error ? error.message : "Could not remove local AI.",
      });
    } finally {
      set({ checking: false });
    }
  },
}));
