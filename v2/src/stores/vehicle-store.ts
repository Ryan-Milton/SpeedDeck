// Zustand store holding the latest live telemetry pushed from the Rust backend
// on the `vehicle:state` event. The CarPlay surfaces (Maps, Dashboard) read
// from here in later phases.

import { create } from "zustand";
import type { VehicleState } from "../lib/ipc";

interface VehicleStore {
  state: VehicleState | null;
  connected: boolean;
  setState: (state: VehicleState) => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  state: null,
  connected: false,
  setState: (state) => set({ state, connected: true }),
}));
