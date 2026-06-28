// User preferences. In-memory for now; persistence (localStorage / a Rust
// settings file) can be added later without changing call sites.

import { create } from "zustand";
import type { SpeedUnit } from "../lib/units";

export type MapOrientation = "heading-up" | "north-up";

interface SettingsStore {
  speedUnit: SpeedUnit;
  mapOrientation: MapOrientation;
  setSpeedUnit: (u: SpeedUnit) => void;
  toggleMapOrientation: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  speedUnit: "mph",
  mapOrientation: "heading-up",
  setSpeedUnit: (speedUnit) => set({ speedUnit }),
  toggleMapOrientation: () =>
    set((s) => ({
      mapOrientation: s.mapOrientation === "heading-up" ? "north-up" : "heading-up",
    })),
}));
