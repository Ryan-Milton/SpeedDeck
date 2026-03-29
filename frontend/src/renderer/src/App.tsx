import { useGpsConnection } from './hooks/useGpsConnection'
import { useSwipeNavigation } from './hooks/useSwipeNavigation'
import { useSettingsStore } from './stores/settings-store'
import { useGpsStore } from './stores/gps-store'
import { StatusBar } from './components/shared/StatusBar'
import { ControlBar } from './components/shared/ControlBar'
import { SpeedDisplay } from './components/hud/SpeedDisplay'
import { CompassWidget } from './components/hud/CompassWidget'
import { AltitudePanel } from './components/hud/AltitudePanel'
import { CoordinatesPanel } from './components/hud/CoordinatesPanel'
import { SpeedStats } from './components/hud/SpeedStats'
import { TripDistance } from './components/hud/TripDistance'
import { SpeedGraph } from './components/trip/SpeedGraph'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { TripDetailView } from './components/trip/TripDetailView'
import { TileDownloadOverlay } from './components/map/TileDownloadOverlay'
import { LiveMap } from './components/map/LiveMap'
import { MapOverlays } from './components/map/MapOverlays'
import { convertSpeed } from './lib/utils'
import { cn } from './lib/utils'

export default function App(): React.JSX.Element {
  useGpsConnection()
  useSwipeNavigation()

  const showGraph = useSettingsStore((s) => s.showGraph)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const warningEnabled = useSettingsStore((s) => s.speedWarningEnabled)
  const warningThreshold = useSettingsStore((s) => s.speedWarningThreshold)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const smoothedSpeed = useGpsStore((s) => s.smoothedSpeed)

  const displaySpeed = Math.round(convertSpeed(smoothedSpeed, speedUnit))
  const isWarning = warningEnabled && displaySpeed > warningThreshold

  return (
    <div
      className={cn(
        'flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 select-none overflow-hidden',
        isWarning && viewMode === 'hud' && 'ring-2 ring-red-500/50 shadow-[inset_0_0_60px_rgba(248,113,113,0.1)]'
      )}
    >
      {/* Top status bar (HUD only — map has its own overlays) */}
      {viewMode === 'hud' && <StatusBar />}

      {/* Main content area */}
      {viewMode === 'hud' ? (
        <div className="flex-1 relative flex items-center justify-center min-h-0 overflow-hidden">
          <div className="absolute left-6 top-6">
            <CompassWidget />
          </div>
          <div className="absolute right-6 top-6 flex flex-col gap-4">
            <AltitudePanel />
            <CoordinatesPanel />
          </div>
          <SpeedDisplay />
          <div className="absolute left-6 bottom-4">
            <TripDistance />
          </div>
          <div className="absolute right-6 bottom-4">
            <SpeedStats />
          </div>
        </div>
      ) : (
        <div className="flex-1 relative min-h-0">
          <LiveMap />
          <MapOverlays />
        </div>
      )}

      {/* Speed graph (available in both views) */}
      {showGraph && <SpeedGraph />}

      {/* Bottom control bar */}
      <ControlBar />

      {/* Settings overlay */}
      <SettingsPanel />

      {/* Trip detail overlay */}
      <TripDetailView />

      {/* Tile download overlay */}
      <TileDownloadOverlay />
    </div>
  )
}
