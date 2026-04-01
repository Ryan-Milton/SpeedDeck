import { useSettingsStore } from '../../stores/settings-store'
import { useNavigationStore } from '../../stores/navigation-store'
import { cn, speedUnitLabel, altitudeUnitLabel } from '../../lib/utils'
import { X } from 'lucide-react'
import { GpsWebSocketClient } from '../../lib/ws-client'
import type { SpeedUnit, AltitudeUnit } from '../../types/gps'
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
  const showGraph = useSettingsStore((s) => s.showGraph)
  const setShowGraph = useSettingsStore((s) => s.setShowGraph)

  if (!open) return <></>

  return (
    <div className="fixed inset-0 z-50 bg-surface/95 backdrop-blur-xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-separator">
        <span className="text-lg font-semibold text-text-primary">Settings</span>
        <button
          onClick={toggleSettings}
          className="w-12 h-12 flex items-center justify-center text-text-secondary active:text-accent transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
        {/* Speed unit */}
        <Section label="Speed Unit">
          <div className="flex gap-2">
            {SPEED_UNITS.map((u) => (
              <ToggleButton key={u} active={speedUnit === u} onClick={() => setSpeedUnit(u)}>
                {speedUnitLabel(u)}
              </ToggleButton>
            ))}
          </div>
        </Section>

        {/* Altitude unit */}
        <Section label="Altitude Unit">
          <div className="flex gap-2">
            {ALT_UNITS.map((u) => (
              <ToggleButton key={u} active={altitudeUnit === u} onClick={() => setAltitudeUnit(u)}>
                {altitudeUnitLabel(u)}
              </ToggleButton>
            ))}
          </div>
        </Section>

        {/* Speed graph */}
        <Section label="Speed Graph">
          <div className="flex items-center gap-4">
            <Toggle checked={showGraph} onChange={setShowGraph} />
            <span className="text-sm text-text-secondary">Show speed history graph</span>
          </div>
        </Section>

        {/* Speed warning */}
        <Section label="Speed Warning">
          <div className="flex items-center gap-4">
            <Toggle checked={warningEnabled} onChange={(v) => setSpeedWarning(v)} />
            {warningEnabled && (
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={10}
                  max={200}
                  value={warningThreshold}
                  onChange={(e) => setSpeedWarning(true, Number(e.target.value))}
                  className="w-48 accent-[#0A84FF]"
                />
                <span className="text-lg font-semibold text-text-primary tabular-nums w-16 text-right">
                  {warningThreshold}
                </span>
                <span className="text-sm text-text-secondary">
                  {speedUnitLabel(speedUnit)}
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* Map tiles */}
        <MapTilesSection />

        {/* Navigation data */}
        <NavDataSection />

        {/* Info */}
        <Section label="About">
          <div className="text-sm text-text-secondary space-y-1">
            <p>SpeedDeck v0.1.0</p>
            <p>Navisys GR-M02U GNSS Receiver</p>
            <p className="text-text-tertiary">Built for Steam Deck</p>
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
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">Map Tiles</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-text-secondary">
          {tilesExist ? `Downloaded (${cacheMB} MB)` : 'Not downloaded'}
        </span>
        <button
          onClick={() => setShowTileDownload(true)}
          className="px-4 h-12 rounded-2xl text-sm font-semibold bg-surface-card text-text-primary active:bg-surface-active transition-colors"
        >
          {tilesExist ? 'Update Tiles' : 'Download Tiles'}
        </button>
        {tilesExist && (
          <button
            onClick={handleDelete}
            className="px-4 h-12 rounded-2xl text-sm font-semibold bg-surface-card text-danger active:bg-surface-active transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function NavDataSection(): React.JSX.Element {
  const setShowRoutingDownload = useSettingsStore((s) => s.setShowRoutingDownload)
  const osrmReady = useNavigationStore((s) => s.osrmReady)
  const [navStatus, setNavStatus] = useState<{ installedRegion: { regionName: string } | null; installedSizeMb: number; routerRunning: boolean } | null>(null)

  // Query backend for actual OSRM status on mount
  useEffect(() => {
    const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
    client.onMessage = (msg): void => {
      const data = msg as Record<string, unknown>
      if (data.type === 'navStatus') {
        const status = data as typeof navStatus
        setNavStatus(status)
        if (status?.routerRunning) {
          useNavigationStore.getState().setOsrmReady(true)
        }
      }
    }
    client.onConnectionChange = (connected): void => {
      if (connected) client.send({ type: 'command', action: 'nav_get_status' })
    }
    client.connect()
    return (): void => client.disconnect()
  }, [])

  const hasData = navStatus?.installedRegion != null || osrmReady
  const regionName = navStatus?.installedRegion?.regionName ?? ''
  const sizeMb = navStatus?.installedSizeMb ?? 0

  return (
    <div className="space-y-3">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">Navigation Data</span>
      <div className="flex items-center gap-4">
        <span className="text-sm text-text-secondary">
          {hasData ? `${regionName} (${sizeMb} MB)` : 'No routing data'}
        </span>
        <button
          onClick={() => setShowRoutingDownload(true)}
          className="px-4 h-12 rounded-2xl text-sm font-semibold bg-surface-card text-text-primary active:bg-surface-active transition-colors"
        >
          {hasData ? 'Update' : 'Download'}
        </button>
        {hasData && (
          <button
            onClick={() => {
              const client = new GpsWebSocketClient('ws://127.0.0.1:8765')
              client.onMessage = (msg): void => {
                const data = msg as Record<string, unknown>
                if (data.type === 'navStatus') {
                  setNavStatus(data as typeof navStatus)
                  useNavigationStore.getState().setOsrmReady(false)
                  client.disconnect()
                }
              }
              client.onConnectionChange = (connected): void => {
                if (connected) client.send({ type: 'command', action: 'nav_delete_region' })
              }
              client.connect()
            }}
            className="px-4 h-12 rounded-2xl text-sm font-semibold bg-surface-card text-danger active:bg-surface-active transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="space-y-3">
      <span className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary">{label}</span>
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
        'px-6 h-14 rounded-2xl text-sm font-semibold transition-colors',
        active
          ? 'bg-accent/15 text-accent'
          : 'bg-surface-card text-text-secondary active:bg-surface-active'
      )}
    >
      {children}
    </button>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'w-14 h-8 rounded-full relative transition-colors',
        checked ? 'bg-success' : 'bg-surface-active'
      )}
    >
      <div
        className={cn(
          'w-6 h-6 rounded-full bg-white absolute top-1 transition-transform',
          checked ? 'translate-x-7' : 'translate-x-1'
        )}
      />
    </button>
  )
}
