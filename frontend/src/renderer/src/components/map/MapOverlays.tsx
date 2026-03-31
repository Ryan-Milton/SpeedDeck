import { useGpsStore } from '../../stores/gps-store'
import { MapSpeedWidget } from './MapSpeedWidget'
import { cardinalDirection, cn } from '../../lib/utils'

export function MapOverlays({ compact }: { compact?: boolean }): React.JSX.Element {
  const heading = useGpsStore((s) => s.fix?.heading ?? 0)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)
  const connected = useGpsStore((s) => s.connected)
  const fixQuality = useGpsStore((s) => s.fix?.fixQuality ?? 0)

  const cardinal = cardinalDirection(heading)
  const displayHeading = hasFix ? Math.round(heading) : null

  // GPS status dot color
  let dotColor = 'bg-danger'
  if (connected && fixQuality > 0) dotColor = 'bg-success'
  else if (connected) dotColor = 'bg-warning'

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4">
      {/* Top row */}
      <div className="flex items-start justify-between">
        {/* Top-left: GPS status pill + heading */}
        <div className="flex flex-col gap-2">
          <div className="pointer-events-auto rounded-2xl px-3 py-2 bg-surface-card/90 backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <div className={cn('w-2 h-2 rounded-full animate-pulse', dotColor)} />
              <span className="text-[13px] font-semibold text-text-secondary">
                {!connected ? 'No GPS' : fixQuality === 0 ? 'Acquiring' : 'GPS'}
              </span>
            </div>
          </div>
          {!compact && (
            <div className="rounded-2xl flex items-baseline gap-2 px-4 py-2 bg-surface-card/90 backdrop-blur-xl">
              <span className="font-semibold text-text-primary" style={{ fontSize: 28 }}>
                {hasFix ? cardinal : '--'}
              </span>
              <span className="text-text-secondary" style={{ fontSize: 20 }}>
                {displayHeading !== null ? `${displayHeading}°` : ''}
              </span>
            </div>
          )}
        </div>

        {/* Top-right: speed (full map mode only) */}
        {!compact && (
          <div className="pointer-events-auto">
            <MapSpeedWidget />
          </div>
        )}
      </div>
    </div>
  )
}
