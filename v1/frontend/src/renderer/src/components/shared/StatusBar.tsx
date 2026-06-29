import { useState, useEffect, useRef } from 'react'
import { useGpsStore } from '../../stores/gps-store'
import { useSettingsStore } from '../../stores/settings-store'
import { cn } from '../../lib/utils'
import { Settings } from 'lucide-react'

const COLD_START_SECS = 30

export function StatusBar(): React.JSX.Element {
  const connected = useGpsStore((s) => s.connected)
  const fixQuality = useGpsStore((s) => s.fix?.fixQuality ?? 0)
  const satellites = useGpsStore((s) => s.fix?.satellites ?? 0)
  const toggleSettings = useSettingsStore((s) => s.toggleSettings)

  const [time, setTime] = useState(() => formatTime())
  const [countdown, setCountdown] = useState(COLD_START_SECS)
  const hasFix = fixQuality > 0
  const hadFixRef = useRef(false)

  useEffect(() => {
    const interval = setInterval(() => setTime(formatTime()), 10_000)
    return (): void => clearInterval(interval)
  }, [])

  // Track if we've ever had a fix
  useEffect(() => {
    if (hasFix) hadFixRef.current = true
  }, [hasFix])

  // Countdown timer while acquiring
  useEffect(() => {
    if (hasFix || !connected) return
    setCountdown(COLD_START_SECS)
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)
    return (): void => clearInterval(interval)
  }, [hasFix, connected])

  let statusText: string
  let dotColor: string

  if (!connected) {
    statusText = 'No GPS'
    dotColor = 'bg-danger'
  } else if (!hasFix) {
    statusText = 'Acquiring'
    dotColor = 'bg-warning'
  } else if (satellites < 4) {
    statusText = '2D Fix'
    dotColor = 'bg-warning'
  } else {
    statusText = '3D Fix'
    dotColor = 'bg-success'
  }

  return (
    <div className="flex items-center justify-between h-12 px-4 border-b border-separator bg-surface">
      {/* Left: GPS status */}
      <div className="flex items-center gap-2 min-w-[140px]">
        <div className={cn('w-2 h-2 rounded-full animate-pulse', dotColor)} />
        <span className="text-[13px] font-semibold text-text-secondary">
          {statusText}
        </span>
        {hasFix ? (
          <span className="text-[13px] text-text-secondary tabular-nums">
            {satellites} SAT
          </span>
        ) : connected && !hadFixRef.current && countdown > 0 ? (
          <span className="text-[13px] text-text-secondary tabular-nums">
            ~{countdown}s
          </span>
        ) : null}
      </div>

      {/* Center: Clock */}
      <span className="text-[15px] font-semibold text-text-primary tabular-nums">
        {time}
      </span>

      {/* Right: Settings gear */}
      <div className="min-w-[140px] flex justify-end">
        <button
          onClick={toggleSettings}
          className="w-12 h-12 flex items-center justify-center text-text-secondary active:text-accent transition-colors"
        >
          <Settings size={22} />
        </button>
      </div>
    </div>
  )
}

function formatTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
