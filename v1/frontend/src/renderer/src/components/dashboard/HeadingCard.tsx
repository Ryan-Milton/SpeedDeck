import { useGpsStore } from '../../stores/gps-store'
import { cardinalDirection } from '../../lib/utils'
import { Card } from '../shared/Card'

export function HeadingCard(): React.JSX.Element {
  const heading = useGpsStore((s) => s.fix?.heading ?? 0)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)

  const cardinal = cardinalDirection(heading)
  const displayHeading = hasFix ? Math.round(heading) : null

  return (
    <Card padding="sm">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
        Heading
      </span>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-[32px] font-bold text-text-primary leading-none">
          {hasFix ? cardinal : '--'}
        </span>
        <span className="text-[20px] text-text-secondary tabular-nums">
          {displayHeading !== null ? `${displayHeading}°` : ''}
        </span>
      </div>
    </Card>
  )
}
