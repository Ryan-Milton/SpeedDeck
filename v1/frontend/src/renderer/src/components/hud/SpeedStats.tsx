import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, speedUnitLabel } from '../../lib/utils'

export function SpeedStats(): React.JSX.Element {
  const maxSpeed = useGpsStore((s) => s.maxSpeed)
  const avgSpeed = useGpsStore((s) => s.avgSpeed)
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const tripMaxSpeed = useGpsStore((s) => s.tripMaxSpeed)
  const tripAvgSpeed = useGpsStore((s) => s.tripAvgSpeed)
  const unit = useSettingsStore((s) => s.speedUnit)

  // Show trip stats when recording, session stats otherwise
  const isTrip = tripStatus !== 'idle'
  const displayMax = Math.round(convertSpeed(isTrip ? tripMaxSpeed : maxSpeed, unit))
  const displayAvg = Math.round(convertSpeed(isTrip ? tripAvgSpeed : avgSpeed, unit))

  return (
    <div className="flex flex-col items-end gap-1">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">
        {isTrip ? 'TRIP' : 'SESSION'}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold tracking-[1px] text-zinc-400">MAX</span>
        <span className="font-mono text-[28px] text-zinc-100 tabular-nums">{displayMax}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold tracking-[1px] text-zinc-400">AVG</span>
        <span className="font-mono text-[28px] text-zinc-100 tabular-nums">{displayAvg}</span>
      </div>
    </div>
  )
}
