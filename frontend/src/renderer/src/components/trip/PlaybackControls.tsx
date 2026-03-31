import { useCallback } from 'react'
import { usePlaybackStore } from '../../stores/playback-store'
import { formatDuration } from '../../lib/utils'
import { Play, Pause, Square } from 'lucide-react'

export function PlaybackControls(): React.JSX.Element {
  const playing = usePlaybackStore((s) => s.playing)
  const elapsedMs = usePlaybackStore((s) => s.elapsedMs)
  const totalDurationMs = usePlaybackStore((s) => s.totalDurationMs)
  const speedMultiplier = usePlaybackStore((s) => s.speedMultiplier)
  const position = usePlaybackStore((s) => s.position)

  const play = usePlaybackStore((s) => s.play)
  const pause = usePlaybackStore((s) => s.pause)
  const stop = usePlaybackStore((s) => s.stop)
  const cycleSpeed = usePlaybackStore((s) => s.cycleSpeedMultiplier)
  const seekToFraction = usePlaybackStore((s) => s.seekToFraction)
  const setSeeking = usePlaybackStore((s) => s.setSeeking)

  const fraction = totalDurationMs > 0 ? elapsedMs / totalDurationMs : 0
  const elapsedSec = Math.floor(elapsedMs / 1000)
  const totalSec = Math.floor(totalDurationMs / 1000)
  const isActive = playing || position !== null

  const handleScrubStart = useCallback(() => setSeeking(true), [setSeeking])
  const handleScrubEnd = useCallback(() => setSeeking(false), [setSeeking])
  const handleScrub = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => seekToFraction(parseFloat(e.target.value)),
    [seekToFraction]
  )

  return (
    <div className="px-4 py-3 bg-surface-card/90 backdrop-blur-xl border-t border-separator">
      {/* Scrubber row */}
      <div className="flex items-center gap-3">
        <span className="text-[11px] text-text-secondary tabular-nums w-14 text-right">
          {formatDuration(elapsedSec)}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={fraction}
          onChange={handleScrub}
          onPointerDown={handleScrubStart}
          onPointerUp={handleScrubEnd}
          className="playback-scrubber flex-1"
          style={{
            background: `linear-gradient(to right, #0A84FF 0%, #0A84FF ${fraction * 100}%, #3A3A3C ${fraction * 100}%, #3A3A3C 100%)`
          }}
        />
        <span className="text-[11px] text-text-secondary tabular-nums w-14">
          {formatDuration(totalSec)}
        </span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-center gap-4 mt-2">
        {isActive && (
          <button
            onClick={stop}
            className="w-10 h-10 rounded-full bg-surface-active flex items-center justify-center text-text-secondary active:text-text-primary transition-colors"
          >
            <Square size={16} fill="currentColor" />
          </button>
        )}
        <button
          onClick={playing ? pause : play}
          className="w-12 h-12 rounded-full bg-accent flex items-center justify-center text-white active:bg-accent/80 transition-colors"
        >
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          onClick={cycleSpeed}
          className="h-8 px-3 rounded-full bg-surface-active text-[13px] font-semibold text-text-primary tabular-nums active:bg-separator transition-colors"
        >
          {speedMultiplier}x
        </button>
      </div>
    </div>
  )
}
