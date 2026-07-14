// Map camera state shared between LiveMap (detects user pans) and the
// overlays (render the recenter control). Hosts let one MapLibre canvas move
// between the Maps and Dashboard surfaces without creating a second map.

import { create } from "zustand";

export type MapHostId = "maps" | "dashboard";

interface MapStore {
  /** True while the camera chases the GPS fix; false after a manual pan/zoom. */
  following: boolean;
  setFollowing: (f: boolean) => void;
  hosts: Record<MapHostId, HTMLElement | null>;
  activeHost: MapHostId | null;
  setHost: (id: MapHostId, element: HTMLElement | null) => void;
  setActiveHost: (id: MapHostId | null) => void;
}

export const useMapStore = create<MapStore>((set) => ({
  following: true,
  setFollowing: (following) => set({ following }),
  hosts: { maps: null, dashboard: null },
  activeHost: null,
  setHost: (id, element) =>
    set((state) =>
      state.hosts[id] === element ? state : { hosts: { ...state.hosts, [id]: element } }
    ),
  setActiveHost: (activeHost) => set((state) => (state.activeHost === activeHost ? state : { activeHost })),
}));
