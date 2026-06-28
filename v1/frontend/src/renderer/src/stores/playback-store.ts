import { create } from 'zustand'

type SpeedMultiplier = 1 | 2 | 4 | 8

interface PlaybackState {
  playing: boolean
  seeking: boolean
  speedMultiplier: SpeedMultiplier
  elapsedMs: number
  totalDurationMs: number

  // Derived snapshot (written by animation loop)
  position: { lat: number; lng: number } | null
  heading: number
  speed: number
  altitude: number | null
  cumulativeDistance: number

  // Actions
  play: () => void
  pause: () => void
  stop: () => void
  setSpeedMultiplier: (m: SpeedMultiplier) => void
  cycleSpeedMultiplier: () => void
  seekToFraction: (f: number) => void
  setSeeking: (s: boolean) => void
  setTotalDuration: (ms: number) => void
  tick: (
    elapsedMs: number,
    pos: { lat: number; lng: number },
    heading: number,
    speed: number,
    altitude: number | null,
    cumDist: number
  ) => void
  reset: () => void
}

const SPEED_CYCLE: SpeedMultiplier[] = [1, 2, 4, 8]

export const usePlaybackStore = create<PlaybackState>()((set, get) => ({
  playing: false,
  seeking: false,
  speedMultiplier: 1,
  elapsedMs: 0,
  totalDurationMs: 0,

  position: null,
  heading: 0,
  speed: 0,
  altitude: null,
  cumulativeDistance: 0,

  play: (): void => set({ playing: true }),
  pause: (): void => set({ playing: false }),

  stop: (): void =>
    set({
      playing: false,
      elapsedMs: 0,
      position: null,
      heading: 0,
      speed: 0,
      altitude: null,
      cumulativeDistance: 0
    }),

  setSpeedMultiplier: (m): void => set({ speedMultiplier: m }),

  cycleSpeedMultiplier: (): void => {
    const cur = get().speedMultiplier
    const idx = SPEED_CYCLE.indexOf(cur)
    set({ speedMultiplier: SPEED_CYCLE[(idx + 1) % SPEED_CYCLE.length] })
  },

  seekToFraction: (f): void => {
    const total = get().totalDurationMs
    set({ elapsedMs: Math.max(0, Math.min(f * total, total)) })
  },

  setSeeking: (s): void => set({ seeking: s }),
  setTotalDuration: (ms): void => set({ totalDurationMs: ms }),

  tick: (elapsedMs, pos, heading, speed, altitude, cumDist): void =>
    set({
      elapsedMs,
      position: pos,
      heading,
      speed,
      altitude,
      cumulativeDistance: cumDist
    }),

  reset: (): void =>
    set({
      playing: false,
      seeking: false,
      speedMultiplier: 1,
      elapsedMs: 0,
      totalDurationMs: 0,
      position: null,
      heading: 0,
      speed: 0,
      altitude: null,
      cumulativeDistance: 0
    })
}))
