import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SpeedUnit, AltitudeUnit } from '../types/gps'

type ViewMode = 'hud' | 'map'

interface SettingsState {
  speedUnit: SpeedUnit
  altitudeUnit: AltitudeUnit
  speedWarningEnabled: boolean
  speedWarningThreshold: number // stored in current unit
  showGraph: boolean
  settingsOpen: boolean
  viewMode: ViewMode
  tilesAvailable: boolean
  showTileDownload: boolean

  setSpeedUnit: (unit: SpeedUnit) => void
  cycleSpeedUnit: () => void
  setAltitudeUnit: (unit: AltitudeUnit) => void
  setSpeedWarning: (enabled: boolean, threshold?: number) => void
  setShowGraph: (show: boolean) => void
  toggleSettings: () => void
  setViewMode: (mode: ViewMode) => void
  toggleViewMode: () => void
  setTilesAvailable: (available: boolean) => void
  setShowTileDownload: (show: boolean) => void
}

const UNIT_CYCLE: SpeedUnit[] = ['mph', 'kmh', 'knots']

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      speedUnit: 'mph',
      altitudeUnit: 'ft',
      speedWarningEnabled: false,
      speedWarningThreshold: 80,
      showGraph: false,
      settingsOpen: false,
      viewMode: 'hud',
      tilesAvailable: false,
      showTileDownload: false,

      setSpeedUnit: (unit): void => set({ speedUnit: unit }),

      cycleSpeedUnit: (): void => {
        const current = get().speedUnit
        const idx = UNIT_CYCLE.indexOf(current)
        set({ speedUnit: UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length] })
      },

      setAltitudeUnit: (unit): void => set({ altitudeUnit: unit }),

      setSpeedWarning: (enabled, threshold): void =>
        set({
          speedWarningEnabled: enabled,
          ...(threshold !== undefined ? { speedWarningThreshold: threshold } : {})
        }),

      setShowGraph: (show): void => set({ showGraph: show }),

      toggleSettings: (): void => set((s) => ({ settingsOpen: !s.settingsOpen })),

      setViewMode: (mode): void => set({ viewMode: mode }),

      toggleViewMode: (): void =>
        set((s) => ({ viewMode: s.viewMode === 'hud' ? 'map' : 'hud' })),

      setTilesAvailable: (available): void => set({ tilesAvailable: available }),

      setShowTileDownload: (show): void => set({ showTileDownload: show })
    }),
    { name: 'gps-speedometer-settings' }
  )
)
