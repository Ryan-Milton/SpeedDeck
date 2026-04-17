import { useEffect, useRef, useCallback, useState } from 'react'
import { useGpsConnection } from './hooks/useGpsConnection'
import { useSwipeNavigation } from './hooks/useSwipeNavigation'
import { useSettingsStore } from './stores/settings-store'
import { useGpsStore } from './stores/gps-store'
import { GpsWebSocketClient } from './lib/ws-client'
import { GPS_WS_URL } from './lib/constants'
import { StatusBar } from './components/shared/StatusBar'
import { TabBar } from './components/shared/TabBar'
import { TripRecordingCard } from './components/shared/TripRecordingCard'
import { SpeedCard } from './components/dashboard/SpeedCard'
import { HeadingCard } from './components/dashboard/HeadingCard'
import { AltitudeCard } from './components/dashboard/AltitudeCard'
import { TripCard } from './components/dashboard/TripCard'
import { SpeedStatsCard } from './components/dashboard/SpeedStatsCard'
import { SpeedGraph } from './components/trip/SpeedGraph'
import { SettingsPanel } from './components/settings/SettingsPanel'
import { TripDetailView } from './components/trip/TripDetailView'
import { TileDownloadOverlay } from './components/map/TileDownloadOverlay'
import { LiveMap } from './components/map/LiveMap'
import { MapOverlays } from './components/map/MapOverlays'
import { TripsView } from './components/trips/TripsView'
import { useNavigation } from './hooks/useNavigation'
import { SearchOverlay } from './components/navigation/SearchOverlay'
import { RoutePreview } from './components/navigation/RoutePreview'
import { TurnBanner } from './components/navigation/TurnBanner'
import { NavStatusBar } from './components/navigation/NavStatusBar'
import { DashboardNavOverlay } from './components/navigation/DashboardNavOverlay'
import { RoutingDataOverlay } from './components/navigation/RoutingDataOverlay'
import { ConfirmDialog } from './components/shared/ConfirmDialog'
import { ToastContainer } from './components/shared/Toast'
import { convertSpeed } from './lib/utils'
import { cn } from './lib/utils'

export default function App(): React.JSX.Element {
  useGpsConnection()
  useSwipeNavigation()
  useNavigation()

  const showGraph = useSettingsStore((s) => s.showGraph)
  const viewMode = useSettingsStore((s) => s.viewMode)
  const warningEnabled = useSettingsStore((s) => s.speedWarningEnabled)
  const warningThreshold = useSettingsStore((s) => s.speedWarningThreshold)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const smoothedSpeed = useGpsStore((s) => s.smoothedSpeed)

  const tripStatus = useGpsStore((s) => s.tripStatus)

  const [confirmStopTrip, setConfirmStopTrip] = useState(false)

  const displaySpeed = Math.round(convertSpeed(smoothedSpeed, speedUnit))
  const isWarning = warningEnabled && displaySpeed > warningThreshold

  // Trip command WS client
  const tripWsRef = useRef<GpsWebSocketClient | null>(null)
  useEffect(() => {
    const client = new GpsWebSocketClient(GPS_WS_URL)
    tripWsRef.current = client
    client.connect()
    return (): void => client.disconnect()
  }, [])
  const sendTripCommand = useCallback((action: string) => {
    tripWsRef.current?.send({ type: 'command', action })
  }, [])

  // Auto-prompt tile download when switching to map view with no tiles
  const promptedRef = useRef(false)
  useEffect(() => {
    if (viewMode !== 'map' || promptedRef.current) return
    promptedRef.current = true
    window.api.checkTilesExist().then((exists) => {
      if (!exists) {
        useSettingsStore.getState().setShowTileDownload(true)
      } else {
        useSettingsStore.getState().setTilesAvailable(true)
      }
    }).catch(() => {})
  }, [viewMode])

  return (
    <div
      className={cn(
        'flex flex-col h-screen w-screen bg-surface text-text-primary select-none overflow-hidden',
        isWarning && viewMode === 'dashboard' && 'ring-2 ring-danger/50'
      )}
    >
      <StatusBar />

      {/* Main content area */}
      {viewMode === 'dashboard' && (
        <div className="flex-1 flex min-h-0">
          {/* Left panel — speed + stats */}
          <div className="flex flex-col gap-3 p-3" style={{ width: 460 }}>
            <SpeedCard />
            <div className="grid grid-cols-2 gap-3 flex-1">
              <HeadingCard />
              <AltitudeCard />
              <TripCard />
              <SpeedStatsCard />
            </div>
            <TripRecordingCard />
          </div>

          {/* Right panel — map */}
          <div className="flex-1 relative min-h-0">
            <LiveMap />
            <MapOverlays compact />
            <TurnBanner />
            <NavStatusBar />
            {/* Trip button overlay — top right */}
            <div className="absolute top-4 right-4 pointer-events-auto">
              <button
                onClick={() => {
                  if (tripStatus === 'idle') sendTripCommand('trip_start')
                  else setConfirmStopTrip(true)
                }}
                className={cn(
                  'h-10 px-5 rounded-full text-sm font-semibold shadow-sm transition-colors',
                  tripStatus !== 'idle'
                    ? 'bg-danger/90 text-white active:bg-danger'
                    : 'bg-accent/90 text-white active:bg-accent'
                )}
              >
                {tripStatus !== 'idle' ? 'Stop Trip' : 'Start Trip'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewMode === 'map' && (
        <div className="flex-1 relative min-h-0">
          <LiveMap />
          <MapOverlays />
          <TurnBanner />
          <NavStatusBar />
          <RoutePreview />
          <SearchOverlay />
          <div className="absolute bottom-4 left-4 right-4">
            <TripRecordingCard />
          </div>
        </div>
      )}

      {viewMode === 'trips' && <TripsView />}

      {/* Speed graph (available in dashboard + map views) */}
      {showGraph && viewMode !== 'trips' && <SpeedGraph />}

      <TabBar />

      {/* Overlays */}
      <SettingsPanel />
      <TripDetailView />
      <TileDownloadOverlay />
      <RoutingDataOverlay />
      <ConfirmDialog
        open={confirmStopTrip}
        title="Stop Trip Recording"
        message="Are you sure you want to stop recording? The trip will be saved."
        confirmLabel="Stop"
        variant="danger"
        onConfirm={() => { setConfirmStopTrip(false); sendTripCommand('trip_stop') }}
        onCancel={() => setConfirmStopTrip(false)}
      />
      <ToastContainer />
    </div>
  )
}
