import { useState, useRef } from 'react'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import {
  convertSpeed, convertDistance, convertAltitude,
  speedUnitLabel, distanceUnitLabel, altitudeUnitLabel, formatDuration
} from '../../lib/utils'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { ChevronLeft, Download } from 'lucide-react'
import type { Trackpoint, GpxDataMessage } from '../../types/gps'

export function TripStatsBar(): React.JSX.Element {
  const trips = useTripViewerStore((s) => s.trips)
  const selectedTripId = useTripViewerStore((s) => s.selectedTripId)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const closeDetail = useTripViewerStore((s) => s.closeDetail)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)
  const [exporting, setExporting] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const trip = trips.find((t) => t.id === selectedTripId)
  const name = trip?.name || `Trip #${selectedTripId}`

  const handleExport = (): void => {
    if (!selectedTripId || exporting) return
    setExporting(true)

    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    client.onMessage = async (msg): Promise<void> => {
      if (msg.type === 'gpxData') {
        const data = msg as GpxDataMessage
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
        client.disconnect()
        try {
          const safeName = (name).replace(/[^a-zA-Z0-9_-]/g, '_')
          const filePath = await window.api.showSaveDialog(`${safeName}.gpx`)
          if (filePath) {
            await window.api.saveFile(filePath, data.gpxXml)
          }
        } finally {
          setExporting(false)
        }
      }
    }
    client.onConnectionChange = (connected): void => {
      if (connected) {
        client.send({ type: 'command', action: 'trip_export', tripId: selectedTripId })
      }
    }
    client.connect()

    // Timeout safety
    timeoutRef.current = setTimeout(() => { setExporting(false); client.disconnect() }, 10000)
  }

  const duration = trip?.startedAt && trip?.endedAt
    ? (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000
    : 0

  const { elevGain } = computeElevation(trackpoints)

  return (
    <div className="flex items-center h-14 px-4 border-b border-separator bg-surface gap-4">
      <button
        onClick={closeDetail}
        className="w-10 h-10 flex items-center justify-center text-text-secondary active:text-accent transition-colors"
      >
        <ChevronLeft size={24} />
      </button>

      <span className="text-lg font-semibold text-text-primary truncate">{name}</span>

      <div className="flex-1" />

      <StatPill label="Dist" value={convertDistance(trip?.distanceM ?? 0, speedUnit).toFixed(1)} unit={distanceUnitLabel(speedUnit)} />
      <StatPill label="Time" value={formatDuration(duration)} />
      <StatPill label="Max" value={String(Math.round(convertSpeed(trip?.maxSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      <StatPill label="Avg" value={String(Math.round(convertSpeed(trip?.avgSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      {elevGain > 0 && (
        <StatPill label="Elev" value={`+${Math.round(convertAltitude(elevGain, altUnit))}`} unit={altitudeUnitLabel(altUnit)} />
      )}

      <button
        onClick={handleExport}
        disabled={exporting}
        className="w-10 h-10 flex items-center justify-center text-text-secondary active:text-accent disabled:opacity-40 transition-colors"
        title="Export GPX"
      >
        <Download size={20} />
      </button>
    </div>
  )
}

function StatPill({ label, value, unit }: { label: string; value: string; unit?: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      <span className="text-sm font-semibold text-text-primary tabular-nums">{value}</span>
      {unit && <span className="text-xs text-text-secondary">{unit}</span>}
    </div>
  )
}

function computeElevation(trackpoints: Trackpoint[]): { elevGain: number; elevLoss: number } {
  let gain = 0
  let loss = 0
  for (let i = 1; i < trackpoints.length; i++) {
    const prev = trackpoints[i - 1].altitude
    const curr = trackpoints[i].altitude
    if (prev == null || curr == null) continue
    const diff = curr - prev
    if (diff > 0) gain += diff
    else loss += Math.abs(diff)
  }
  return { elevGain: gain, elevLoss: loss }
}
