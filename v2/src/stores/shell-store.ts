// Navigation state for the HUD shell. There is no Home screen: the device
// always shows a surfaced app (the head of a most-recently-used list). The
// floating dock shows the top of the MRU; the Launchpad shows every app.

import { create } from "zustand";

export type AppId =
  | "maps"
  | "music"
  | "dashboard"
  | "nowplaying"
  | "trips"
  | "phone"
  | "settings";

// Boot order (Maps surfaced first). `phone` is disabled, so it never enters
// the MRU and only appears (greyed) in the Launchpad.
const BOOT_MRU: AppId[] = ["maps", "dashboard", "music", "nowplaying", "trips", "settings"];

interface ShellStore {
  /** Most-recently-used first. `mru[0]` is the surfaced app. */
  mru: AppId[];
  launchpadOpen: boolean;
  openApp: (id: AppId) => void;
  openLaunchpad: () => void;
  closeLaunchpad: () => void;
  toggleLaunchpad: () => void;
}

export const useShellStore = create<ShellStore>((set) => ({
  mru: BOOT_MRU,
  launchpadOpen: false,
  openApp: (id) =>
    set((s) => ({
      mru: [id, ...s.mru.filter((x) => x !== id)],
      launchpadOpen: false,
    })),
  openLaunchpad: () => set({ launchpadOpen: true }),
  closeLaunchpad: () => set({ launchpadOpen: false }),
  toggleLaunchpad: () => set((s) => ({ launchpadOpen: !s.launchpadOpen })),
}));

/** The surfaced app id (head of the MRU). */
export const useActiveApp = () => useShellStore((s) => s.mru[0]);
