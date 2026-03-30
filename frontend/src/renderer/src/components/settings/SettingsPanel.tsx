import { useSettingsStore } from '../../stores/settings-store'
import { cn, speedUnitLabel, altitudeUnitLabel } from '../../lib/utils'
import { X } from 'lucide-react'
import type { SpeedUnit, AltitudeUnit } from '../../types/gps'
import { TripListSection } from './TripListSection'
import { useEffect, useState } from 'react'

const SPEED_UNITS: SpeedUnit[] = ['mph', 'kmh', 'knots']
const ALT_UNITS: AltitudeUnit[] = ['ft', 'm']

export function SettingsPanel(): React.JSX.Element {
  const open = useSettingsStore((s) => s.settingsOpen)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const setSpeedUnit = useSettingsStore((s) => s.setSpeedUnit)
  const altitudeUnit = useSettingsStore((s) => s.altitudeUnit)
  const setAltitudeUnit = useSettingsStore((s) => s.setAltitudeUnit)
  const warningEnabled = useSettingsStore((s) => s.speedWarningEnabled)
  const warningThreshold = useSettingsStore((s) => s.speedWarningThreshold)
  const setSpeedWarning = useSettingsStore((s) => s.setSpeedWarning)

  if (!open) return <></>

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/95 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-zinc-800">
        <span className="text-lg font-semibold tracking-[2px] text-zinc-300">SETTINGS</span>
        <button
          onClick={toggleSettings}
          className="w-12 h-12 flex items-center justify-center text-zinc-400 hover:text-zinc-200"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
        {/* Speed unit */}
        <Section label="SPEED UNIT">
          <div className="flex gap-2">
            {SPEED_UNITS.map((u) => (
              <ToggleButton
                key={u}
                active={speedUnit === u}
                onClick={() => setSpeedUnit(u)}
              >
                {speedUnitLabel(u)}
              </ToggleButton>
            ))}
          </div>
        </Section>

        {/* Altitude unit */}
        <Section label="ALTITUDE UNIT">
          <div className="flex gap-2">
            {ALT_UNITS.map((u) => (
              <ToggleButton
                key={u}
                active={altitudeUnit === u}
                onClick={() => setAltitudeUnit(u)}
              >
                {altitudeUnitLabel(u)}
              </ToggleButton>
            ))}
          </div>
        </Section>

        {/* Speed warning */}
        <Section label="SPEED WARNING">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSpeedWarning(!warningEnabled)}
              className={cn(
                'w-14 h-8 rounded-full relative transition-colors',
                warningEnabled ? 'bg-cyan-600' : 'bg-zinc-700'
              )}
            >
              <div
                className={cn(
                  'w-6 h-6 rounded-full bg-white absolute top-1 transition-transform',
                  warningEnabled ? 'translate-x-7' : 'translate-x-1'
                )}
              />
            </button>
            {warningEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={200}
                  value={warningThreshold}
                  onChange={(e) => setSpeedWarning(true, Number(e.target.value))}
                  className="w-48 accent-cyan-400"
                />
                <span className="font-mono text-lg text-zinc-300 tabular-nums w-16 text-right">
                  {warningThreshold}
                </span>
                <span className="text-sm text-zinc-300">
                  {speedUnitLabel(speedUnit)}
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* Trips */}
        <TripListSection />

        {/* Map tiles */}
        <MapTilesSection />

        {/* Info */}
        <Section label="ABOUT">
          <div className="text-sm text-zinc-300 space-y-1">
            <p>SpeedDeck v0.1.0</p>
            <p>Navisys GR-M02U GNSS Receiver</p>
            <p className="text-zinc-400">Built for Steam Deck</p>
          </div>
        </Section>
      </div>
    </div>
  )
}

function MapTilesSection(): React.JSX.Element {
  const setShowTileDownload = useSettingsStore((s) => s.setShowTileDownload)
  const [tilesExist, setTilesExist] = useState(false)
  const [cacheSize, setCacheSize] = useState(0)

  useEffect(() => {
    window.api.checkTilesExist().then(setTilesExist).catch(() => {})
    window.api.getCacheSize().then(setCacheSize).catch(() => {})
  }, [])

  const handleDelete = async (): Promise<void> => {
    await window.api.deleteCachedTiles()
    setTilesExist(false)
    setCacheSize(0)
    useSettingsStore.getState().setTilesAvailable(false)
  }

  const cacheMB = (cacheSize / 1024 / 1024).toFixed(1)

  return (
    <div className="space-y-3">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">MAP TILES</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-zinc-300">
          {tilesExist ? `Downloaded (${cacheMB} MB)` : 'Not downloaded'}
        </span>
        <button
          onClick={() => setShowTileDownload(true)}
          className="px-4 h-10 rounded-lg text-sm font-semibold tracking-[1px] border bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-cyan-400 hover:border-cyan-400/30 transition-colors"
        >
          {tilesExist ? 'UPDATE TILES' : 'DOWNLOAD TILES'}
        </button>
        {tilesExist && (
          <button
            onClick={handleDelete}
            className="px-4 h-10 rounded-lg text-sm font-semibold tracking-[1px] border bg-zinc-800 text-red-400 border-zinc-700 hover:border-red-800 transition-colors"
          >
            DELETE
          </button>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <span className="text-xs font-semibold tracking-[2px] uppercase text-zinc-400">{label}</span>
      {children}
    </div>
  )
}

function ToggleButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-6 h-12 rounded-lg text-sm font-semibold tracking-[1px] border transition-colors',
        active
          ? 'bg-cyan-900/50 text-cyan-400 border-cyan-400/30'
          : 'bg-zinc-800 text-zinc-300 border-zinc-700'
      )}
    >
      {children}
    </button>
  )
}
