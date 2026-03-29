import { useState, useEffect, useRef } from 'react'
import { useGpsStore } from '../../stores/gps-store'
import { cn } from '../../lib/utils'

const COLD_START_SECS = 30

export function SatelliteInfo(): React.JSX.Element {
  const satellites = useGpsStore((s) => s.fix?.satellites ?? 0)
  const fixQuality = useGpsStore((s) => s.fix?.fixQuality ?? 0)
  const connected = useGpsStore((s) => s.connected)

  const [countdown, setCountdown] = useState(COLD_START_SECS)
  const hasFix = fixQuality > 0
  const hadFixRef = useRef(false)

  // Track if we've ever had a fix
  useEffect(() => {
    if (hasFix) hadFixRef.current = true
  }, [hasFix])

  // Countdown timer while waiting for fix
  useEffect(() => {
    if (hasFix || !connected) return

    setCountdown(COLD_START_SECS)
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return (): void => clearInterval(interval)
  }, [hasFix, connected])

  let fixLabel: string
  let fixColor: string
  let pipColor: string

  if (!connected) {
    fixLabel = 'NO CONN'
    fixColor = 'text-red-400'
    pipColor = 'bg-red-400 shadow-[0_0_5px_theme(colors.red.400)]'
  } else if (!hasFix) {
    fixLabel = 'ACQUIRING'
    fixColor = 'text-yellow-400'
    pipColor = 'bg-yellow-400 shadow-[0_0_5px_theme(colors.yellow.400)]'
  } else if (satellites < 4) {
    fixLabel = '2D FIX'
    fixColor = 'text-yellow-400'
    pipColor = 'bg-yellow-400 shadow-[0_0_5px_theme(colors.yellow.400)]'
  } else {
    fixLabel = '3D FIX'
    fixColor = 'text-green-400'
    pipColor = 'bg-green-400 shadow-[0_0_5px_theme(colors.green.400)]'
  }

  return (
    <div className="flex items-center gap-2">
      <div className={cn('w-2 h-2 rounded-full animate-pulse', pipColor)} />
      <span className={cn('font-mono text-[13px] font-semibold', fixColor)}>
        {fixLabel}
      </span>
      {hasFix ? (
        <span className="font-mono text-[13px] text-zinc-300">
          {satellites} SAT
        </span>
      ) : connected && !hadFixRef.current ? (
        <span className="font-mono text-[13px] text-zinc-400 tabular-nums">
          ~{countdown}s
        </span>
      ) : null}
    </div>
  )
}
