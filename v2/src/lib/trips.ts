// IPC bindings for trip recording + history (trips module).

import { invoke } from "@tauri-apps/api/core";

export interface TripInfo {
  id: number;
  name: string | null;
  startedAt: string;
  endedAt: string | null;
  distanceM: number;
  maxSpeed: number;
  avgSpeed: number;
}

export interface Trackpoint {
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  satellites: number | null;
  fixQuality: number | null;
  hdop: number | null;
}

export const trips = {
  list: () => invoke<TripInfo[]>("trip_list"),
  trackpoints: (tripId: number) => invoke<Trackpoint[]>("trip_trackpoints", { tripId }),
  remove: (tripId: number) => invoke<void>("trip_delete", { tripId }),
  rename: (tripId: number, name: string) => invoke<void>("trip_rename", { tripId, name }),
  exportGpx: (tripId: number) => invoke<string>("trip_export_gpx", { tripId }),
};
