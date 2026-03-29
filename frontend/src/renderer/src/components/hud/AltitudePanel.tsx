import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertAltitude, altitudeUnitLabel } from '../../lib/utils'

export function AltitudePanel(): React.JSX.Element {
  const altitude = useGpsStore((s) => s.fix?.altitude)
  const fixQuality = useGpsStore((s) => s.fix?.fixQuality ?? 0)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  // Altitude requires 3D fix
  const hasAltitude = altitude !== null && altitude !== undefined && fixQuality >= 1

  const displayAlt = hasAltitude ? Math.round(convertAltitude(altitude, altUnit)) : null

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">
        ALT
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[28px] text-zinc-100 tabular-nums">
          {displayAlt !== null ? displayAlt.toLocaleString() : '--'}
        </span>
        <span className="text-sm font-semibold tracking-[1px] text-zinc-400">
          {altitudeUnitLabel(altUnit)}
        </span>
      </div>
    </div>
  )
}
