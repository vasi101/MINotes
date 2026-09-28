import { create } from "zustand";
import { kittyRequest } from "./managedBridge";
import { useKittySettings } from "./settings";

type CloudStatus = { configured: boolean; models: string[] };
type CloudState = CloudStatus & {
  busy: boolean;
  error: string;
  refresh: () => Promise<void>;
  connect: (apiKey?: string) => Promise<boolean>;
  disconnect: () => Promise<void>;
};
export const useCloudAI = create<CloudState>((set) => ({
  configured: false,
  models: [],
  busy: false,
  error: "",
  refresh: async () => {
    try {
      set({ ...(await kittyRequest<CloudStatus>("cloud-status")), error: "" });
    } catch {
      set({
        error: "Could not check Cloud AI. Restart the app and try again.",
      });
    }
  },
  connect: async (apiKey) => {
    set({ busy: true, error: "" });
    try {
      const status = await kittyRequest<CloudStatus>(
        "cloud-connect",
        apiKey ? { apiKey } : {},
      );
      set(status);
      if (
        status.models.length &&
        !status.models.includes(useKittySettings.getState().cloudModel)
      ) {
        useKittySettings
          .getState()
          .update({
            cloudModel: status.models.includes("gpt-4.1-mini")
              ? "gpt-4.1-mini"
              : status.models[0],
          });
      }
      return true;
    } catch (error) {
      set({
        error:
          error instanceof Error
            ? error.message
            : "Could not connect Cloud AI.",
      });
      return false;
    } finally {
      set({ busy: false });
    }
  },
  disconnect: async () => {
    set({ busy: true, error: "" });
    try {
      set(await kittyRequest<CloudStatus>("cloud-disconnect"));
    } catch {
      set({ error: "Could not disconnect Cloud AI. Try again." });
    } finally {
      set({ busy: false });
    }
  },
}));
