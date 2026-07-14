// Map style resolution — ported from v1 lib/map-style.ts, adapted to Tauri.
//
// Local-first fallback:
//   1. Offline → bundled/downloaded PMTiles via the `tiles://` protocol
//   2. Cached  → completed in-app download via the `tile-cache://` protocol
//   3. Online  → Carto Dark Matter vector style (when reachable)
//   4. Blank dark background (always works)

import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { invoke } from "@tauri-apps/api/core";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

export type MapStyleProvenance = "local-pmtiles" | "local-cache" | "online" | "blank";

export interface ResolvedMapStyle {
  style: string | maplibregl.StyleSpecification;
  provenance: MapStyleProvenance;
}

/** invoke() that resolves to null in a plain browser (no Tauri backend). */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

// Shared Protomaps basemap v4 layers (used by both offline + cached styles).
// This intentionally contains no symbol layers, glyphs, or sprites, so it remains
// fully local. Generated PMTiles and cached MVTs must use this same v4 contract.
function darkVectorLayers(sourceId: string): maplibregl.LayerSpecification[] {
  const src = sourceId;
  return [
    { id: "background", type: "background", paint: { "background-color": "#1C1C1E" } },
    { id: "earth", type: "fill", source: src, "source-layer": "earth", paint: { "fill-color": "#1a1a1f" } },
    { id: "landcover", type: "fill", source: src, "source-layer": "landcover", paint: { "fill-color": "#1b211f", "fill-opacity": 0.55 } },
    { id: "landuse", type: "fill", source: src, "source-layer": "landuse", paint: { "fill-color": "#202025", "fill-opacity": 0.45 } },
    { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": "#111c2b" } },
    { id: "road-minor", type: "line", source: src, "source-layer": "roads", filter: ["==", "kind", "minor_road"], paint: { "line-color": "#292a31", "line-width": 1 } },
    { id: "road-secondary", type: "line", source: src, "source-layer": "roads", filter: ["all", ["==", "kind", "major_road"], ["in", "kind_detail", "secondary", "secondary_link", "tertiary", "tertiary_link"]], paint: { "line-color": "#383941", "line-width": 1.5 } },
    { id: "road-primary", type: "line", source: src, "source-layer": "roads", filter: ["all", ["==", "kind", "major_road"], ["in", "kind_detail", "primary", "primary_link", "trunk", "trunk_link"]], paint: { "line-color": "#50515a", "line-width": 2 } },
    { id: "road-motorway", type: "line", source: src, "source-layer": "roads", filter: ["all", ["==", "kind", "highway"], ["in", "kind_detail", "motorway", "motorway_link"]], paint: { "line-color": "#686a74", "line-width": 3 } },
    { id: "building", type: "fill", source: src, "source-layer": "buildings", filter: ["==", "kind", "building"], paint: { "fill-color": "#25252c", "fill-opacity": 0.6 } },
  ];
}

// Carto's downloaded Streets tiles use the OpenMapTiles-style layer names. They
// are intentionally separate from bundled Protomaps archives so a completed
// cache never selects an incompatible local style.
function darkCartoVectorLayers(sourceId: string): maplibregl.LayerSpecification[] {
  const src = sourceId;
  return [
    { id: "background", type: "background", paint: { "background-color": "#1C1C1E" } },
    { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": "#111c2b" } },
    { id: "landcover", type: "fill", source: src, "source-layer": "landcover", paint: { "fill-color": "#1b211f", "fill-opacity": 0.55 } },
    { id: "landuse", type: "fill", source: src, "source-layer": "landuse", paint: { "fill-color": "#202025", "fill-opacity": 0.45 } },
    { id: "road-minor", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "minor", "service", "track"], paint: { "line-color": "#292a31", "line-width": 1 } },
    { id: "road-secondary", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "secondary", "tertiary"], paint: { "line-color": "#383941", "line-width": 1.5 } },
    { id: "road-primary", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "primary", "trunk"], paint: { "line-color": "#50515a", "line-width": 2 } },
    { id: "road-motorway", type: "line", source: src, "source-layer": "transportation", filter: ["==", "class", "motorway"], paint: { "line-color": "#686a74", "line-width": 3 } },
    { id: "building", type: "fill", source: src, "source-layer": "building", paint: { "fill-color": "#25252c", "fill-opacity": 0.6 } },
  ];
}

export function buildOfflineStyle(pmtilesUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: "Offline Dark",
    sources: {
      protomaps: { type: "vector", url: `pmtiles://${pmtilesUrl}` },
    },
    layers: darkVectorLayers("protomaps"),
  };
}

export const CACHED_TILE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "Cached Dark",
  sources: {
    cache: { type: "vector", tiles: ["tile-cache://localhost/tiles/{z}/{x}/{y}.mvt"], maxzoom: 16 },
  },
  layers: darkCartoVectorLayers("cache"),
};

const DARK_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  name: "Blank Dark",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#1C1C1E" } }],
};

let pmtilesRegistered = false;
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return;
  maplibregl.addProtocol("pmtiles", new Protocol().tile);
  pmtilesRegistered = true;
}

/** HEAD-check the online Carto style with a short timeout. */
export async function checkOnlineStyle(): Promise<string | null> {
  if (!navigator.onLine) return null;
  try {
    const resp = await fetch(CARTO_DARK_STYLE, {
      method: "HEAD",
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok ? CARTO_DARK_STYLE : null;
  } catch {
    return null;
  }
}

export async function resolveMapStyle(): Promise<ResolvedMapStyle> {
  // 1. Bundled / downloaded PMTiles. Backend returns a `tiles://…` URL or null.
  const pmtilesUrl = await safeInvoke<string | null>("default_pmtiles_url");
  if (pmtilesUrl) {
    ensurePmtilesProtocol();
    return { style: buildOfflineStyle(pmtilesUrl), provenance: "local-pmtiles" };
  }

  // 2. A cache is eligible only after its downloader writes a completion marker.
  const cached = await safeInvoke<boolean>("tiles_exist");
  if (cached) return { style: CACHED_TILE_STYLE, provenance: "local-cache" };

  // 3. Online
  const online = await checkOnlineStyle();
  if (online) return { style: online, provenance: "online" };

  // 4. Blank
  return { style: DARK_FALLBACK, provenance: "blank" };
}
