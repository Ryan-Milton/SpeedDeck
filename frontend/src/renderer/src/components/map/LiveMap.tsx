import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useNavigationStore } from '../../stores/navigation-store'
import { resolveMapStyle, checkOnlineStyle, speedToColor } from '../../lib/map-style'

const DEFAULT_ZOOM = 16
const DRIVING_PITCH = 50
const CAMERA_PADDING = { top: 300, bottom: 0, left: 0, right: 0 }
const TRAIL_DOWNSAMPLE = 10 // only add a trail point every N GPS updates (~1Hz at 10Hz)

export function LiveMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const trailCoordsRef = useRef<number[][]>([])
  const trailSpeedsRef = useRef<number[]>([])
  const trailCounterRef = useRef(0)
  const trailDirtyRef = useRef(false)
  const mapReadyRef = useRef(false)
  const onlineStyleRef = useRef(false) // true once we've switched to Carto

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    const initMap = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 50))
      if (cancelled || !containerRef.current) return

      const style = await resolveMapStyle()
      if (cancelled || !containerRef.current) return
      if (typeof style === 'string' && style.startsWith('http')) onlineStyleRef.current = true

      const gps = useGpsStore.getState()
      const center: [number, number] = gps.fix
        ? [gps.fix.longitude, gps.fix.latitude]
        : [-122.3321, 47.6062] // default Seattle

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center,
        zoom: DEFAULT_ZOOM,
        bearing: gps.fix?.heading ?? 0,
        pitch: DRIVING_PITCH,
        attributionControl: false,
        dragRotate: true,
        touchZoomRotate: true
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

      map.on('load', () => {
        // Trail source — FeatureCollection of 2-point segments, each with a color property
        map.addSource('trail', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        })
        map.addLayer({
          id: 'trail-outline',
          type: 'line',
          source: 'trail',
          paint: { 'line-width': 6, 'line-color': '#000000', 'line-opacity': 0.3 }
        })
        map.addLayer({
          id: 'trail-line',
          type: 'line',
          source: 'trail',
          paint: {
            'line-width': 3,
            'line-color': ['get', 'color']
          }
        })

        // Navigation route line — apply current route if one exists
        const currentRoute = useNavigationStore.getState().route
        const routeGeom = currentRoute
          ? currentRoute.geometry
          : { type: 'LineString' as const, coordinates: [] as number[][] }
        map.addSource('route', {
          type: 'geojson',
          data: { type: 'Feature', geometry: routeGeom, properties: {} }
        })
        map.addLayer({
          id: 'route-outline',
          type: 'line',
          source: 'route',
          paint: { 'line-width': 8, 'line-color': '#000000', 'line-opacity': 0.3 }
        })
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-width': 5, 'line-color': '#0A84FF', 'line-opacity': 0.85 }
        })

        // Vehicle position dot (GeoJSON-based, stays in sync with map center)
        map.addSource('vehicle', {
          type: 'geojson',
          data: { type: 'Feature', geometry: { type: 'Point', coordinates: center }, properties: {} }
        })
        map.addLayer({
          id: 'vehicle-glow',
          type: 'circle',
          source: 'vehicle',
          paint: {
            'circle-radius': 12,
            'circle-color': '#0A84FF',
            'circle-opacity': 0.3,
            'circle-blur': 0.5
          }
        })
        map.addLayer({
          id: 'vehicle-dot',
          type: 'circle',
          source: 'vehicle',
          paint: {
            'circle-radius': 7,
            'circle-color': '#0A84FF',
            'circle-stroke-width': 3,
            'circle-stroke-color': '#FFFFFF'
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
  }, [])

  // Poll for online connectivity and switch to Carto style when available
  useEffect(() => {
    const tryUpgrade = async (): Promise<void> => {
      if (onlineStyleRef.current || !mapRef.current || !mapReadyRef.current) return
      const url = await checkOnlineStyle()
      if (url && mapRef.current) {
        onlineStyleRef.current = true
        mapRef.current.setStyle(url)
        // Re-add custom sources/layers after style swap
        mapRef.current.once('styledata', () => {
          const map = mapRef.current
          if (!map) return
          // Vehicle source + layers
          if (!map.getSource('vehicle')) {
            map.addSource('vehicle', {
              type: 'geojson',
              data: { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }
            })
            map.addLayer({ id: 'vehicle-glow', type: 'circle', source: 'vehicle', paint: { 'circle-radius': 12, 'circle-color': '#0A84FF', 'circle-opacity': 0.3, 'circle-blur': 0.5 } })
            map.addLayer({ id: 'vehicle-dot', type: 'circle', source: 'vehicle', paint: { 'circle-radius': 7, 'circle-color': '#0A84FF', 'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF' } })
          }
          // Trail source + layers
          if (!map.getSource('trail')) {
            map.addSource('trail', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
            map.addLayer({ id: 'trail-outline', type: 'line', source: 'trail', paint: { 'line-width': 6, 'line-color': '#000000', 'line-opacity': 0.3 } })
            map.addLayer({ id: 'trail-line', type: 'line', source: 'trail', paint: { 'line-width': 3, 'line-color': ['get', 'color'] } })
          }
          // Route source + layers — re-apply current navigation route if active
          if (!map.getSource('route')) {
            const navRoute = useNavigationStore.getState().route
            const routeData = navRoute
              ? { type: 'Feature' as const, geometry: navRoute.geometry, properties: {} }
              : { type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [] as number[][] }, properties: {} }
            map.addSource('route', { type: 'geojson', data: routeData })
            map.addLayer({ id: 'route-outline', type: 'line', source: 'route', paint: { 'line-width': 8, 'line-color': '#000000', 'line-opacity': 0.3 } })
            map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-width': 5, 'line-color': '#0A84FF', 'line-opacity': 0.85 } })
          }
          mapReadyRef.current = true
        })
      }
    }

    // Check every 10 seconds until online
    const interval = setInterval(tryUpgrade, 10_000)
    // Also listen for browser online event
    window.addEventListener('online', tryUpgrade)

    return (): void => {
      clearInterval(interval)
      window.removeEventListener('online', tryUpgrade)
    }
  }, [])

  // Subscribe to GPS updates and move the map
  useEffect(() => {
    const unsub = useGpsStore.subscribe((state, prevState) => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current || !state.fix) return

      const { fix, smoothedSpeed, tripStatus, tripMaxSpeed } = state
      const prevFix = prevState.fix

      // Only update if position actually changed
      if (prevFix && fix.latitude === prevFix.latitude && fix.longitude === prevFix.longitude) return

      // Update vehicle dot position
      const vehicleSrc = map.getSource('vehicle') as maplibregl.GeoJSONSource | undefined
      vehicleSrc?.setData({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [fix.longitude, fix.latitude] },
        properties: {}
      })

      // Camera follow: heading-up (pitched, vehicle near bottom) or north-up (flat, centered)
      const orientation = useSettingsStore.getState().mapOrientation
      if (orientation === 'north-up') {
        map.easeTo({
          center: [fix.longitude, fix.latitude],
          bearing: 0,
          pitch: 0,
          padding: { top: 0, bottom: 0, left: 0, right: 0 },
          duration: 200,
          easing: (t) => t
        })
      } else {
        map.easeTo({
          center: [fix.longitude, fix.latitude],
          bearing: fix.heading,
          pitch: DRIVING_PITCH,
          padding: CAMERA_PADDING,
          duration: 200,
          easing: (t) => t
        })
      }

      // Breadcrumb trail (only during recording)
      if (tripStatus === 'recording') {
        // Downsample to ~1Hz for performance over long trips
        trailCounterRef.current++
        if (trailCounterRef.current >= TRAIL_DOWNSAMPLE) {
          trailCounterRef.current = 0
          trailCoordsRef.current.push([fix.longitude, fix.latitude])
          trailSpeedsRef.current.push(smoothedSpeed)
          trailDirtyRef.current = true
        }

        // Rebuild GeoJSON only when we added a new point
        if (trailDirtyRef.current) {
          trailDirtyRef.current = false
          const src = map.getSource('trail') as maplibregl.GeoJSONSource | undefined
          if (src && trailCoordsRef.current.length >= 2) {
            const maxSpd = Math.max(tripMaxSpeed, 0.1)
            const features: GeoJSON.Feature[] = []
            for (let i = 1; i < trailCoordsRef.current.length; i++) {
              const ratio = Math.min(trailSpeedsRef.current[i] / maxSpd, 1)
              features.push({
                type: 'Feature',
                properties: { color: speedToColor(ratio) },
                geometry: {
                  type: 'LineString',
                  coordinates: [trailCoordsRef.current[i - 1], trailCoordsRef.current[i]]
                }
              })
            }
            src.setData({ type: 'FeatureCollection', features })
          }
        }
      } else if (prevState.tripStatus === 'recording' && tripStatus !== 'recording') {
        // Trip just stopped — clear trail
        trailCoordsRef.current = []
        trailSpeedsRef.current = []
        trailCounterRef.current = 0
        const src = map.getSource('trail') as maplibregl.GeoJSONSource | undefined
        if (src) {
          src.setData({ type: 'FeatureCollection', features: [] })
        }
      }
    })

    return unsub
  }, [])

  // React to orientation toggle immediately (even when stationary)
  useEffect(() => {
    return useSettingsStore.subscribe(
      (s) => s.mapOrientation,
      (orientation) => {
        const map = mapRef.current
        if (!map || !mapReadyRef.current) return
        const fix = useGpsStore.getState().fix
        if (!fix) return
        if (orientation === 'north-up') {
          map.easeTo({
            center: [fix.longitude, fix.latitude],
            bearing: 0,
            pitch: 0,
            padding: { top: 0, bottom: 0, left: 0, right: 0 },
            duration: 300,
            easing: (t) => t
          })
        } else {
          map.easeTo({
            center: [fix.longitude, fix.latitude],
            bearing: fix.heading,
            pitch: DRIVING_PITCH,
            padding: CAMERA_PADDING,
            duration: 300,
            easing: (t) => t
          })
        }
      }
    )
  }, [])

  // Subscribe to navigation route changes
  // Subscribe to navigation route and status changes
  useEffect(() => {
    // Apply current route immediately when this effect mounts (handles tab switching)
    const applyRoute = (): void => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current) return
      const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined
      if (!src) return
      const route = useNavigationStore.getState().route
      if (route) {
        src.setData({ type: 'Feature', geometry: route.geometry, properties: {} })
      }
    }
    // Delay slightly to ensure map is ready after mount
    const timer = setTimeout(applyRoute, 200)

    const unsub = useNavigationStore.subscribe((state, prev) => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current) return

      // Update route line when route changes
      if (state.route !== prev.route) {
        const src = map.getSource('route') as maplibregl.GeoJSONSource | undefined
        if (!src) return
        if (state.route) {
          src.setData({ type: 'Feature', geometry: state.route.geometry, properties: {} })

          // Fit map to show the full route when previewing
          if (state.status === 'previewing') {
            const coords = state.route.geometry.coordinates
            if (coords.length >= 2) {
              const bounds = coords.reduce(
                (b, c) => [
                  [Math.min(b[0][0], c[0]), Math.min(b[0][1], c[1])],
                  [Math.max(b[1][0], c[0]), Math.max(b[1][1], c[1])]
                ] as [[number, number], [number, number]],
                [[Infinity, Infinity], [-Infinity, -Infinity]] as [[number, number], [number, number]]
              )
              map.fitBounds(bounds as maplibregl.LngLatBoundsLike, {
                padding: { top: 80, right: 80, bottom: 160, left: 80 },
                pitch: 0,
                bearing: 0,
                duration: 500
              })
            }
          }
        } else {
          src.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} })
        }
      }
    })
    return (): void => {
      clearTimeout(timer)
      unsub()
    }
  }, [])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  )
}
