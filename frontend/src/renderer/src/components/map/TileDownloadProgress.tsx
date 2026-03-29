import { useState, useEffect } from 'react'
import { cn } from '../../lib/utils'

export function TileDownloadProgress({
  onDone,
  onCancel
}: {
  onDone: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [progress, setProgress] = useState({ downloaded: 0, total: 0, percent: 0 })

  useEffect(() => {
    const unsub = window.api.onTileDownloadProgress((p) => {
      setProgress(p)
      if (p.percent >= 100) {
        setTimeout(onDone, 500)
      }
    })
    // Also poll in case events are missed
    const interval = setInterval(async () => {
      const p = await window.api.getTileDownloadProgress()
      setProgress(p)
      if (p.percent >= 100) {
        clearInterval(interval)
        setTimeout(onDone, 500)
      }
    }, 1000)
    return (): void => {
      unsub()
      clearInterval(interval)
    }
  }, [onDone])

  const handleCancel = async (): Promise<void> => {
    await window.api.cancelTileDownload()
    onCancel()
  }

  return (
    <div className="fixed inset-0 bg-zinc-950/95 flex items-center justify-center" style={{ zIndex: 70 }}>
      <div className="flex flex-col items-center gap-6" style={{ width: 400 }}>
        <span className="text-lg font-semibold tracking-[2px] text-zinc-300">DOWNLOADING MAP TILES</span>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl text-zinc-200 tabular-nums">
            {progress.downloaded.toLocaleString()}
          </span>
          <span className="text-zinc-500">/</span>
          <span className="font-mono text-2xl text-zinc-400 tabular-nums">
            {progress.total.toLocaleString()}
          </span>
          <span className="text-zinc-500 text-sm">tiles</span>
          <span className="font-mono text-lg text-cyan-400 tabular-nums ml-2">
            {progress.percent}%
          </span>
        </div>

        <button
          onClick={handleCancel}
          className="px-6 h-12 rounded-lg text-sm font-semibold tracking-[1px] border bg-zinc-800 text-zinc-300 border-zinc-700 hover:text-zinc-100 transition-colors"
        >
          CANCEL
        </button>
      </div>
    </div>
  )
}
