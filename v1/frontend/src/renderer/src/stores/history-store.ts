import { create } from 'zustand'

interface SpeedPoint {
  t: number // timestamp ms
  speed: number // m/s
}

interface HistoryState {
  points: SpeedPoint[]
  maxPoints: number

  push: (t: number, speed: number) => void
  clear: () => void
}

export const useHistoryStore = create<HistoryState>()((set) => ({
  points: [],
  maxPoints: 600, // 10 minutes at 1Hz

  push: (t, speed): void =>
    set((state) => {
      const next = [...state.points, { t, speed }]
      if (next.length > state.maxPoints) {
        next.shift()
      }
      return { points: next }
    }),

  clear: (): void => set({ points: [] })
}))
