import { useGpsStore } from '../../stores/gps-store'
import { cardinalDirection } from '../../lib/utils'

export function CompassWidget(): React.JSX.Element {
  const heading = useGpsStore((s) => s.fix?.heading ?? 0)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)

  const cardinal = cardinalDirection(heading)
  const displayHeading = hasFix ? Math.round(heading) : null

  return (
    <div className="flex flex-col items-start gap-1">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">
        HEADING
      </span>
      <div className="flex items-baseline gap-3">
        <span className="font-semibold tracking-[2px] text-zinc-100" style={{ fontSize: 48 }}>
          {hasFix ? cardinal : '--'}
        </span>
        <span className="font-mono text-zinc-300" style={{ fontSize: 32 }}>
          {displayHeading !== null ? `${displayHeading}°` : ''}
        </span>
      </div>
    </div>
  )
}
