import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, speedUnitLabel, cn } from '../../lib/utils'

export function SpeedDisplay(): React.JSX.Element {
  const smoothedSpeed = useGpsStore((s) => s.smoothedSpeed)
  const fix = useGpsStore((s) => s.fix)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const cycleSpeedUnit = useSettingsStore((s) => s.cycleSpeedUnit)
  const warningEnabled = useSettingsStore((s) => s.speedWarningEnabled)
  const warningThreshold = useSettingsStore((s) => s.speedWarningThreshold)

  const hasFix = fix !== null && fix.fixQuality > 0
  const displaySpeed = hasFix ? Math.round(convertSpeed(smoothedSpeed, speedUnit)) : null
  const isWarning = warningEnabled && displaySpeed !== null && displaySpeed > warningThreshold

  return (
    <div
      className="relative flex flex-col items-center justify-center cursor-pointer"
      onClick={cycleSpeedUnit}
      style={{ width: 680, height: 680 }}
    >
      {/* Speed arc gauge — absolute behind the number */}
      <div className="absolute inset-0">
        <SpeedArc
          speed={displaySpeed ?? 0}
          maxSpeed={warningThreshold > 0 ? warningThreshold * 1.5 : 120}
          isWarning={isWarning}
        />
      </div>

      {/* Speed number — centered on top of arc */}
      <div className="relative z-10 flex flex-col items-center">
        <span
          className={cn(
            'font-mono leading-none tracking-tighter tabular-nums',
            isWarning
              ? 'text-red-400'
              : 'text-cyan-400',
            !hasFix && 'text-zinc-500'
          )}
          style={{
            fontSize: 320,
            textShadow: isWarning
              ? '0 0 60px rgba(248,113,113,0.4)'
              : '0 0 40px rgba(34,211,238,0.3)'
          }}
        >
          {displaySpeed !== null ? displaySpeed : '--'}
        </span>

        {/* Unit label */}
        <span
          className={cn(
            'font-medium tracking-[3px] uppercase',
            isWarning ? 'text-red-300/70' : 'text-cyan-300/70'
          )}
          style={{ fontSize: 56, marginTop: -16 }}
        >
          {speedUnitLabel(speedUnit)}
        </span>

        {isWarning && (
          <span className="mt-2 text-sm font-semibold tracking-[3px] uppercase text-red-400 animate-pulse">
            SPEED WARNING
          </span>
        )}
      </div>
    </div>
  )
}

function SpeedArc({
  speed,
  maxSpeed,
  isWarning
}: {
  speed: number
  maxSpeed: number
  isWarning: boolean
}): React.JSX.Element {
  const size = 680
  const radius = 310
  const strokeWidth = 10
  const center = size / 2

  // 270-degree arc (from 135deg to 405deg)
  const startAngle = 135
  const endAngle = 405
  const totalArc = endAngle - startAngle

  const progress = Math.min(speed / maxSpeed, 1)
  const sweepAngle = totalArc * progress

  const toXY = (angle: number): { x: number; y: number } => {
    const rad = (angle * Math.PI) / 180
    return {
      x: center + radius * Math.cos(rad),
      y: center + radius * Math.sin(rad)
    }
  }

  const start = toXY(startAngle)
  const bgEnd = toXY(endAngle)
  const fillEnd = toXY(startAngle + sweepAngle)

  const largeArcBg = totalArc > 180 ? 1 : 0
  const largeArcFill = sweepAngle > 180 ? 1 : 0

  const bgPath = `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcBg} 1 ${bgEnd.x} ${bgEnd.y}`
  const fillPath =
    progress > 0.005
      ? `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFill} 1 ${fillEnd.x} ${fillEnd.y}`
      : ''

  return (
    <svg width={size} height={size} className="opacity-60">
      {/* Background arc */}
      <path d={bgPath} fill="none" stroke="#27272a" strokeWidth={strokeWidth} strokeLinecap="round" />
      {/* Fill arc */}
      {fillPath && (
        <path
          d={fillPath}
          fill="none"
          stroke={isWarning ? '#f87171' : '#22d3ee'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{
            transition: 'all 500ms ease-out',
            filter: `drop-shadow(0 0 8px ${isWarning ? 'rgba(248,113,113,0.5)' : 'rgba(34,211,238,0.5)'})`
          }}
        />
      )}
    </svg>
  )
}
