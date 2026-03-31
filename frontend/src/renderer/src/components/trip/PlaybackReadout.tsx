import { usePlaybackStore } from '../../stores/playback-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, convertAltitude, speedUnitLabel, altitudeUnitLabel } from '../../lib/utils'

export function PlaybackReadout(): React.JSX.Element {
  const speed = usePlaybackStore((s) => s.speed)
  const altitude = usePlaybackStore((s) => s.altitude)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  const displaySpeed = Math.round(convertSpeed(speed, speedUnit))
  const displayAlt = altitude != null ? Math.round(convertAltitude(altitude, altUnit)) : null

  return (
    <div className="absolute top-4 right-4 pointer-events-none">
      <div className="rounded-2xl bg-surface-card/90 backdrop-blur-xl px-5 py-3 flex flex-col items-center" style={{ minWidth: 100 }}>
        <span className="font-bold leading-none tabular-nums text-text-primary" style={{ fontSize: 48 }}>
          {displaySpeed}
        </span>
        <span className="text-text-secondary font-semibold tracking-wide uppercase" style={{ fontSize: 14, marginTop: -2 }}>
          {speedUnitLabel(speedUnit)}
        </span>
        {displayAlt !== null && (
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-[16px] font-semibold text-text-secondary tabular-nums">
              {displayAlt.toLocaleString()}
            </span>
            <span className="text-[11px] text-text-tertiary">
              {altitudeUnitLabel(altUnit)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
