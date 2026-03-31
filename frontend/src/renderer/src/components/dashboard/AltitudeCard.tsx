import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertAltitude, altitudeUnitLabel } from '../../lib/utils'
import { Card } from '../shared/Card'

export function AltitudeCard(): React.JSX.Element {
  const altitude = useGpsStore((s) => s.fix?.altitude)
  const fixQuality = useGpsStore((s) => s.fix?.fixQuality ?? 0)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  const hasAltitude = altitude !== null && altitude !== undefined && fixQuality >= 1
  const displayAlt = hasAltitude ? Math.round(convertAltitude(altitude, altUnit)) : null

  return (
    <Card padding="sm">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">
        Altitude
      </span>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className="text-[32px] font-bold text-text-primary tabular-nums leading-none">
          {displayAlt !== null ? displayAlt.toLocaleString() : '--'}
        </span>
        <span className="text-[14px] font-semibold text-text-secondary">
          {altitudeUnitLabel(altUnit)}
        </span>
      </div>
    </Card>
  )
}
