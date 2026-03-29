import { useEffect, useRef, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGpsStore } from '../../stores/gps-store'
import { resolveMapStyle, speedToColor } from '../../lib/map-style'

const MAX_TRAIL_POINTS = 300
const DEFAULT_ZOOM = 16

export function LiveMap(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const trailCoordsRef = useRef<number[][]>([])
  const trailSpeedsRef = useRef<number[]>([])
  const mapReadyRef = useRef(false)

  // Initialize map once
  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    const initMap = async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 50))
      if (cancelled || !containerRef.current) return

      const style = await resolveMapStyle()
      if (cancelled || !containerRef.current) return

      const gps = useGpsStore.getState()
      const center: [number, number] = gps.fix
        ? [gps.fix.longitude, gps.fix.latitude]
        : [-122.3321, 47.6062] // default Seattle

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center,
        zoom: DEFAULT_ZOOM,
        bearing: -(gps.fix?.heading ?? 0),
        attributionControl: false,
        dragRotate: true,
        touchZoomRotate: true
      })

      map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')

      map.on('load', () => {
        // Trail source (empty initially)
        map.addSource('trail', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } }
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
          paint: { 'line-width': 3, 'line-color': '#22d3ee' }
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

  // Subscribe to GPS updates and move the map
  useEffect(() => {
    const unsub = useGpsStore.subscribe((state, prevState) => {
      const map = mapRef.current
      if (!map || !mapReadyRef.current || !state.fix) return

      const { fix, smoothedSpeed, tripStatus } = state
      const prevFix = prevState.fix

      // Only update if position actually changed
      if (prevFix && fix.latitude === prevFix.latitude && fix.longitude === prevFix.longitude) return

      // Smooth camera follow + rotate
      map.easeTo({
        center: [fix.longitude, fix.latitude],
        bearing: -fix.heading,
        duration: 200,
        easing: (t) => t // linear for smoothness
      })

      // Breadcrumb trail (only during recording)
      if (tripStatus === 'recording') {
        trailCoordsRef.current.push([fix.longitude, fix.latitude])
        trailSpeedsRef.current.push(smoothedSpeed)

        // Ring buffer
        if (trailCoordsRef.current.length > MAX_TRAIL_POINTS) {
          trailCoordsRef.current.shift()
          trailSpeedsRef.current.shift()
        }

        const src = map.getSource('trail') as maplibregl.GeoJSONSource | undefined
        if (src && trailCoordsRef.current.length >= 2) {
          src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: trailCoordsRef.current }
          })
        }
      } else if (prevState.tripStatus === 'recording' && tripStatus !== 'recording') {
        // Trip just stopped — clear trail
        trailCoordsRef.current = []
        trailSpeedsRef.current = []
        const src = map.getSource('trail') as maplibregl.GeoJSONSource | undefined
        if (src) {
          src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: [] }
          })
        }
      }
    })

    return unsub
  }, [])

  return (
    <div className="relative" style={{ width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Position indicator — fixed to center of map */}
      <div
        className="absolute pointer-events-none"
        style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
      >
        {/* Heading cone */}
        <svg width="48" height="48" viewBox="0 0 48 48" className="absolute" style={{ top: -24, left: -24 }}>
          <polygon
            points="24,4 20,20 28,20"
            fill="#22d3ee"
            opacity="0.4"
          />
        </svg>
        {/* Position dot */}
        <div
          className="rounded-full animate-pulse"
          style={{
            width: 16,
            height: 16,
            marginTop: -8,
            marginLeft: -8,
            background: '#22d3ee',
            border: '3px solid #fff',
            boxShadow: '0 0 12px rgba(34, 211, 238, 0.6)'
          }}
        />
      </div>
    </div>
  )
}
