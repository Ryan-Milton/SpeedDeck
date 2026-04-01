import { useNavigationStore } from '../../stores/navigation-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'
import { maneuverInstruction, maneuverIcon } from '../../lib/nav-utils'
import * as LucideIcons from 'lucide-react'
import { cn } from '../../lib/utils'

export function TurnBanner(): React.JSX.Element | null {
  const status = useNavigationStore((s) => s.status)
  const route = useNavigationStore((s) => s.route)
  const activeStepIndex = useNavigationStore((s) => s.activeStepIndex)
  const distToManeuver = useNavigationStore((s) => s.distanceToNextManeuver)
  const unit = useSettingsStore((s) => s.speedUnit)

  if (status !== 'navigating' || !route) return null

  const currentStep = route.steps[activeStepIndex]
  const nextStep = route.steps[activeStepIndex + 1]
  if (!nextStep) return null // at final step (arrive)

  const iconName = maneuverIcon(nextStep.maneuver.type, nextStep.maneuver.modifier)
  const Icon = (LucideIcons as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[iconName] || LucideIcons.ArrowUp
  const instruction = maneuverInstruction(nextStep.maneuver.type, nextStep.maneuver.modifier, nextStep.name)

  const distConverted = convertDistance(distToManeuver, unit)
  const distText = distToManeuver < 160 // ~0.1 mi
    ? `${Math.round(distToManeuver)} m`
    : `${distConverted.toFixed(1)} ${distanceUnitLabel(unit)}`

  const isClose = distToManeuver < 100

  // Next-next step preview
  const afterNext = route.steps[activeStepIndex + 2]
  let afterNextText = ''
  if (afterNext && afterNext.maneuver.type !== 'arrive') {
    afterNextText = maneuverInstruction(afterNext.maneuver.type, afterNext.maneuver.modifier, afterNext.name)
  }

  return (
    <div className="absolute top-4 left-4 right-4 pointer-events-none flex justify-center">
      <div
        className={cn(
          'rounded-2xl bg-surface-card/95 backdrop-blur-xl px-6 py-5 pointer-events-auto w-full max-w-[500px]',
          isClose && 'ring-2 ring-accent'
        )}
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-accent/15 flex items-center justify-center shrink-0">
            <Icon size={36} className="text-accent" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-4xl font-bold text-text-primary tabular-nums leading-tight">{distText}</span>
            <div className="text-base text-text-secondary truncate mt-1">{instruction}</div>
          </div>
        </div>

        {afterNextText && (
          <div className="mt-3 pt-3 border-t border-separator flex items-center gap-2">
            <span className="text-sm text-text-tertiary">Then</span>
            <span className="text-sm text-text-secondary truncate">{afterNextText}</span>
          </div>
        )}
      </div>
    </div>
  )
}
