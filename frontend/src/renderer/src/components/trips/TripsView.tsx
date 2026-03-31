import { useEffect, useRef, useCallback } from 'react'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useGpsStore } from '../../stores/gps-store'
import { convertSpeed, convertDistance, speedUnitLabel, distanceUnitLabel, formatDuration } from '../../lib/utils'
import { Card } from '../shared/Card'
import type { TripListMessage, TrackpointsDataMessage } from '../../types/gps'

export function TripsView(): React.JSX.Element {
  const trips = useTripViewerStore((s) => s.trips)
  const tripsLoading = useTripViewerStore((s) => s.tripsLoading)
  const selectTrip = useTripViewerStore((s) => s.selectTrip)
  const setTrips = useTripViewerStore((s) => s.setTrips)
  const setTripsLoading = useTripViewerStore((s) => s.setTripsLoading)
  const setTrackpoints = useTripViewerStore((s) => s.setTrackpoints)
  const unit = useSettingsStore((s) => s.speedUnit)
  const tripStatus = useGpsStore((s) => s.tripStatus)

  const wsRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    wsRef.current = client

    client.onMessage = (msg): void => {
      if (msg.type === 'tripList') {
        setTrips((msg as TripListMessage).trips)
      } else if (msg.type === 'trackpointsData') {
        setTrackpoints((msg as TrackpointsDataMessage).trackpoints)
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

  const sendCommand = useCallback((action: string) => {
    wsRef.current?.send({ type: 'command', action })
  }, [])

  const handleSelect = (tripId: number): void => {
    selectTrip(tripId)
    wsRef.current?.send({ type: 'command', action: 'trip_trackpoints', tripId })
  }

  const handleTrip = useCallback(() => {
    if (tripStatus === 'idle') {
      sendCommand('trip_start')
    } else {
      sendCommand('trip_stop')
    }
  }, [tripStatus, sendCommand])

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
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-4">
      {/* Start/Stop trip button */}
      <button
        onClick={handleTrip}
        className={
          tripStatus !== 'idle'
            ? 'h-12 rounded-full text-sm font-semibold bg-danger/15 text-danger active:bg-danger/25 transition-colors'
            : 'h-12 rounded-full text-sm font-semibold bg-accent text-white active:bg-accent/80 transition-colors'
        }
      >
        {tripStatus !== 'idle' ? 'Stop Trip' : 'Start Trip'}
      </button>

      {/* Trip list */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {tripsLoading && trips.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-8">Loading trips...</p>
        )}

        {!tripsLoading && trips.length === 0 && (
          <p className="text-sm text-text-secondary text-center py-8">No trips recorded yet.</p>
        )}

        {trips.map((trip) => (
          <Card
            key={trip.id}
            padding="sm"
            onClick={() => handleSelect(trip.id)}
            className="flex items-center gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text-primary truncate">
                {trip.name || `Trip #${trip.id}`}
              </div>
              <div className="text-xs text-text-secondary">
                {formatDate(trip.startedAt)}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-text-secondary shrink-0">
              <span className="tabular-nums">{getDuration(trip.startedAt, trip.endedAt)}</span>
              <span className="tabular-nums">{convertDistance(trip.distanceM, unit).toFixed(1)} {distanceUnitLabel(unit)}</span>
              <span className="tabular-nums">{Math.round(convertSpeed(trip.maxSpeed, unit))} {speedUnitLabel(unit)}</span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
