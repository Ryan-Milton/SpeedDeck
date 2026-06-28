import { useNavigationStore } from '../../stores/navigation-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel, formatDuration } from '../../lib/utils'
import { maneuverInstruction, maneuverIcon } from '../../lib/nav-utils'
import * as LucideIcons from 'lucide-react'
import { Card } from '../shared/Card'

export function RoutePreview(): React.JSX.Element | null {
  const status = useNavigationStore((s) => s.status)
  const route = useNavigationStore((s) => s.route)
  const origin = useNavigationStore((s) => s.origin)
  const destination = useNavigationStore((s) => s.destination)
  const startNavigation = useNavigationStore((s) => s.startNavigation)
  const stopNavigation = useNavigationStore((s) => s.stopNavigation)
  const isCalculating = useNavigationStore((s) => s.isCalculating)
  const unit = useSettingsStore((s) => s.speedUnit)

  if (isCalculating) {
    return (
      <div className="absolute bottom-4 left-4 right-4">
        <Card className="flex items-center justify-center py-6">
          <span className="text-text-secondary animate-pulse">Calculating route...</span>
        </Card>
      </div>
    )
  }

  if (status !== 'previewing' || !route) return null

  const distDisplay = `${convertDistance(route.distance, unit).toFixed(1)} ${distanceUnitLabel(unit)}`
  const durationDisplay = formatDuration(Math.round(route.duration))

  return (
    <div className="absolute bottom-4 left-4 right-4">
      <Card className="flex items-center gap-4">
        <div className="flex-1">
          <div className="text-xs text-text-secondary truncate">
            From: {origin?.name ?? 'My Location'}
          </div>
          <div className="text-sm font-semibold text-text-primary truncate">
            To: {destination?.name ?? 'Destination'}
          </div>
          <div className="text-xs text-text-secondary">
            {distDisplay} &middot; {durationDisplay}
          </div>
        </div>
        <button
          onClick={stopNavigation}
          className="h-12 px-5 rounded-2xl text-sm font-semibold bg-surface-active text-text-primary active:bg-separator transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={startNavigation}
          className="h-12 px-8 rounded-2xl text-sm font-semibold bg-accent text-white active:bg-accent/80 transition-colors"
        >
          Go
        </button>
      </Card>
    </div>
  )
}
