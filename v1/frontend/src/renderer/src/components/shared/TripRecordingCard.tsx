import { useCallback, useEffect, useRef } from 'react'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel, formatDuration, cn } from '../../lib/utils'
import { GpsWebSocketClient } from '../../lib/ws-client'

export function TripRecordingCard(): React.JSX.Element | null {
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const tripDuration = useGpsStore((s) => s.tripDuration)
  const tripDistance = useGpsStore((s) => s.tripDistance)
  const unit = useSettingsStore((s) => s.speedUnit)

  const wsRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    wsRef.current = client
    client.connect()
    return (): void => client.disconnect()
  }, [])

  const sendCommand = useCallback((action: string) => {
    wsRef.current?.send({ type: 'command', action })
  }, [])

  if (tripStatus === 'idle') return null

  const isPaused = tripStatus === 'paused'

  return (
    <div
      className="rounded-2xl bg-surface-card px-4 py-3 flex items-center gap-3 cursor-pointer active:bg-surface-active transition-colors"
      onClick={() => sendCommand('trip_stop')}
    >
      <div className={cn('w-2.5 h-2.5 rounded-full', isPaused ? 'bg-warning' : 'bg-danger animate-pulse')} />
      <span className="text-sm font-semibold text-text-primary">
        {isPaused ? 'Paused' : 'Recording'}
      </span>
      <span className="text-sm text-text-secondary tabular-nums">
        {formatDuration(tripDuration)}
      </span>
      <span className="text-sm text-text-secondary tabular-nums">
        {convertDistance(tripDistance, unit).toFixed(1)} {distanceUnitLabel(unit)}
      </span>
      <div className="flex-1" />
      <span className="text-xs font-semibold text-danger">Stop</span>
    </div>
  )
}
