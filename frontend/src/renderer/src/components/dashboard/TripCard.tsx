import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'
import { Card } from '../shared/Card'

export function TripCard(): React.JSX.Element {
  const tripDistance = useGpsStore((s) => s.tripDistance)
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const unit = useSettingsStore((s) => s.speedUnit)

  const isActive = tripStatus !== 'idle'
  const displayDist = convertDistance(tripDistance, unit)

  return (
    <Card padding="sm">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
        Trip Dist
      </span>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-[32px] font-bold text-text-primary tabular-nums leading-none">
          {isActive ? displayDist.toFixed(1) : '--'}
        </span>
        <span className="text-[14px] font-semibold text-text-secondary">
          {distanceUnitLabel(unit)}
        </span>
      </div>
    </Card>
  )
}
