import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { TileDownloadProgress } from './TileDownloadProgress'
import { cn } from '../../lib/utils'
import { X } from 'lucide-react'

const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const DEFAULT_SPAN = 0.15 // ~10 miles each direction

export function TileDownloadOverlay(): React.JSX.Element {
  const showTileDownload = useSettingsStore((s) => s.showTileDownload)
  const setShowTileDownload = useSettingsStore((s) => s.setShowTileDownload)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const fix = useGpsStore((s) => s.fix)
  const centerLat = fix?.latitude ?? 47.6062
  const centerLon = fix?.longitude ?? -122.3321

  const [bbox, setBbox] = useState({
    minLon: centerLon - DEFAULT_SPAN,
    minLat: centerLat - DEFAULT_SPAN,
    maxLon: centerLon + DEFAULT_SPAN,
    maxLat: centerLat + DEFAULT_SPAN
  })
  const [maxZoom, setMaxZoom] = useState(14)
  const [estimate, setEstimate] = useState({ tileCount: 0, estimatedSizeMB: 0 })
  const [downloading, setDownloading] = useState(false)

  // Update estimate when bbox or zoom changes
  useEffect(() => {
    window.api.estimateTileDownload(bbox, 0, maxZoom).then(setEstimate).catch(() => {})
  }, [bbox, maxZoom])

  // Initialize map
  useEffect(() => {
    if (!showTileDownload || !containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: [centerLon, centerLat],
      zoom: 10,
      attributionControl: false
    })

    map.on('load', () => {
      updateBboxLayer(map, bbox)
    })

    map.on('moveend', () => {
      // Update bbox to match visible area when user pans
      const bounds = map.getBounds()
      const padding = 0.2 // 20% inset from edges
      const lonSpan = bounds.getEast() - bounds.getWest()
      const latSpan = bounds.getNorth() - bounds.getSouth()
      const newBbox = {
        minLon: bounds.getWest() + lonSpan * padding,
        minLat: bounds.getSouth() + latSpan * padding,
        maxLon: bounds.getEast() - lonSpan * padding,
        maxLat: bounds.getNorth() - latSpan * padding
      }
      setBbox(newBbox)
      updateBboxLayer(map, newBbox)
    })

    mapRef.current = map

    return (): void => {
      map.remove()
      mapRef.current = null
    }
  }, [showTileDownload])

  const handleDownload = useCallback(async () => {
    setDownloading(true)
    await window.api.startTileDownload(bbox, 0, maxZoom)
  }, [bbox, maxZoom])

  const handleDone = useCallback(() => {
    setDownloading(false)
    useSettingsStore.getState().setTilesAvailable(true)
    useSettingsStore.getState().setShowTileDownload(false)
  }, [])

  const handleCancel = useCallback(() => {
    setDownloading(false)
  }, [])

  if (!showTileDownload) return <></>

  if (downloading) {
    return <TileDownloadProgress onDone={handleDone} onCancel={handleCancel} />
  }

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col" style={{ zIndex: 65 }}>
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-zinc-800 bg-zinc-950/90">
        <span className="text-lg font-semibold tracking-[2px] text-zinc-300">DOWNLOAD MAP TILES</span>
        <button
          onClick={() => setShowTileDownload(false)}
          className="w-12 h-12 flex items-center justify-center text-zinc-400 hover:text-zinc-200"
        >
          <X size={24} />
        </button>
      </div>

      {/* Map */}
      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Instructions overlay */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="rounded-lg px-4 py-2" style={{ background: 'rgba(9,9,11,0.8)', backdropFilter: 'blur(8px)' }}>
            <span className="text-sm text-zinc-300">Pan and zoom to select the area to download</span>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-zinc-800 bg-zinc-950/90 px-6 py-4 flex items-center gap-6">
        {/* Zoom slider */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-[1px] text-zinc-400">MAX ZOOM</span>
          <input
            type="range"
            min={8}
            max={16}
            value={maxZoom}
            onChange={(e) => setMaxZoom(Number(e.target.value))}
            className="w-32 accent-cyan-400"
          />
          <span className="font-mono text-lg text-zinc-200 tabular-nums" style={{ width: 28 }}>{maxZoom}</span>
        </div>

        {/* Estimate */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg text-zinc-200 tabular-nums">
            {estimate.tileCount.toLocaleString()}
          </span>
          <span className="text-xs text-zinc-400">tiles</span>
          <span className="text-zinc-600 mx-1">/</span>
          <span className="font-mono text-lg text-cyan-400 tabular-nums">
            ~{estimate.estimatedSizeMB} MB
          </span>
        </div>

        <div className="flex-1" />

        {/* Download button */}
        <button
          onClick={handleDownload}
          className="px-8 h-12 rounded-lg text-sm font-semibold tracking-[1px] border bg-cyan-900/50 text-cyan-400 border-cyan-400/30 hover:bg-cyan-900/70 transition-colors"
        >
          DOWNLOAD
        </button>
      </div>
    </div>
  )
}

function updateBboxLayer(map: maplibregl.Map, bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number }): void {
  const sourceId = 'bbox-area'
  const layerId = 'bbox-fill'
  const outlineId = 'bbox-outline'

  const geojson: GeoJSON.Feature = {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [bbox.minLon, bbox.minLat],
        [bbox.maxLon, bbox.minLat],
        [bbox.maxLon, bbox.maxLat],
        [bbox.minLon, bbox.maxLat],
        [bbox.minLon, bbox.minLat]
      ]]
    }
  }

  const src = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined
  if (src) {
    src.setData(geojson)
  } else {
    map.addSource(sourceId, { type: 'geojson', data: geojson })
    map.addLayer({
      id: layerId,
      type: 'fill',
      source: sourceId,
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 }
    })
    map.addLayer({
      id: outlineId,
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-opacity': 0.6 }
    })
  }
}
