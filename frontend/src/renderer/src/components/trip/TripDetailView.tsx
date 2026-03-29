import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { TripStatsBar } from './TripStatsBar'
import { TripElevationChart } from './TripElevationChart'
import { TripMap } from './TripMap'

export function TripDetailView(): React.JSX.Element {
  const detailOpen = useTripViewerStore((s) => s.detailOpen)
  const trackpointsLoading = useTripViewerStore((s) => s.trackpointsLoading)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)

  if (!detailOpen) return <></>

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col" style={{ zIndex: 60 }}>
      <TripStatsBar />

      {trackpointsLoading && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-zinc-400 text-lg animate-pulse">Loading trip data...</span>
        </div>
      )}

      {!trackpointsLoading && trackpoints.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-zinc-500 text-lg">No trackpoints recorded for this trip.</span>
        </div>
      )}

      {!trackpointsLoading && trackpoints.length > 0 && (
        <>
          <div className="flex-1 min-h-0">
            <TripMap />
          </div>
          <TripElevationChart />
        </>
      )}
    </div>
  )
}
