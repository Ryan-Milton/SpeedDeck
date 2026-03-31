import { useEffect } from 'react'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { useTripPlayback } from '../../hooks/useTripPlayback'
import { TripStatsBar } from './TripStatsBar'
import { TripElevationChart } from './TripElevationChart'
import { TripMap } from './TripMap'
import { PlaybackControls } from './PlaybackControls'
import { PlaybackReadout } from './PlaybackReadout'

export function TripDetailView(): React.JSX.Element {
  const detailOpen = useTripViewerStore((s) => s.detailOpen)
  const trackpointsLoading = useTripViewerStore((s) => s.trackpointsLoading)
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const position = usePlaybackStore((s) => s.position)

  useTripPlayback(trackpoints)

  // Reset playback when detail closes
  useEffect(() => {
    if (!detailOpen) {
      usePlaybackStore.getState().reset()
    }
  }, [detailOpen])

  if (!detailOpen) return <></>

  return (
    <div className="fixed inset-0 bg-surface flex flex-col" style={{ zIndex: 60 }}>
      <TripStatsBar />

      {trackpointsLoading && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-text-secondary text-lg animate-pulse">Loading trip data...</span>
        </div>
      )}

      {!trackpointsLoading && trackpoints.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-text-tertiary text-lg">No trackpoints recorded for this trip.</span>
        </div>
      )}

      {!trackpointsLoading && trackpoints.length > 0 && (
        <>
          <div className="flex-1 min-h-0 relative">
            <TripMap />
            {position && <PlaybackReadout />}
          </div>
          <PlaybackControls />
          <TripElevationChart />
        </>
      )}
    </div>
  )
}
