// IPC bindings for navigation (nav module): routing, geocoding, OSRM status,
// and routing-pack management. Replaces v1's nav WebSocket commands.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RouteData, SearchResult } from "../types/navigation";

export interface NavStatus {
  routerRunning: boolean;
  installedRegion: string | null;
  routerError: string | null;
  port: number;
}

export interface NavRegion {
  id: string;
  name: string;
  installed: boolean;
  sizeMb: number;
}

export const nav = {
  status: () => invoke<NavStatus>("nav_status"),
  /** Calculate a route. heading/speed enable the bearing constraint on reroute. */
  calculateRoute: (
    fromLon: number,
    fromLat: number,
    toLon: number,
    toLat: number,
    heading?: number,
    speed?: number
  ) =>
    invoke<RouteData>("calculate_route", { fromLon, fromLat, toLon, toLat, heading, speed }),
  noteActivity: () => invoke<void>("nav_note_activity"),
  geocode: (query: string, nearLat?: number, nearLon?: number) =>
    invoke<SearchResult[]>("geocode_search", { query, nearLat, nearLon }),
  listRegions: () => invoke<NavRegion[]>("nav_list_regions"),
  downloadRegion: (regionId: string) => invoke<void>("nav_download_region", { regionId }),
  deleteRegion: (regionId: string) => invoke<void>("nav_delete_region", { regionId }),
};

export function onNavStatus(cb: (s: NavStatus) => void): Promise<UnlistenFn> {
  return listen<NavStatus>("nav:status", (e) => cb(e.payload));
}
