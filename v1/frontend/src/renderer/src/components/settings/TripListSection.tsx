import { useEffect, useRef } from 'react'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, convertDistance, speedUnitLabel, distanceUnitLabel, formatDuration } from '../../lib/utils'
import type { TripListMessage, TrackpointsDataMessage } from '../../types/gps'

export function TripListSection(): React.JSX.Element {
  const trips = useTripViewerStore((s) => s.trips)
  const tripsLoading = useTripViewerStore((s) => s.tripsLoading)
  const selectTrip = useTripViewerStore((s) => s.selectTrip)
  const setTrips = useTripViewerStore((s) => s.setTrips)
  const setTripsLoading = useTripViewerStore((s) => s.setTripsLoading)
  const setTrackpoints = useTripViewerStore((s) => s.setTrackpoints)
  const unit = useSettingsStore((s) => s.speedUnit)

  const wsRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    wsRef.current = client

    client.onMessage = (msg): void => {
      if (msg.type === 'tripList') {
        const data = msg as TripListMessage
        setTrips(data.trips)
      } else if (msg.type === 'trackpointsData') {
        const data = msg as TrackpointsDataMessage
        setTrackpoints(data.trackpoints)
      }
    }

    client.onConnectionChange = (connected): void => {
      if (connected) {
        setTripsLoading(true)
        client.send({ type: 'command', action: 'trip_list' })
      }
    }

    client.connect()
    return (): void => client.disconnect()
  }, [setTrips, setTripsLoading, setTrackpoints])

  const handleSelect = (tripId: number): void => {
    selectTrip(tripId)
    wsRef.current?.send({ type: 'command', action: 'trip_trackpoints', tripId })
  }

  const formatDate = (iso: string): string => {
    try {
      const d = new Date(iso)
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    } catch {
      return iso
    }
  }

  const getDuration = (start: string, end: string | null): string => {
    if (!end) return '--'
    const sec = (new Date(end).getTime() - new Date(start).getTime()) / 1000
    return formatDuration(Math.max(0, sec))
  }

  return (
    <div className="space-y-3">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">TRIPS</span>

      {tripsLoading && trips.length === 0 && (
        <p className="text-sm text-zinc-400">Loading trips...</p>
      )}

      {!tripsLoading && trips.length === 0 && (
        <p className="text-sm text-zinc-400">No trips recorded yet.</p>
      )}

      {trips.length > 0 && (
        <div className="overflow-y-auto" style={{ maxHeight: 300 }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-zinc-400 tracking-[1px] uppercase">
                <th className="text-left pb-2 font-semibold">Name</th>
                <th className="text-left pb-2 font-semibold">Date</th>
                <th className="text-right pb-2 font-semibold">Duration</th>
                <th className="text-right pb-2 font-semibold">Dist</th>
                <th className="text-right pb-2 font-semibold">Max</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((trip) => (
                <tr
                  key={trip.id}
                  onClick={() => handleSelect(trip.id)}
                  className="border-t border-zinc-800 cursor-pointer hover:bg-zinc-800/50 active:bg-cyan-900/30 transition-colors"
                  style={{ height: 48 }}
                >
                  <td className="text-zinc-200 pr-3">
                    {trip.name || `Trip #${trip.id}`}
                  </td>
                  <td className="text-zinc-400 pr-3">
                    {formatDate(trip.startedAt)}
                  </td>
                  <td className="text-right text-zinc-300 font-mono pr-3 tabular-nums">
                    {getDuration(trip.startedAt, trip.endedAt)}
                  </td>
                  <td className="text-right text-zinc-300 font-mono pr-3 tabular-nums">
                    {convertDistance(trip.distanceM, unit).toFixed(1)} {distanceUnitLabel(unit)}
                  </td>
                  <td className="text-right text-zinc-300 font-mono tabular-nums">
                    {Math.round(convertSpeed(trip.maxSpeed, unit))} {speedUnitLabel(unit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
