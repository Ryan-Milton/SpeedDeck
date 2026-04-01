import { useNavigationStore } from '../../stores/navigation-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'
import { maneuverInstruction, maneuverIcon } from '../../lib/nav-utils'
import * as LucideIcons from 'lucide-react'

export function DashboardNavOverlay(): React.JSX.Element | null {
  const status = useNavigationStore((s) => s.status)
  const route = useNavigationStore((s) => s.route)
  const activeStepIndex = useNavigationStore((s) => s.activeStepIndex)
  const distToManeuver = useNavigationStore((s) => s.distanceToNextManeuver)
  const eta = useNavigationStore((s) => s.eta)
  const distanceRemaining = useNavigationStore((s) => s.distanceRemaining)
  const currentStreetName = useNavigationStore((s) => s.currentStreetName)
  const unit = useSettingsStore((s) => s.speedUnit)

  if (status !== 'navigating' || !route) return null

  const nextStep = route.steps[activeStepIndex + 1]
  if (!nextStep) return null

  const iconName = maneuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier)
  const Icon = (LucideIcons as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[iconName] || LucideIcons.ArrowUp
  const instruction = maneuverInstruction(nextStep.maneuver.type, nextStep.maneuver.modifier, nextStep.name)

  const distConverted = convertDistance(distToManeuver, unit)
  const distText = distToManeuver < 160
    ? `${Math.round(distToManeuver)} m`
    : `${distConverted.toFixed(1)} ${distanceUnitLabel(unit)}`

  const remainingDisplay = `${convertDistance(distanceRemaining, unit).toFixed(1)} ${distanceUnitLabel(unit)}`

  return (
    <>
      {/* Top: next turn instruction */}
      <div className="absolute top-4 left-4 right-4 pointer-events-none" style={{ zIndex: 10 }}>
        <div className="rounded-2xl bg-surface-card/95 backdrop-blur-xl px-4 py-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <Icon size={22} className="text-accent" />
          </div>
          <span className="text-lg font-bold text-text-primary tabular-nums shrink-0">{distText}</span>
          <span className="text-sm text-text-secondary truncate">{instruction}</span>
        </div>
      </div>

      {/* Bottom: ETA + remaining + street name */}
      <div className="absolute bottom-4 left-4 right-4 pointer-events-none" style={{ zIndex: 10 }}>
        <div className="rounded-2xl bg-surface-card/95 backdrop-blur-xl px-4 py-2.5 flex items-center gap-3">
          <span className="text-sm font-bold text-accent tabular-nums">{eta}</span>
          <span className="text-xs text-text-secondary tabular-nums">{remainingDisplay}</span>
          {currentStreetName && (
            <>
              <span className="text-text-tertiary">&middot;</span>
              <span className="text-xs text-text-secondary truncate">{currentStreetName}</span>
            </>
          )}
        </div>
      </div>
    </>
  )
}
