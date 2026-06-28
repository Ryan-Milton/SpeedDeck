import { useState, useEffect } from 'react'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel, formatDuration } from '../../lib/utils'
import { Card } from '../shared/Card'

export function TripCard(): React.JSX.Element {
  const tripDistance = useGpsStore((s) => s.tripDistance)
  const tripStatus = useGpsStore((s) => s.tripStatus)
  const unit = useSettingsStore((s) => s.speedUnit)

  const isActive = tripStatus !== 'idle'
  const displayDist = convertDistance(tripDistance, unit)

  if (isActive) {
    return (
      <Card padding="sm">
        <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
          Trip Dist
        </span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-[32px] font-bold text-text-primary tabular-nums leading-none">
            {displayDist.toFixed(1)}
          </span>
          <span className="text-[14px] font-semibold text-text-secondary">
            {distanceUnitLabel(unit)}
          </span>
        </div>
      </Card>
    )
  }

  return <SessionTimerCard />
}

function SessionTimerCard(): React.JSX.Element {
  const sessionStart = useGpsStore((s) => s.sessionStart)
  const [elapsed, setElapsed] = useState(0)

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => {
      if (sessionStart) {
        setElapsed(Math.floor((Date.now() - sessionStart) / 1000))
      }
    }, 1000)
    return (): void => clearInterval(interval)
  }, [sessionStart])

  return (
    <Card padding="sm">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
        Session
      </span>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-[32px] font-bold text-text-primary tabular-nums leading-none">
          {elapsed > 0 ? formatDuration(elapsed) : '--:--:--'}
        </span>
      </div>
    </Card>
  )
}
