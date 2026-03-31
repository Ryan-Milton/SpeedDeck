import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, speedUnitLabel, cn } from '../../lib/utils'
import { Card } from '../shared/Card'

export function SpeedCard(): React.JSX.Element {
  const smoothedSpeed = useGpsStore((s) => s.smoothedSpeed)
  const fix = useGpsStore((s) => s.fix)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const cycleSpeedUnit = useSettingsStore((s) => s.cycleSpeedUnit)
  const warningEnabled = useSettingsStore((s) => s.speedWarningEnabled)
  const warningThreshold = useSettingsStore((s) => s.speedWarningThreshold)

  const hasFix = fix !== null && fix.fixQuality > 0
  const displaySpeed = hasFix ? Math.round(convertSpeed(smoothedSpeed, speedUnit)) : null
  const isWarning = warningEnabled && displaySpeed !== null && displaySpeed > warningThreshold

  const maxForBar = warningThreshold > 0 ? warningThreshold * 1.5 : 120
  const barProgress = Math.min((displaySpeed ?? 0) / maxForBar, 1)

  return (
    <Card
      className={cn(
        'flex flex-col items-center justify-center',
        isWarning && 'bg-danger/10'
      )}
      onClick={cycleSpeedUnit}
    >
      <span
        className={cn(
          'font-extrabold leading-none tabular-nums',
          isWarning ? 'text-danger' : 'text-text-primary',
          !hasFix && 'text-text-tertiary'
        )}
        style={{ fontSize: 160 }}
      >
        {displaySpeed !== null ? displaySpeed : '--'}
      </span>

      <span
        className={cn(
          'font-semibold tracking-wide uppercase',
          isWarning ? 'text-danger/70' : 'text-text-secondary'
        )}
        style={{ fontSize: 24, marginTop: -8 }}
      >
        {speedUnitLabel(speedUnit)}
      </span>

      {/* Speed bar */}
      <div className="w-full h-2 rounded-full bg-surface-active mt-4">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isWarning ? 'bg-danger' : 'bg-accent'
          )}
          style={{ width: `${barProgress * 100}%` }}
        />
      </div>

      {isWarning && (
        <span className="mt-2 text-sm font-semibold tracking-wide uppercase text-danger animate-pulse">
          Speed Warning
        </span>
      )}
    </Card>
  )
}
