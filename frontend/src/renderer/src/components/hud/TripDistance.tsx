import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'

export function TripDistance(): React.JSX.Element {
  const tripDistance = useGpsStore((s) => s.tripDistance)
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const unit = useSettingsStore((s) => s.speedUnit)

  const isActive = tripStatus !== 'idle'
  const displayDist = convertDistance(tripDistance, unit)

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">
        TRIP DIST
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[28px] text-zinc-100 tabular-nums">
          {isActive ? displayDist.toFixed(1) : '--'}
        </span>
        <span className="text-sm font-semibold tracking-[1px] text-zinc-400">
          {distanceUnitLabel(unit)}
        </span>
      </div>
    </div>
  )
}
