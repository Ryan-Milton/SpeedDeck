// Zustand store for live vehicle/telemetry state pushed from the Rust backend.
//
// In the skeleton it only tracks the heartbeat tick. In Phase 2 this grows to
// hold the normalized VehicleSample (position, speed, heading, altitude, fix
// quality) emitted on the `vehicle:state` event from the Rust VehicleHub.

import { create } from "zustand";

export interface VehicleStore {
  // --- skeleton heartbeat (removed once real telemetry lands) ---
  tickCount: number;
  tickMessage: string;
  setTick: (count: number, message: string) => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  tickCount: 0,
  tickMessage: "",
  setTick: (tickCount, tickMessage) => set({ tickCount, tickMessage }),
}));
