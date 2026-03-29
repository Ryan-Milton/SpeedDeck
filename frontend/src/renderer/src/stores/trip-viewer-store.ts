import { create } from 'zustand'
import type { TripInfo, Trackpoint } from '../types/gps'

interface TripViewerState {
  trips: TripInfo[]
  tripsLoading: boolean
  selectedTripId: number | null
  trackpoints: Trackpoint[]
  trackpointsLoading: boolean
  detailOpen: boolean

  setTrips: (trips: TripInfo[]) => void
  setTripsLoading: (loading: boolean) => void
  selectTrip: (tripId: number) => void
  setTrackpoints: (trackpoints: Trackpoint[]) => void
  setTrackpointsLoading: (loading: boolean) => void
  closeDetail: () => void
  clear: () => void
}

export const useTripViewerStore = create<TripViewerState>()((set) => ({
  trips: [],
  tripsLoading: false,
  selectedTripId: null,
  trackpoints: [],
  trackpointsLoading: false,
  detailOpen: false,

  setTrips: (trips): void => set({ trips, tripsLoading: false }),
  setTripsLoading: (loading): void => set({ tripsLoading: loading }),

  selectTrip: (tripId): void =>
    set({
      selectedTripId: tripId,
      detailOpen: true,
      trackpoints: [],
      trackpointsLoading: true
    }),

  setTrackpoints: (trackpoints): void =>
    set({ trackpoints, trackpointsLoading: false }),

  setTrackpointsLoading: (loading): void => set({ trackpointsLoading: loading }),

  closeDetail: (): void =>
    set({
      detailOpen: false,
      selectedTripId: null,
      trackpoints: [],
      trackpointsLoading: false
    }),

  clear: (): void =>
    set({
      trips: [],
      tripsLoading: false,
      selectedTripId: null,
      trackpoints: [],
      trackpointsLoading: false,
      detailOpen: false
    })
}))
