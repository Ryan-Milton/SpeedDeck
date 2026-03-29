import { useEffect, useRef, useCallback } from 'react'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { SatelliteInfo } from '../hud/SatelliteInfo'
import { MapSpeedWidget } from './MapSpeedWidget'
import { cardinalDirection, cn } from '../../lib/utils'
import { GpsWebSocketClient } from '../../lib/ws-client'

export function MapOverlays(): React.JSX.Element {
  const heading = useGpsStore((s) => s.fix?.heading ?? 0)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)
  const tripStatus = useGpsStore((s) => s.tripStatus)

  const wsRef = useRef<GpsWebSocketClient | null>(null)

  useEffect(() => {
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    wsRef.current = client
    client.connect()
    return (): void => client.disconnect()
  }, [])

  const handleTrip = useCallback(() => {
    if (tripStatus === 'idle') {
      wsRef.current?.send({ type: 'command', action: 'trip_start' })
    } else {
      wsRef.current?.send({ type: 'command', action: 'trip_stop' })
    }
  }, [tripStatus])

  const cardinal = cardinalDirection(heading)
  const displayHeading = hasFix ? Math.round(heading) : null

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between" style={{ padding: 16 }}>
      {/* Top row */}
      <div className="flex items-start justify-between">
        {/* Top-left: satellite status */}
        <div className="pointer-events-auto rounded-lg" style={{ background: 'rgba(9,9,11,0.7)', padding: '8px 12px' }}>
          <SatelliteInfo />
        </div>

        {/* Top-right: heading */}
        <div className="rounded-lg flex items-baseline gap-2" style={{ background: 'rgba(9,9,11,0.7)', padding: '8px 16px' }}>
          <span className="font-semibold tracking-[2px] text-zinc-100" style={{ fontSize: 28 }}>
            {hasFix ? cardinal : '--'}
          </span>
          <span className="font-mono text-zinc-300" style={{ fontSize: 20 }}>
            {displayHeading !== null ? `${displayHeading}°` : ''}
          </span>
        </div>
      </div>

      {/* Bottom row */}
      <div className="flex items-end justify-between">
        {/* Bottom-left: speed */}
        <div className="pointer-events-auto">
          <MapSpeedWidget />
        </div>

        {/* Bottom-right: trip control */}
        <button
          onClick={handleTrip}
          className={cn(
            'pointer-events-auto rounded-lg text-sm font-semibold tracking-[1px] border transition-colors',
            tripStatus !== 'idle'
              ? 'bg-red-900/60 text-red-400 border-red-800'
              : 'bg-zinc-900/80 text-zinc-300 border-zinc-700'
          )}
          style={{ padding: '12px 24px', backdropFilter: 'blur(8px)' }}
        >
          {tripStatus !== 'idle' ? 'STOP TRIP' : 'START TRIP'}
        </button>
      </div>
    </div>
  )
}
