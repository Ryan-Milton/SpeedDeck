import { useState, useRef, useEffect } from 'react'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import {
  convertSpeed, convertDistance, convertAltitude,
  speedUnitLabel, distanceUnitLabel, altitudeUnitLabel, formatDuration
} from '../../lib/utils'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { ChevronLeft, Pencil } from 'lucide-react'
import type { Trackpoint } from '../../types/gps'

export function TripStatsBar(): React.JSX.Element {
  const trips = useTripViewerStore((s) => s.trips)
  const selectedTripId = useTripViewerStore((s) => s.selectedTripId)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const closeDetail = useTripViewerStore((s) => s.closeDetail)
  const setTrips = useTripViewerStore((s) => s.setTrips)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  const trip = trips.find((t) => t.id === selectedTripId)
  const name = trip?.name || `Trip #${selectedTripId}`

  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      setEditValue(name)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [editing, name])

  const handleRename = (): void => {
    const trimmed = editValue.trim()
    setEditing(false)
    if (!trimmed || trimmed === name || !selectedTripId) return

    // Send rename command to backend
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    client.onConnectionChange = (connected): void => {
      if (connected) {
        client.send({ type: 'command', action: 'trip_rename', tripId: selectedTripId, name: trimmed })
        // Update local state immediately
        setTrips(trips.map((t) => t.id === selectedTripId ? { ...t, name: trimmed } : t))
        client.disconnect()
      }
    }
    client.connect()
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

      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          className="text-lg font-semibold text-text-primary bg-surface-card rounded-lg px-2 py-1 outline-none focus:ring-1 focus:ring-accent max-w-[200px]"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex items-center gap-2 text-lg font-semibold text-text-primary truncate hover:text-accent transition-colors"
        >
          <span className="truncate">{name}</span>
          <Pencil size={14} className="text-text-secondary shrink-0" />
        </button>
      )}

      <div className="flex-1" />

      <StatPill label="Dist" value={convertDistance(trip?.distanceM ?? 0, speedUnit).toFixed(1)} unit={distanceUnitLabel(speedUnit)} />
      <StatPill label="Time" value={formatDuration(duration)} />
      <StatPill label="Max" value={String(Math.round(convertSpeed(trip?.maxSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      <StatPill label="Avg" value={String(Math.round(convertSpeed(trip?.avgSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      {elevGain > 0 && (
        <StatPill label="Elev" value={`+${Math.round(convertAltitude(elevGain, altUnit))}`} unit={altitudeUnitLabel(altUnit)} />
      )}
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
