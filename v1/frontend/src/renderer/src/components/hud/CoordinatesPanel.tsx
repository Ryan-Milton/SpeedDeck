import { useGpsStore } from '../../stores/gps-store'
import { formatCoord } from '../../lib/utils'

export function CoordinatesPanel(): React.JSX.Element {
  const lat = useGpsStore((s) => s.fix?.latitude)
  const lon = useGpsStore((s) => s.fix?.longitude)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">
        COORDS
      </span>
      <span className="font-mono text-lg text-zinc-200">
        {hasFix && lat !== undefined ? formatCoord(lat, true) : '--'}
      </span>
      <span className="font-mono text-lg text-zinc-200">
        {hasFix && lon !== undefined ? formatCoord(lon, false) : '--'}
      </span>
    </div>
  )
}
