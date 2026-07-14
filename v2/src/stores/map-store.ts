// Map camera state shared between LiveMap (detects user pans) and the
// overlays (render the recenter control).

import { create } from "zustand";

interface MapStore {
  /** True while the camera chases the GPS fix; false after a manual pan/zoom. */
  following: boolean;
  setFollowing: (f: boolean) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  following: true,
  setFollowing: (following) => set({ following }),
}));
