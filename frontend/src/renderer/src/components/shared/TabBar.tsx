import { useSettingsStore } from '../../stores/settings-store'
import { Gauge, Map, Route } from 'lucide-react'
import { cn } from '../../lib/utils'

const TABS = [
  { id: 'dashboard' as const, label: 'Dashboard', icon: Gauge },
  { id: 'map' as const, label: 'Map', icon: Map },
  { id: 'trips' as const, label: 'Trips', icon: Route }
]

export function TabBar(): React.JSX.Element {
  const viewMode = useSettingsStore((s) => s.viewMode)
  const setViewMode = useSettingsStore((s) => s.setViewMode)

  return (
    <div className="flex items-center justify-around h-14 border-t border-separator bg-surface">
      {TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setViewMode(id)}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 h-full flex-1 transition-colors',
            viewMode === id ? 'text-accent' : 'text-text-secondary'
          )}
        >
          <Icon size={22} />
          <span className="text-[10px] font-semibold">{label}</span>
        </button>
      ))}
    </div>
  )
}
