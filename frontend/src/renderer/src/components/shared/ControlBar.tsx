import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useCallback, useRef, useEffect } from 'react'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { cn, speedUnitLabel } from '../../lib/utils'
import type { SpeedUnit } from '../../types/gps'

const UNITS: SpeedUnit[] = ['mph', 'kmh', 'knots']

export function ControlBar(): React.JSX.Element {
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const setSpeedUnit = useSettingsStore((s) => s.setSpeedUnit)
  const showGraph = useSettingsStore((s) => s.showGraph)
  const setShowGraph = useSettingsStore((s) => s.setShowGraph)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const toggleViewMode = useSettingsStore((s) => s.toggleViewMode)

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

  const handleTrip = useCallback(() => {
    if (tripStatus === 'idle') {
      sendCommand('trip_start')
    } else {
      sendCommand('trip_stop')
    }
  }, [tripStatus, sendCommand])

  return (
    <div className="flex items-center justify-between h-14 px-4 border-t border-zinc-800 bg-zinc-950/80">
      {/* Left: Unit toggle */}
      <div className="flex rounded-lg overflow-hidden border border-zinc-700">
        {UNITS.map((u) => (
          <button
            key={u}
            onClick={() => setSpeedUnit(u)}
            className={cn(
              'px-4 h-10 text-sm font-semibold tracking-[1px] transition-colors',
              speedUnit === u
                ? 'bg-cyan-900/50 text-cyan-400 border-cyan-400/30'
                : 'bg-zinc-800 text-zinc-300 hover:text-zinc-100'
            )}
          >
            {speedUnitLabel(u)}
          </button>
        ))}
      </div>

      {/* Center: View + Graph toggles */}
      <div className="flex gap-2">
        <button
          onClick={toggleViewMode}
          className={cn(
            'px-4 h-10 rounded-lg text-sm font-semibold tracking-[1px] border transition-colors',
            viewMode === 'map'
              ? 'bg-cyan-900/50 text-cyan-400 border-cyan-400/30'
              : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-zinc-100'
          )}
        >
          {viewMode === 'hud' ? 'MAP' : 'HUD'}
        </button>
        <button
          onClick={() => setShowGraph(!showGraph)}
          className={cn(
            'px-4 h-10 rounded-lg text-sm font-semibold tracking-[1px] border transition-colors',
            showGraph
              ? 'bg-cyan-900/50 text-cyan-400 border-cyan-400/30'
              : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-zinc-100'
          )}
        >
          GRAPH
        </button>
      </div>

      {/* Right: Trip button */}
      <button
        onClick={handleTrip}
        className={cn(
          'px-6 h-10 rounded-lg text-sm font-semibold tracking-[1px] border transition-colors min-w-[140px]',
          tripStatus !== 'idle'
            ? 'bg-red-900/30 text-red-400 border-red-800 hover:bg-red-900/50'
            : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-cyan-400 hover:border-cyan-400/30'
        )}
      >
        {tripStatus !== 'idle' ? 'STOP TRIP' : 'START TRIP'}
      </button>
    </div>
  )
}
