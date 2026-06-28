import { useState, useEffect, useRef } from 'react'

export function TileDownloadProgress({
  onDone,
  onCancel
}: {
  onDone: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [progress, setProgress] = useState({ downloaded: 0, total: 0, percent: 0 })
  const doneRef = useRef(false)

  const fireDone = (): void => {
    if (doneRef.current) return
    doneRef.current = true
    setTimeout(onDone, 500)
  }

  useEffect(() => {
    const unsub = window.api.onTileDownloadProgress((p) => {
      setProgress(p)
      if (p.percent >= 100) fireDone()
    })
    // Poll as backup in case IPC events are missed
    const interval = setInterval(async () => {
      const p = await window.api.getTileDownloadProgress()
      setProgress(p)
      if (p.percent >= 100) {
        clearInterval(interval)
        fireDone()
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
    <div className="fixed inset-0 bg-surface/95 flex items-center justify-center" style={{ zIndex: 70 }}>
      <div className="flex flex-col items-center gap-6" style={{ width: 400 }}>
        <span className="text-lg font-semibold text-text-primary">Downloading Map Tiles</span>

        {/* Progress bar */}
        <div className="w-full h-3 rounded-full bg-surface-active overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress.percent}%` }}
          />
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-text-primary tabular-nums">
            {progress.downloaded.toLocaleString()}
          </span>
          <span className="text-text-tertiary">/</span>
          <span className="text-2xl font-semibold text-text-secondary tabular-nums">
            {progress.total.toLocaleString()}
          </span>
          <span className="text-text-tertiary text-sm">tiles</span>
          <span className="text-lg font-semibold text-accent tabular-nums ml-2">
            {progress.percent}%
          </span>
        </div>

        <button
          onClick={handleCancel}
          className="px-6 h-12 rounded-2xl text-sm font-semibold bg-surface-card text-text-primary active:bg-surface-active transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
