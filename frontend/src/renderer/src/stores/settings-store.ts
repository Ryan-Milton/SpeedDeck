import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SpeedUnit, AltitudeUnit, CoordFormat } from '../types/gps'

type ViewMode = 'dashboard' | 'map' | 'trips'

interface SettingsState {
  speedUnit: SpeedUnit
  altitudeUnit: AltitudeUnit
  coordFormat: CoordFormat
  speedWarningEnabled: boolean
  speedWarningThreshold: number // stored in current unit
  showGraph: boolean
  settingsOpen: boolean
  viewMode: ViewMode
  tilesAvailable: boolean
  showTileDownload: boolean
  showRoutingDownload: boolean

  setSpeedUnit: (unit: SpeedUnit) => void
  cycleSpeedUnit: () => void
  setAltitudeUnit: (unit: AltitudeUnit) => void
  setCoordFormat: (format: CoordFormat) => void
  setSpeedWarning: (enabled: boolean, threshold?: number) => void
  setShowGraph: (show: boolean) => void
  toggleSettings: () => void
  setViewMode: (mode: ViewMode) => void
  setTilesAvailable: (available: boolean) => void
  setShowTileDownload: (show: boolean) => void
  setShowRoutingDownload: (show: boolean) => void
}

const UNIT_CYCLE: SpeedUnit[] = ['mph', 'kmh', 'knots']

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      speedUnit: 'mph',
      altitudeUnit: 'ft',
      coordFormat: 'dd',
      speedWarningEnabled: false,
      speedWarningThreshold: 80,
      showGraph: false,
      settingsOpen: false,
      viewMode: 'dashboard',
      tilesAvailable: false,
      showTileDownload: false,
      showRoutingDownload: false,

      setSpeedUnit: (unit): void => set({ speedUnit: unit }),

      cycleSpeedUnit: (): void => {
        const current = get().speedUnit
        const idx = UNIT_CYCLE.indexOf(current)
        set({ speedUnit: UNIT_CYCLE[(idx + 1) % UNIT_CYCLE.length] })
      },

      setAltitudeUnit: (unit): void => set({ altitudeUnit: unit }),

      setCoordFormat: (format): void => set({ coordFormat: format }),

      setSpeedWarning: (enabled, threshold): void =>
        set({
          speedWarningEnabled: enabled,
          ...(threshold !== undefined ? { speedWarningThreshold: threshold } : {})
        }),

      setShowGraph: (show): void => set({ showGraph: show }),

      toggleSettings: (): void => set((s) => ({ settingsOpen: !s.settingsOpen })),

      setViewMode: (mode): void => set({ viewMode: mode }),

      setTilesAvailable: (available): void => set({ tilesAvailable: available }),

      setShowTileDownload: (show): void => set({ showTileDownload: show }),

      setShowRoutingDownload: (show): void => set({ showRoutingDownload: show })
    }),
    {
      name: 'gps-speedometer-settings',
      partialize: (state) => {
        const { showTileDownload, showRoutingDownload, settingsOpen, ...persisted } = state
        return persisted
      },
      // Migrate old 'hud'/'map' viewMode to new values
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<SettingsState>) }
        if (merged.viewMode !== 'dashboard' && merged.viewMode !== 'map' && merged.viewMode !== 'trips') {
          merged.viewMode = 'dashboard'
        }
        return merged
      }
    }
  )
)
