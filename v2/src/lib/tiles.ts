// IPC bindings for the offline-map / tile-downloader backend (maps module).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}
export interface TileEstimate {
  tileCount: number;
  estimatedSizeMb: number;
}
export interface DownloadProgress {
  downloaded: number;
  total: number;
  percent: number;
  active: boolean;
}
export interface RegionInfo {
  id: string;
  name: string;
  file: string;
  installed: boolean;
}

export const tiles = {
  listRegions: () => invoke<RegionInfo[]>("list_regions"),
  estimate: (bbox: BBox, minZoom: number, maxZoom: number) =>
    invoke<TileEstimate>("estimate_tile_download", { bbox, minZoom, maxZoom }),
  start: (bbox: BBox, minZoom: number, maxZoom: number) =>
    invoke<void>("start_tile_download", { bbox, minZoom, maxZoom }),
  cancel: () => invoke<void>("cancel_tile_download"),
  progress: () => invoke<DownloadProgress>("download_progress"),
  exist: () => invoke<boolean>("tiles_exist"),
  cacheSize: () => invoke<number>("cache_size"),
  deleteCache: () => invoke<void>("delete_cached_tiles"),
};

export function onDownloadProgress(cb: (p: DownloadProgress) => void): Promise<UnlistenFn> {
  return listen<DownloadProgress>("tiles:download-progress", (e) => cb(e.payload));
}
