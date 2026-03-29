import { useGpsStore } from '../../stores/gps-store'
import { SatelliteInfo } from '../hud/SatelliteInfo'
import { formatDuration, cn } from '../../lib/utils'
import { Settings } from 'lucide-react'
import { useSettingsStore } from '../../stores/settings-store'

export function StatusBar(): React.JSX.Element {
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const tripDuration = useGpsStore((s) => s.tripDuration)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)

  return (
    <div className="flex items-center justify-between h-10 px-4 border-b border-zinc-800 bg-zinc-950/80">
      {/* Left: GPS status */}
      <SatelliteInfo />

      {/* Center: Trip timer */}
      <div className="flex items-center gap-3">
        {tripStatus !== 'idle' && (
          <>
            <span className="font-mono text-[13px] text-zinc-400">TRIP</span>
            <span className="font-mono text-[13px] text-zinc-200 tabular-nums">
              {formatDuration(tripDuration)}
            </span>
            {tripStatus === 'recording' && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shadow-[0_0_5px_theme(colors.red.400)]" />
                <span className="font-mono text-[13px] font-semibold text-red-400">REC</span>
              </div>
            )}
            {tripStatus === 'paused' && (
              <span className="font-mono text-[13px] font-semibold text-yellow-400">PAUSED</span>
            )}
          </>
        )}
      </div>

      {/* Right: Settings gear */}
      <button
        onClick={toggleSettings}
        className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-zinc-200 active:text-cyan-400 transition-colors"
      >
        <Settings size={20} />
      </button>
    </div>
  )
}
