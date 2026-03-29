import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import {
  convertSpeed, convertDistance, convertAltitude,
  speedUnitLabel, distanceUnitLabel, altitudeUnitLabel, formatDuration
} from '../../lib/utils'
import { ChevronLeft } from 'lucide-react'
import type { Trackpoint } from '../../types/gps'

export function TripStatsBar(): React.JSX.Element {
  const trips = useTripViewerStore((s) => s.trips)
  const selectedTripId = useTripViewerStore((s) => s.selectedTripId)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const closeDetail = useTripViewerStore((s) => s.closeDetail)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  const trip = trips.find((t) => t.id === selectedTripId)
  const name = trip?.name || `Trip #${selectedTripId}`

  const duration = trip?.startedAt && trip?.endedAt
    ? (new Date(trip.endedAt).getTime() - new Date(trip.startedAt).getTime()) / 1000
    : 0

  const { elevGain, elevLoss } = computeElevation(trackpoints)

  return (
    <div className="flex items-center h-14 px-4 border-b border-zinc-800 bg-zinc-950/90 gap-4">
      <button
        onClick={closeDetail}
        className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-200"
      >
        <ChevronLeft size={24} />
      </button>

      <span className="text-lg font-semibold text-zinc-200 truncate">{name}</span>

      <div className="flex-1" />

      <StatPill label="DIST" value={convertDistance(trip?.distanceM ?? 0, speedUnit).toFixed(1)} unit={distanceUnitLabel(speedUnit)} />
      <StatPill label="TIME" value={formatDuration(duration)} />
      <StatPill label="MAX" value={String(Math.round(convertSpeed(trip?.maxSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      <StatPill label="AVG" value={String(Math.round(convertSpeed(trip?.avgSpeed ?? 0, speedUnit)))} unit={speedUnitLabel(speedUnit)} />
      {elevGain > 0 && (
        <StatPill label="ELEV" value={`+${Math.round(convertAltitude(elevGain, altUnit))}`} unit={altitudeUnitLabel(altUnit)} />
      )}
    </div>
  )
}

function StatPill({ label, value, unit }: { label: string; value: string; unit?: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs font-semibold tracking-[1px] text-zinc-400">{label}</span>
      <span className="font-mono text-sm text-zinc-200 tabular-nums">{value}</span>
      {unit && <span className="text-xs text-zinc-400">{unit}</span>}
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
