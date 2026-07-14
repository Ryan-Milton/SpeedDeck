// Zustand store holding the latest live telemetry pushed from the Rust backend
// on the `vehicle:state` event. The CarPlay surfaces (Maps, Dashboard) read
// from here in later phases.

import { create } from "zustand";
import type { ReceiverHealth, TripStatus, VehicleState } from "../lib/ipc";

interface VehicleStore {
  state: VehicleState | null;
  health: ReceiverHealth | null;
  latestSequence: number;
  tripStatus: TripStatus;
  setState: (state: VehicleState) => void;
  setHealth: (health: ReceiverHealth) => void;
  setTripStatus: (status: TripStatus) => void;
}

export const useVehicleStore = create<VehicleStore>((set) => ({
  state: null,
  health: null,
  latestSequence: 0,
  tripStatus: "idle",
  setState: (state) =>
    set((current) => {
      if (state.sequence <= current.latestSequence) return {};
      return {
        state,
        health: {
          sequence: state.sequence,
          source: state.source,
          status: state.receiverStatus,
        },
        latestSequence: state.sequence,
        tripStatus: state.tripStatus,
      };
    }),
  setHealth: (health) =>
    set((current) =>
      health.sequence > current.latestSequence
        ? { health, state: null, latestSequence: health.sequence }
        : {}
    ),
  setTripStatus: (tripStatus) => set({ tripStatus }),
}));
