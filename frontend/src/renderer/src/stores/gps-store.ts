import { create } from 'zustand'
import type { GpsFixData } from '../types/gps'

interface GpsState {
  connected: boolean
  fix: GpsFixData | null
  smoothedSpeed: number
  maxSpeed: number
  avgSpeed: number
  tripStatus: 'idle' | 'recording' | 'paused'
  tripDistance: number
  tripDuration: number
  tripMaxSpeed: number
  tripAvgSpeed: number
  lastUpdate: number

  setConnected: (connected: boolean) => void
  updateFromServer: (data: {
    fix: GpsFixData
    smoothedSpeed: number
    maxSpeed: number
    avgSpeed: number
    tripStatus: 'idle' | 'recording' | 'paused'
    tripDistance: number
    tripDuration: number
    tripMaxSpeed: number
    tripAvgSpeed: number
  }) => void
}

export const useGpsStore = create<GpsState>()((set) => ({
  connected: false,
  fix: null,
  smoothedSpeed: 0,
  maxSpeed: 0,
  avgSpeed: 0,
  tripStatus: 'idle',
  tripDistance: 0,
  tripDuration: 0,
  tripMaxSpeed: 0,
  tripAvgSpeed: 0,
  lastUpdate: 0,

  setConnected: (connected): void => set({ connected }),

  updateFromServer: (data): void =>
    set({
      fix: data.fix,
      smoothedSpeed: data.smoothedSpeed,
      maxSpeed: data.maxSpeed,
      avgSpeed: data.avgSpeed,
      tripStatus: data.tripStatus,
      tripDistance: data.tripDistance,
      tripDuration: data.tripDuration,
      tripMaxSpeed: data.tripMaxSpeed,
      tripAvgSpeed: data.tripAvgSpeed,
      lastUpdate: Date.now()
    })
}))
