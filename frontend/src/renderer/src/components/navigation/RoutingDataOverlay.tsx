import { useEffect, useRef, useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settings-store'
import { useNavigationStore } from '../../stores/navigation-store'
import { GpsWebSocketClient } from '../../lib/ws-client'
import { Card } from '../shared/Card'
import { X } from 'lucide-react'

const WS_URL = 'ws://127.0.0.1:8765'
const POLL_INTERVAL = 500

interface RegionInfo {
  id: string
  name: string
  estimatedSizeMb: number
  group: string
}

export function RoutingDataOverlay(): React.JSX.Element | null {
  const showRoutingDownload = useSettingsStore((s) => s.showRoutingDownload)
  const setShowRoutingDownload = useSettingsStore((s) => s.setShowRoutingDownload)

  const wsRef = useRef<GpsWebSocketClient | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [regions, setRegions] = useState<Record<string, RegionInfo[]>>({})
  const [phase, setPhase] = useState<'select' | 'downloading' | 'processing'>('select')
  const [downloadProgress, setDownloadProgress] = useState({ percent: 0, downloadedMb: 0, totalMb: 0, step: 'idle' })
  const [processProgress, setProcessProgress] = useState({ step: 'idle', percent: 0, stepNumber: 0, totalSteps: 0 })
  const [selectedRegion, setSelectedRegion] = useState<RegionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refs for values accessed inside the WebSocket callback (avoids stale closures)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const selectedRegionRef = useRef(selectedRegion)
  selectedRegionRef.current = selectedRegion

  // WebSocket client for sending commands + receiving responses
  useEffect(() => {
    if (!showRoutingDownload) return

    const client = new GpsWebSocketClient(WS_URL)
    wsRef.current = client

    client.onMessage = (msg): void => {
      const data = msg as Record<string, unknown>
      if (data.type === 'navRegions') {
        setRegions((data as { regions: typeof regions }).regions)
      } else if (data.type === 'navProgress') {
        const d = data as { download: typeof downloadProgress; process: typeof processProgress; error: string | null }
        setDownloadProgress(d.download)
        setProcessProgress(d.process)
        if (d.error) setError(d.error)

        // Auto-advance phases (use refs to avoid stale closure)
        if (d.download.step === 'complete' && phaseRef.current === 'downloading') {
          stopPolling()
          setPhase('processing')
          const rid = selectedRegionRef.current?.id ?? ''
          client.send({ type: 'command', action: 'nav_process_region', regionId: rid })
          startPolling(client)
        }
        if (d.process.step === 'done' && phaseRef.current === 'processing') {
          stopPolling()
          setPhase('select')
          setShowRoutingDownload(false)
          useNavigationStore.getState().setOsrmReady(true)
        }
      } else if (data.type === 'navStatus') {
        // Router started — region is ready
        const status = data as { routerRunning?: boolean; installedRegion?: unknown }
        if (status.installedRegion) {
          useNavigationStore.getState().setOsrmReady(status.routerRunning === true)
        }
      }
    }

    client.onConnectionChange = (connected): void => {
      if (connected) {
        client.send({ type: 'command', action: 'nav_get_regions' })
      }
    }

    client.connect()
    return (): void => {
      stopPolling()
      client.disconnect()
    }
  }, [showRoutingDownload])

  const startPolling = useCallback((client: GpsWebSocketClient) => {
    stopPolling()
    pollRef.current = setInterval(() => {
      client.send({ type: 'command', action: 'nav_get_progress' })
    }, POLL_INTERVAL)
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const handleDownload = useCallback((region: RegionInfo) => {
    setSelectedRegion(region)
    setPhase('downloading')
    setDownloadProgress({ percent: 0, downloadedMb: 0, totalMb: region.estimatedSizeMb, step: 'download' })
    setError(null)

    const client = wsRef.current
    if (client) {
      client.send({ type: 'command', action: 'nav_download_region', regionId: region.id })
      startPolling(client)
    }
  }, [startPolling])

  if (!showRoutingDownload) return null

  const pct = phase === 'downloading' ? downloadProgress.percent : processProgress.percent

  return (
    <div className="fixed inset-0 bg-surface flex flex-col" style={{ zIndex: 65 }}>
      {/* Header */}
      <div className="flex items-center justify-between h-14 px-6 border-b border-separator">
        <span className="text-lg font-semibold text-text-primary">Navigation Data</span>
        <button
          onClick={() => { stopPolling(); setShowRoutingDownload(false); setPhase('select') }}
          className="w-12 h-12 flex items-center justify-center text-text-secondary active:text-accent transition-colors"
        >
          <X size={24} />
        </button>
      </div>

      {error && (
        <div className="px-6 py-3 bg-danger/10 text-danger text-sm">{error}</div>
      )}

      {phase === 'select' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {Object.entries(regions).map(([group, regionList]) => (
            <div key={group}>
              <h3 className="text-[13px] font-semibold tracking-wide uppercase text-text-secondary mb-2">{group}</h3>
              <div className="space-y-1">
                {regionList.map((r) => (
                  <Card key={r.id} padding="sm" onClick={() => handleDownload(r)} className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-text-primary">{r.name}</span>
                    <span className="text-xs text-text-secondary">~{r.estimatedSizeMb} MB</span>
                  </Card>
                ))}
              </div>
            </div>
          ))}
          {Object.keys(regions).length === 0 && (
            <p className="text-text-secondary text-sm text-center py-8">Loading regions...</p>
          )}
        </div>
      )}

      {phase === 'downloading' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6" style={{ width: 400 }}>
            <span className="text-lg font-semibold text-text-primary">
              {downloadProgress.step === 'download_addresses'
                ? `Downloading address data for ${selectedRegion?.name}`
                : `Downloading ${selectedRegion?.name}`}
            </span>
            <div className="w-full h-3 rounded-full bg-surface-active overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${downloadProgress.percent}%` }} />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-text-primary tabular-nums">{downloadProgress.downloadedMb}</span>
              <span className="text-text-tertiary">/</span>
              <span className="text-2xl font-semibold text-text-secondary tabular-nums">{downloadProgress.totalMb}</span>
              <span className="text-text-tertiary text-sm">MB</span>
              <span className="text-lg font-semibold text-accent tabular-nums ml-2">{downloadProgress.percent}%</span>
            </div>
          </div>
        </div>
      )}

      {phase === 'processing' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-6" style={{ width: 440 }}>
            <span className="text-lg font-semibold text-text-primary">
              Processing {selectedRegion?.name}
            </span>
            <div className="w-full h-3 rounded-full bg-surface-active overflow-hidden">
              <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${processProgress.percent}%` }} />
            </div>
            <div className="text-center">
              <div className="text-sm font-semibold text-text-primary">
                Step {processProgress.stepNumber}/{processProgress.totalSteps}: {
                  (processProgress as Record<string, unknown>).label as string ||
                  processProgress.step
                }
              </div>
              {(processProgress as Record<string, unknown>).estimate && (
                <div className="text-xs text-text-tertiary mt-1">
                  Estimated time: {(processProgress as Record<string, unknown>).estimate as string}
                </div>
              )}
            </div>
            <div className="text-xs text-text-tertiary animate-pulse">
              Please wait, this may take a few minutes...
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
