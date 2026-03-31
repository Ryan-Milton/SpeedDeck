import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, speedUnitLabel } from '../../lib/utils'

export function MapSpeedWidget(): React.JSX.Element {
  const smoothedSpeed = useGpsStore((s) => s.smoothedSpeed)
  const fix = useGpsStore((s) => s.fix)
  const unit = useSettingsStore((s) => s.speedUnit)

  const hasFix = fix !== null && fix.fixQuality > 0
  const speed = hasFix ? Math.round(convertSpeed(smoothedSpeed, unit)) : null

  return (
    <div className="rounded-2xl flex flex-col items-center justify-center bg-surface-card/90 backdrop-blur-xl px-5 py-3" style={{ minWidth: 100 }}>
      <span
        className="font-bold leading-none tabular-nums text-text-primary"
        style={{ fontSize: 64 }}
      >
        {speed !== null ? speed : '--'}
      </span>
      <span className="text-text-secondary font-semibold tracking-wide uppercase" style={{ fontSize: 18, marginTop: -4 }}>
        {speedUnitLabel(unit)}
      </span>
    </div>
  )
}
