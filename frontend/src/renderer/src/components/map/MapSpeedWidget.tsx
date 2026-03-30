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
    <div
      className="rounded-lg flex flex-col items-center justify-center"
      style={{
        background: 'rgba(9, 9, 11, 0.8)',
        backdropFilter: 'blur(8px)',
        padding: '12px 20px',
        minWidth: 100
      }}
    >
      <span
        className="font-mono leading-none tabular-nums text-cyan-400"
        style={{
          fontSize: 72,
          textShadow: '0 0 30px rgba(34, 211, 238, 0.3)'
        }}
      >
        {speed !== null ? speed : '--'}
      </span>
      <span className="text-cyan-300/70 font-medium tracking-[2px] uppercase" style={{ fontSize: 18, marginTop: -4 }}>
        {speedUnitLabel(unit)}
      </span>
    </div>
  )
}
