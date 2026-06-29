// Navigation state for the CarPlay shell: which surface is on screen.

import { create } from "zustand";

export type AppId =
  | "maps"
  | "music"
  | "dashboard"
  | "nowplaying"
  | "trips"
  | "phone"
  | "settings";

interface ShellStore {
  /** `null` = the home grid; otherwise the open app. */
  activeApp: AppId | null;
  openApp: (id: AppId) => void;
  goHome: () => void;
}

export const useShellStore = create<ShellStore>((set) => ({
  activeApp: null,
  openApp: (id) => set({ activeApp: id }),
  goHome: () => set({ activeApp: null }),
}));
