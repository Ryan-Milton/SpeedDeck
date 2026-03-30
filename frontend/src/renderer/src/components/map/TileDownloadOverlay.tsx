import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { TileDownloadProgress } from './TileDownloadProgress'
import { X } from 'lucide-react'

const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
const DEFAULT_SPAN = 0.15
const HANDLE_SIZE = 28

type DragEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move' | null

interface BBox {
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}

interface ScreenBox {
  left: number
  top: number
  right: number
  bottom: number
}

export function TileDownloadOverlay(): React.JSX.Element {
  const showTileDownload = useSettingsStore((s) => s.showTileDownload)
  const setShowTileDownload = useSettingsStore((s) => s.setShowTileDownload)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  const fix = useGpsStore((s) => s.fix)
  const centerLat = fix?.latitude ?? 47.6062
  const centerLon = fix?.longitude ?? -122.3321

  const [bbox, setBbox] = useState<BBox>({
    minLon: centerLon - DEFAULT_SPAN,
    minLat: centerLat - DEFAULT_SPAN,
    maxLon: centerLon + DEFAULT_SPAN,
    maxLat: centerLat + DEFAULT_SPAN
  })
  const [screenBox, setScreenBox] = useState<ScreenBox>({ left: 0, top: 0, right: 0, bottom: 0 })
  const [maxZoom, setMaxZoom] = useState(14)
  const [estimate, setEstimate] = useState({ tileCount: 0, estimatedSizeMB: 0 })
  const [downloading, setDownloading] = useState(false)
  const [mapReady, setMapReady] = useState(false)

  const dragRef = useRef<{ edge: DragEdge; startLng?: number; startLat?: number; startBbox?: BBox } | null>(null)
  const bboxRef = useRef(bbox)
  bboxRef.current = bbox

  // Project bbox to screen coordinates
  const projectBbox = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const nw = map.project([bboxRef.current.minLon, bboxRef.current.maxLat])
    const se = map.project([bboxRef.current.maxLon, bboxRef.current.minLat])
    setScreenBox({ left: nw.x, top: nw.y, right: se.x, bottom: se.y })
  }, [])

  useEffect(() => {
    window.api.estimateTileDownload(bbox, 0, maxZoom).then(setEstimate).catch(() => {})
  }, [bbox, maxZoom])

  // Initialize map
  useEffect(() => {
    if (!showTileDownload || !containerRef.current) return

    setMapReady(false)

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: [centerLon, centerLat],
      zoom: 10,
      attributionControl: false
    })

    map.on('load', () => {
      updateBboxLayer(map, bboxRef.current)
      setMapReady(true)
      projectBbox()
    })

    // Re-project handles on every map move (pan, zoom, rotate)
    map.on('move', () => {
      projectBbox()
    })

    mapRef.current = map

    return (): void => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
  }, [showTileDownload, projectBbox])

  // Update map layer when bbox changes
  useEffect(() => {
    const map = mapRef.current
    if (map && mapReady) {
      updateBboxLayer(map, bbox)
      projectBbox()
    }
  }, [bbox, mapReady, projectBbox])

  // Drag handlers
  const handleDragStart = useCallback((edge: DragEdge) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const map = mapRef.current
    if (!map || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top])

    dragRef.current = {
      edge,
      startLng: lngLat.lng,
      startLat: lngLat.lat,
      startBbox: { ...bboxRef.current }
    }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    map.dragPan.disable()
    map.scrollZoom.disable()
  }, [])

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current || !mapRef.current || !containerRef.current) return
    e.preventDefault()

    const map = mapRef.current
    const rect = containerRef.current.getBoundingClientRect()
    const lngLat = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
    const { edge, startLng, startLat, startBbox } = dragRef.current

    if (edge === 'move' && startLng != null && startLat != null && startBbox) {
      // Move the entire box
      const dLon = lngLat.lng - startLng
      const dLat = lngLat.lat - startLat
      setBbox({
        minLon: startBbox.minLon + dLon,
        maxLon: startBbox.maxLon + dLon,
        minLat: startBbox.minLat + dLat,
        maxLat: startBbox.maxLat + dLat
      })
    } else {
      // Resize edge/corner
      setBbox((prev) => {
        const next = { ...prev }
        if (edge?.includes('n')) next.maxLat = Math.max(lngLat.lat, prev.minLat + 0.01)
        if (edge?.includes('s')) next.minLat = Math.min(lngLat.lat, prev.maxLat - 0.01)
        if (edge?.includes('e')) next.maxLon = Math.max(lngLat.lng, prev.minLon + 0.01)
        if (edge?.includes('w')) next.minLon = Math.min(lngLat.lng, prev.maxLon - 0.01)
        return next
      })
    }
  }, [])

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = null
    const target = e.currentTarget as HTMLElement
    target.releasePointerCapture(e.pointerId)

    const map = mapRef.current
    if (map) {
      map.dragPan.enable()
      map.scrollZoom.enable()
    }
  }, [])

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

  const h = HANDLE_SIZE

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

      {/* Map + drag handles */}
      <div className="flex-1 relative min-h-0">
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

        {/* Draggable bbox interior — move the whole box */}
        {mapReady && (
          <div
            onPointerDown={handleDragStart('move')}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            style={{
              position: 'absolute',
              left: screenBox.left,
              top: screenBox.top,
              width: Math.max(0, screenBox.right - screenBox.left),
              height: Math.max(0, screenBox.bottom - screenBox.top),
              cursor: 'grab',
              zIndex: 5,
              touchAction: 'none'
            }}
          />
        )}

        {/* Drag handles — re-projected on every map move */}
        {mapReady && (
          <>
            <Handle edge="nw" x={screenBox.left - h / 2} y={screenBox.top - h / 2} cursor="nw-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="ne" x={screenBox.right - h / 2} y={screenBox.top - h / 2} cursor="ne-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="sw" x={screenBox.left - h / 2} y={screenBox.bottom - h / 2} cursor="sw-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="se" x={screenBox.right - h / 2} y={screenBox.bottom - h / 2} cursor="se-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="n" x={(screenBox.left + screenBox.right) / 2 - h / 2} y={screenBox.top - h / 2} cursor="n-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="s" x={(screenBox.left + screenBox.right) / 2 - h / 2} y={screenBox.bottom - h / 2} cursor="s-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="w" x={screenBox.left - h / 2} y={(screenBox.top + screenBox.bottom) / 2 - h / 2} cursor="w-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
            <Handle edge="e" x={screenBox.right - h / 2} y={(screenBox.top + screenBox.bottom) / 2 - h / 2} cursor="e-resize" onStart={handleDragStart} onMove={handleDragMove} onEnd={handleDragEnd} />
          </>
        )}

        {/* Instructions */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="rounded-lg px-4 py-2" style={{ background: 'rgba(9,9,11,0.8)', backdropFilter: 'blur(8px)' }}>
            <span className="text-sm text-zinc-300">Drag the handles to select the area to download</span>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-zinc-800 bg-zinc-950/90 px-6 py-4 flex items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold tracking-[1px] text-zinc-400">MAX ZOOM</span>
          <input type="range" min={8} max={16} value={maxZoom} onChange={(e) => setMaxZoom(Number(e.target.value))} className="w-32 accent-cyan-400" />
          <span className="font-mono text-lg text-zinc-200 tabular-nums" style={{ width: 28 }}>{maxZoom}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg text-zinc-200 tabular-nums">{estimate.tileCount.toLocaleString()}</span>
          <span className="text-xs text-zinc-400">tiles</span>
          <span className="text-zinc-600 mx-1">/</span>
          <span className="font-mono text-lg text-cyan-400 tabular-nums">~{estimate.estimatedSizeMB} MB</span>
        </div>
        <div className="flex-1" />
        <button onClick={handleDownload} className="px-8 h-12 rounded-lg text-sm font-semibold tracking-[1px] border bg-cyan-900/50 text-cyan-400 border-cyan-400/30 hover:bg-cyan-900/70 transition-colors">
          DOWNLOAD
        </button>
      </div>
    </div>
  )
}

function Handle({
  edge,
  x,
  y,
  cursor,
  onStart,
  onMove,
  onEnd
}: {
  edge: DragEdge
  x: number
  y: number
  cursor: string
  onStart: (edge: DragEdge) => (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onEnd: (e: React.PointerEvent) => void
}): React.JSX.Element {
  return (
    <div
      onPointerDown={onStart(edge)}
      onPointerMove={onMove}
      onPointerUp={onEnd}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        cursor,
        zIndex: 10,
        touchAction: 'none'
      }}
    >
      <div
        className="rounded-full bg-cyan-400 border-2 border-white"
        style={{
          width: 14,
          height: 14,
          margin: (HANDLE_SIZE - 14) / 2,
          boxShadow: '0 0 6px rgba(34,211,238,0.6)'
        }}
      />
    </div>
  )
}

function updateBboxLayer(map: maplibregl.Map, bbox: BBox): void {
  const sourceId = 'bbox-area'
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
      id: 'bbox-fill',
      type: 'fill',
      source: sourceId,
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 }
    })
    map.addLayer({
      id: 'bbox-outline',
      type: 'line',
      source: sourceId,
      paint: { 'line-color': '#22d3ee', 'line-width': 2, 'line-opacity': 0.6 }
    })
  }
}
