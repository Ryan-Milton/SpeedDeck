import { useGpsStore } from '../../stores/gps-store'
import { SatelliteInfo } from '../hud/SatelliteInfo'
import { MapSpeedWidget } from './MapSpeedWidget'
import { cardinalDirection } from '../../lib/utils'

export function MapOverlays(): React.JSX.Element {
  const heading = useGpsStore((s) => s.fix?.heading ?? 0)
  const hasFix = useGpsStore((s) => s.fix !== null && s.fix.fixQuality > 0)

  const cardinal = cardinalDirection(heading)
  const displayHeading = hasFix ? Math.round(heading) : null

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between" style={{ padding: 16 }}>
      {/* Top row */}
      <div className="flex items-start justify-between">
        {/* Top-left: satellite status + heading */}
        <div className="flex flex-col gap-2">
          <div className="pointer-events-auto rounded-lg" style={{ background: 'rgba(9,9,11,0.7)', padding: '8px 12px' }}>
            <SatelliteInfo />
          </div>
          <div className="rounded-lg flex items-baseline gap-2" style={{ background: 'rgba(9,9,11,0.7)', padding: '8px 16px' }}>
            <span className="font-semibold tracking-[2px] text-zinc-100" style={{ fontSize: 28 }}>
              {hasFix ? cardinal : '--'}
            </span>
            <span className="font-mono text-zinc-300" style={{ fontSize: 20 }}>
              {displayHeading !== null ? `${displayHeading}°` : ''}
            </span>
          </div>
        </div>

        {/* Top-right: speed */}
        <div className="pointer-events-auto">
          <MapSpeedWidget />
        </div>
      </div>
    </div>
  )
}
