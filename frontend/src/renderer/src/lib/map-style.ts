import maplibregl from 'maplibre-gl'
import { Protocol } from 'pmtiles'

const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const DARK_FALLBACK: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111114' } }
  ]
}

const OFFLINE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Offline Dark',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'pmtiles://local-resource://map/basemap.pmtiles'
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111114' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#1a1a2e' } },
    { id: 'landcover', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', paint: { 'fill-color': '#1a1a1f' } },
    { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', paint: { 'fill-color': '#18181b', 'fill-opacity': 0.5 } },
    { id: 'road-minor', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['in', 'class', 'minor', 'service', 'track'], paint: { 'line-color': '#222228', 'line-width': 1 } },
    { id: 'road-secondary', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['in', 'class', 'secondary', 'tertiary'], paint: { 'line-color': '#27272a', 'line-width': 1.5 } },
    { id: 'road-primary', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['in', 'class', 'primary', 'trunk'], paint: { 'line-color': '#2d2d33', 'line-width': 2 } },
    { id: 'road-motorway', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', 'class', 'motorway'], paint: { 'line-color': '#33333a', 'line-width': 3 } },
    { id: 'building', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', paint: { 'fill-color': '#1c1c22', 'fill-opacity': 0.6 } }
  ]
}

let pmtilesRegistered = false
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  pmtilesRegistered = true
}

// Dark style for cached tiles (downloaded via in-app downloader)
const CACHED_TILE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Cached Dark',
  sources: {
    carto: {
      type: 'vector',
      tiles: ['tile-cache:///{z}/{x}/{y}.mvt'],
      maxzoom: 16
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#111114' } },
    { id: 'water', type: 'fill', source: 'carto', 'source-layer': 'water', paint: { 'fill-color': '#1a1a2e' } },
    { id: 'landcover', type: 'fill', source: 'carto', 'source-layer': 'landcover', paint: { 'fill-color': '#1a1a1f' } },
    { id: 'landuse', type: 'fill', source: 'carto', 'source-layer': 'landuse', paint: { 'fill-color': '#18181b', 'fill-opacity': 0.5 } },
    { id: 'road-minor', type: 'line', source: 'carto', 'source-layer': 'transportation', filter: ['in', 'class', 'minor', 'service', 'track'], paint: { 'line-color': '#222228', 'line-width': 1 } },
    { id: 'road-secondary', type: 'line', source: 'carto', 'source-layer': 'transportation', filter: ['in', 'class', 'secondary', 'tertiary'], paint: { 'line-color': '#27272a', 'line-width': 1.5 } },
    { id: 'road-primary', type: 'line', source: 'carto', 'source-layer': 'transportation', filter: ['in', 'class', 'primary', 'trunk'], paint: { 'line-color': '#2d2d33', 'line-width': 2 } },
    { id: 'road-motorway', type: 'line', source: 'carto', 'source-layer': 'transportation', filter: ['==', 'class', 'motorway'], paint: { 'line-color': '#33333a', 'line-width': 3 } },
    { id: 'building', type: 'fill', source: 'carto', 'source-layer': 'building', paint: { 'fill-color': '#1c1c22', 'fill-opacity': 0.6 } }
  ]
}

export async function resolveMapStyle(): Promise<string | maplibregl.StyleSpecification> {
  // 1. Online → Carto Dark Matter
  if (navigator.onLine) {
    try {
      const resp = await fetch(CARTO_DARK_STYLE, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
      if (resp.ok) return CARTO_DARK_STYLE
    } catch { /* not online */ }
  }

  // 2. Cached tiles from in-app download
  try {
    const hasCached = await window.api.checkTilesExist()
    if (hasCached) return CACHED_TILE_STYLE
  } catch { /* preload API may not be available */ }

  // 3. Bundled PMTiles
  try {
    const resp = await fetch('local-resource://map/basemap.pmtiles', {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000)
    })
    if (resp.ok) {
      ensurePmtilesProtocol()
      return OFFLINE_STYLE
    }
  } catch { /* no local tiles */ }

  // 4. Fallback
  return DARK_FALLBACK
}

export function speedToColor(ratio: number): string {
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255)
  return `rgb(${r}, ${g}, 40)`
}
