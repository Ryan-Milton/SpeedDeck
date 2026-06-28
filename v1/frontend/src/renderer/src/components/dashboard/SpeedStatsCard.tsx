import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed } from '../../lib/utils'
import { Card } from '../shared/Card'

export function SpeedStatsCard(): React.JSX.Element {
  const maxSpeed = useGpsStore((s) => s.maxSpeed)
  const avgSpeed = useGpsStore((s) => s.avgSpeed)
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const tripMaxSpeed = useGpsStore((s) => s.tripMaxSpeed)
  const tripAvgSpeed = useGpsStore((s) => s.tripAvgSpeed)
  const unit = useSettingsStore((s) => s.speedUnit)

  const isTrip = tripStatus !== 'idle'
  const displayMax = Math.round(convertSpeed(isTrip ? tripMaxSpeed : maxSpeed, unit))
  const displayAvg = Math.round(convertSpeed(isTrip ? tripAvgSpeed : avgSpeed, unit))

  return (
    <Card padding="sm">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
        {isTrip ? 'Trip' : 'Session'}
      </span>
      <div className="flex items-baseline gap-3 mt-1">
        <div className="flex items-baseline gap-1">
          <span className="text-[13px] font-semibold text-text-secondary">MAX</span>
          <span className="text-[28px] font-bold text-text-primary tabular-nums leading-none">{displayMax}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-[13px] font-semibold text-text-secondary">AVG</span>
          <span className="text-[28px] font-bold text-text-primary tabular-nums leading-none">{displayAvg}</span>
        </div>
      </div>
    </Card>
  )
}
