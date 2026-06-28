// Map style resolution — ported from v1 lib/map-style.ts, adapted to Tauri.
//
// 3-tier fallback, best first:
//   1. Online  → Carto Dark Matter vector style (when reachable)
//   2. Cached  → in-app downloaded tiles via the `tile-cache://` protocol
//   3. Offline → bundled/downloaded PMTiles via the `tiles://` protocol
//   4. Blank dark background (always works)

import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { invoke } from "@tauri-apps/api/core";

const CARTO_DARK_STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** invoke() that resolves to null in a plain browser (no Tauri backend). */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

// Shared dark OpenMapTiles-schema layers (used by both offline + cached styles).
function darkVectorLayers(sourceId: string): maplibregl.LayerSpecification[] {
  const src = sourceId;
  return [
    { id: "background", type: "background", paint: { "background-color": "#1C1C1E" } },
    { id: "water", type: "fill", source: src, "source-layer": "water", paint: { "fill-color": "#15151f" } },
    { id: "landcover", type: "fill", source: src, "source-layer": "landcover", paint: { "fill-color": "#1a1a1f" } },
    { id: "landuse", type: "fill", source: src, "source-layer": "landuse", paint: { "fill-color": "#18181b", "fill-opacity": 0.5 } },
    { id: "road-minor", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "minor", "service", "track"], paint: { "line-color": "#222228", "line-width": 1 } },
    { id: "road-secondary", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "secondary", "tertiary"], paint: { "line-color": "#27272a", "line-width": 1.5 } },
    { id: "road-primary", type: "line", source: src, "source-layer": "transportation", filter: ["in", "class", "primary", "trunk"], paint: { "line-color": "#2d2d33", "line-width": 2 } },
    { id: "road-motorway", type: "line", source: src, "source-layer": "transportation", filter: ["==", "class", "motorway"], paint: { "line-color": "#33333a", "line-width": 3 } },
    { id: "building", type: "fill", source: src, "source-layer": "building", paint: { "fill-color": "#1c1c22", "fill-opacity": 0.6 } },
  ];
}

function buildOfflineStyle(pmtilesUrl: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    name: "Offline Dark",
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: { type: "vector", url: `pmtiles://${pmtilesUrl}` },
    },
    layers: darkVectorLayers("openmaptiles"),
  };
}

const CACHED_TILE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: "Cached Dark",
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    cache: { type: "vector", tiles: ["tile-cache://tiles/{z}/{x}/{y}.mvt"], maxzoom: 16 },
  },
  layers: darkVectorLayers("cache"),
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

export async function resolveMapStyle(): Promise<string | maplibregl.StyleSpecification> {
  // 1. Online
  const online = await checkOnlineStyle();
  if (online) return online;

  // 2. In-app cached tiles
  const cached = await safeInvoke<boolean>("tiles_exist");
  if (cached) return CACHED_TILE_STYLE;

  // 3. Bundled / downloaded PMTiles. Backend returns a `tiles://…` URL or null.
  const pmtilesUrl = await safeInvoke<string | null>("default_pmtiles_url");
  if (pmtilesUrl) {
    ensurePmtilesProtocol();
    return buildOfflineStyle(pmtilesUrl);
  }

  // 4. Blank
  return DARK_FALLBACK;
}
