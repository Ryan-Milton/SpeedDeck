import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Protocol } from 'pmtiles'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { haversineDistance } from '../../lib/utils'
import type { Trackpoint } from '../../types/gps'

// Plain dark background — ultimate fallback when no tiles available
const DARK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  name: 'Dark',
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#111114' }
    }
  ]
}

// Carto Dark Matter — free, no API key, dark vector tiles
const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'

const MAX_GRADIENT_STOPS = 200

// Register PMTiles protocol once
let pmtilesRegistered = false
function ensurePmtilesProtocol(): void {
  if (pmtilesRegistered) return
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  pmtilesRegistered = true
}

/**
 * Determine the best available map style:
 * 1. Online → Carto Dark Matter
 * 2. Offline + local PMTiles → local dark style
 * 3. Offline + no tiles → plain dark background
 */
async function resolveMapStyle(): Promise<string | maplibregl.StyleSpecification> {
  // Check online connectivity
  if (navigator.onLine) {
    try {
      // Quick fetch test to confirm real connectivity (navigator.onLine can lie)
      const resp = await fetch(CARTO_DARK_STYLE, { method: 'HEAD', signal: AbortSignal.timeout(3000) })
      if (resp.ok) return CARTO_DARK_STYLE
    } catch {
      // Not actually online, fall through
    }
  }

  // Offline — check for local PMTiles
  try {
    const resp = await fetch('local-resource://map/basemap.pmtiles', {
      method: 'HEAD',
      signal: AbortSignal.timeout(1000)
    })
    if (resp.ok) {
      ensurePmtilesProtocol()
      // Return inline style referencing local PMTiles
      return {
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
    }
  } catch {
    // No local tiles available
  }

  // Ultimate fallback
  return DARK_STYLE
}

export function TripMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)

  useEffect(() => {
    if (!containerRef.current || trackpoints.length < 2) return

    let cancelled = false

    const initMap = async (): Promise<void> => {
      // Small delay so container has final size
      await new Promise((r) => setTimeout(r, 50))
      if (cancelled || !containerRef.current) return

      const style = await resolveMapStyle()
      if (cancelled || !containerRef.current) return

      const bounds = computeBounds(trackpoints)

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        bounds,
        fitBoundsOptions: { padding: 80 },
        attributionControl: false,
        pitch: 40,
        bearing: computeInitialBearing(trackpoints)
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

      map.on('load', () => {
        addTrackLayer(map, trackpoints)
        addMarkers(map, trackpoints)
      })

      mapRef.current = map
    }

    initMap()

    return (): void => {
      cancelled = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [trackpoints])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  )
}

function computeBounds(trackpoints: Trackpoint[]): maplibregl.LngLatBoundsLike {
  let minLat = Infinity, maxLat = -Infinity
  let minLon = Infinity, maxLon = -Infinity

  for (const p of trackpoints) {
    if (p.latitude < minLat) minLat = p.latitude
    if (p.latitude > maxLat) maxLat = p.latitude
    if (p.longitude < minLon) minLon = p.longitude
    if (p.longitude > maxLon) maxLon = p.longitude
  }

  if (maxLat - minLat < 0.001) { minLat -= 0.002; maxLat += 0.002 }
  if (maxLon - minLon < 0.001) { minLon -= 0.002; maxLon += 0.002 }

  return [[minLon, minLat], [maxLon, maxLat]]
}

function computeInitialBearing(trackpoints: Trackpoint[]): number {
  if (trackpoints.length < 2) return 0
  const first = trackpoints[0]
  const last = trackpoints[trackpoints.length - 1]
  const dLon = ((last.longitude - first.longitude) * Math.PI) / 180
  const lat1 = (first.latitude * Math.PI) / 180
  const lat2 = (last.latitude * Math.PI) / 180
  const x = Math.sin(dLon) * Math.cos(lat2)
  const y = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

function addTrackLayer(map: maplibregl.Map, trackpoints: Trackpoint[]): void {
  const coordinates = trackpoints.map((p) => [p.longitude, p.latitude, p.altitude ?? 0])

  const distances: number[] = [0]
  let totalDist = 0
  for (let i = 1; i < trackpoints.length; i++) {
    totalDist += haversineDistance(
      trackpoints[i - 1].latitude, trackpoints[i - 1].longitude,
      trackpoints[i].latitude, trackpoints[i].longitude
    )
    distances.push(totalDist)
  }

  if (totalDist === 0) {
    addSimpleLine(map, coordinates)
    return
  }

  const maxSpeed = Math.max(...trackpoints.map((p) => p.speed), 0.1)

  const step = Math.max(1, Math.floor(trackpoints.length / MAX_GRADIENT_STOPS))
  const gradientStops: (number | string)[] = []
  let lastProgress = -1

  for (let i = 0; i < trackpoints.length; i += step) {
    const progress = distances[i] / totalDist
    if (progress <= lastProgress) continue
    lastProgress = progress
    const speedRatio = Math.min(trackpoints[i].speed / maxSpeed, 1)
    gradientStops.push(progress, speedToColor(speedRatio))
  }

  const lastIdx = trackpoints.length - 1
  if (distances[lastIdx] / totalDist > lastProgress) {
    const speedRatio = Math.min(trackpoints[lastIdx].speed / maxSpeed, 1)
    gradientStops.push(1.0, speedToColor(speedRatio))
  }

  if (gradientStops.length < 4) {
    addSimpleLine(map, coordinates)
    return
  }

  map.addSource('track', {
    type: 'geojson',
    lineMetrics: true,
    data: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates }
    }
  })

  map.addLayer({
    id: 'track-outline',
    type: 'line',
    source: 'track',
    paint: { 'line-width': 8, 'line-color': '#000000', 'line-opacity': 0.4 }
  })

  map.addLayer({
    id: 'track-line',
    type: 'line',
    source: 'track',
    paint: {
      'line-width': 4,
      'line-gradient': ['interpolate', ['linear'], ['line-progress'], ...gradientStops]
    }
  })
}

function addSimpleLine(map: maplibregl.Map, coordinates: number[][]): void {
  map.addSource('track', {
    type: 'geojson',
    data: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates }
    }
  })
  map.addLayer({
    id: 'track-line',
    type: 'line',
    source: 'track',
    paint: { 'line-width': 4, 'line-color': '#22d3ee' }
  })
}

function addMarkers(map: maplibregl.Map, trackpoints: Trackpoint[]): void {
  const first = trackpoints[0]
  const last = trackpoints[trackpoints.length - 1]

  const startEl = document.createElement('div')
  startEl.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#22c55e;border:2px solid #fff;box-shadow:0 0 8px rgba(34,197,94,0.6);'
  new maplibregl.Marker({ element: startEl })
    .setLngLat([first.longitude, first.latitude])
    .addTo(map)

  const endEl = document.createElement('div')
  endEl.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#ef4444;border:2px solid #fff;box-shadow:0 0 8px rgba(239,68,68,0.6);'
  new maplibregl.Marker({ element: endEl })
    .setLngLat([last.longitude, last.latitude])
    .addTo(map)
}

function speedToColor(ratio: number): string {
  const r = ratio < 0.5 ? Math.round(ratio * 2 * 255) : 255
  const g = ratio < 0.5 ? 255 : Math.round((1 - (ratio - 0.5) * 2) * 255)
  return `rgb(${r}, ${g}, 40)`
}
