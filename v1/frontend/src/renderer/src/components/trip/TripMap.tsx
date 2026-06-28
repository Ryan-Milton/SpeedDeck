import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { distance3d } from '../../lib/utils'
import { resolveMapStyle, speedToColor } from '../../lib/map-style'
import type { Trackpoint } from '../../types/gps'

const MAX_GRADIENT_STOPS = 200

export function TripMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapReadyRef = useRef(false)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || trackpoints.length < 2) return

    let cancelled = false

    const initMap = async (): Promise<void> => {
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

        // Playback dot (hidden initially)
        map.addSource('playback-dot', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
        })
        map.addLayer({
          id: 'playback-dot-glow',
          type: 'circle',
          source: 'playback-dot',
          paint: {
            'circle-radius': 12,
            'circle-color': '#0A84FF',
            'circle-opacity': 0,
            'circle-blur': 0.5
          }
        })
        map.addLayer({
          id: 'playback-dot-circle',
          type: 'circle',
          source: 'playback-dot',
          paint: {
            'circle-radius': 7,
            'circle-color': '#0A84FF',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#FFFFFF',
            'circle-opacity': 0
          }
        })

        mapReadyRef.current = true
      })

      mapRef.current = map
    }

    initMap()

    return (): void => {
      cancelled = true
      mapReadyRef.current = false
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [trackpoints])

  // Subscribe to playback store for camera follow + dot
  useEffect(() => {
    if (trackpoints.length < 2) return

    const unsub = usePlaybackStore.subscribe((state, prev) => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current) return

      // Show dot when playback starts or has a position
      if (state.position && !prev.position) {
        map.setPaintProperty('playback-dot-circle', 'circle-opacity', 1)
        map.setPaintProperty('playback-dot-glow', 'circle-opacity', 0.3)
      }

      // Hide dot and return to overview on stop
      if (!state.position && prev.position) {
        map.setPaintProperty('playback-dot-circle', 'circle-opacity', 0)
        map.setPaintProperty('playback-dot-glow', 'circle-opacity', 0)
        map.fitBounds(
          computeBounds(trackpoints) as maplibregl.LngLatBoundsLike,
          { padding: 80, pitch: 40, bearing: computeInitialBearing(trackpoints), duration: 800 }
        )
        return
      }

      if (!state.position) return

      // Update dot position
      const src = map.getSource('playback-dot') as maplibregl.GeoJSONSource | undefined
      src?.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [state.position.lng, state.position.lat] },
        properties: {}
      })

      // Camera follow: heading-up, pitched, zoomed in (instant — rAF provides smoothness)
      map.jumpTo({
        center: [state.position.lng, state.position.lat],
        bearing: state.heading,
        pitch: 50,
        zoom: 16,
        padding: { top: 200, bottom: 0, left: 0, right: 0 }
      })
    })

    return unsub
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
    totalDist += distance3d(
      trackpoints[i - 1].latitude, trackpoints[i - 1].longitude, trackpoints[i - 1].altitude,
      trackpoints[i].latitude, trackpoints[i].longitude, trackpoints[i].altitude
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
    paint: { 'line-width': 4, 'line-color': '#0A84FF' }
  })
}

function addMarkers(map: maplibregl.Map, trackpoints: Trackpoint[]): void {
  const first = trackpoints[0]
  const last = trackpoints[trackpoints.length - 1]

  const startEl = document.createElement('div')
  startEl.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#30D158;border:2px solid #fff;box-shadow:0 2px 6px rgba(48,209,88,0.4);'
  new maplibregl.Marker({ element: startEl })
    .setLngLat([first.longitude, first.latitude])
    .addTo(map)

  const endEl = document.createElement('div')
  endEl.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#FF453A;border:2px solid #fff;box-shadow:0 2px 6px rgba(255,69,58,0.4);'
  new maplibregl.Marker({ element: endEl })
    .setLngLat([last.longitude, last.latitude])
    .addTo(map)
}
