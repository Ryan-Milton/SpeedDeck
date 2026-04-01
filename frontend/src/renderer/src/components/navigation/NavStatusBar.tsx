import { useNavigationStore } from '../../stores/navigation-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertDistance, distanceUnitLabel } from '../../lib/utils'

export function NavStatusBar(): React.JSX.Element | null {
  const status = useNavigationStore((s) => s.status)
  const eta = useNavigationStore((s) => s.eta)
  const distanceRemaining = useNavigationStore((s) => s.distanceRemaining)
  const durationRemaining = useNavigationStore((s) => s.durationRemaining)
  const stopNavigation = useNavigationStore((s) => s.stopNavigation)
  const unit = useSettingsStore((s) => s.speedUnit)

  if (status !== 'navigating') return null

  const distDisplay = `${convertDistance(distanceRemaining, unit).toFixed(1)} ${distanceUnitLabel(unit)}`
  const minRemaining = Math.ceil(durationRemaining / 60)
  const timeDisplay = minRemaining >= 60
    ? `${Math.floor(minRemaining / 60)}h ${minRemaining % 60}m`
    : `${minRemaining} min`

  return (
    <div className="absolute bottom-4 left-4 right-4 pointer-events-none">
      <div className="rounded-2xl bg-surface-card/95 backdrop-blur-xl px-5 py-3 pointer-events-auto flex items-center gap-4">
        <div className="flex-1 flex items-baseline gap-3">
          <span className="text-lg font-bold text-accent tabular-nums">{eta}</span>
          <span className="text-sm text-text-secondary tabular-nums">{distDisplay}</span>
          <span className="text-sm text-text-secondary">&middot;</span>
          <span className="text-sm text-text-secondary">{timeDisplay}</span>
        </div>
        <button
          onClick={stopNavigation}
          className="h-10 px-5 rounded-full text-sm font-semibold bg-danger/15 text-danger active:bg-danger/25 transition-colors"
        >
          End
        </button>
      </div>
    </div>
  )
}
