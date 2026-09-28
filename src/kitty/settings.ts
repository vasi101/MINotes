import { create } from "zustand";
import { persist } from "zustand/middleware";

export type KittySettings = {
  aiMode: "local" | "cloud";
  cloudModel: string;
  webSearch: boolean;
  askOnSelection: boolean;
  model: string;
  translationModel: string;
  keepWarmMinutes: number;
  targetLanguage: "en" | "ne";
};
export const useKittySettings = create<
  KittySettings & { update: (patch: Partial<KittySettings>) => void }
>()(
  persist(
    (set) => ({
      aiMode: "local",
      cloudModel: "gpt-5-mini",
      webSearch: false,
      askOnSelection: true,
      model: "",
      translationModel: "",
      keepWarmMinutes: 10,
      targetLanguage: "ne",
      update: (patch) => set(patch),
    }),
    { name: "minotes-kitty-settings-v1" },
  ),
);
