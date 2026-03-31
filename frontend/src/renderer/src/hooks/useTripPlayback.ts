import { useEffect, useMemo, useRef } from 'react'
import { usePlaybackStore } from '../stores/playback-store'
import { distance3d, lerpAngle } from '../lib/utils'
import type { Trackpoint } from '../types/gps'

interface TimelineEntry {
  timeOffsetMs: number
  cumulativeDistanceM: number
  lat: number
  lng: number
  altitude: number | null
  speed: number
  heading: number
}

function buildTimeline(trackpoints: Trackpoint[]): TimelineEntry[] {
  if (trackpoints.length === 0) return []

  const t0 = new Date(trackpoints[0].timestamp).getTime()
  let cumDist = 0

  return trackpoints.map((p, i, arr) => {
    if (i > 0) {
      cumDist += distance3d(
        arr[i - 1].latitude, arr[i - 1].longitude, arr[i - 1].altitude,
        p.latitude, p.longitude, p.altitude
      )
    }
    return {
      timeOffsetMs: new Date(p.timestamp).getTime() - t0,
      cumulativeDistanceM: cumDist,
      lat: p.latitude,
      lng: p.longitude,
      altitude: p.altitude,
      speed: p.speed,
      heading: p.heading
    }
  })
}

function findBracket(timeline: TimelineEntry[], elapsedMs: number): { idx: number; frac: number } {
  // Binary search for the interval containing elapsedMs
  let lo = 0
  let hi = timeline.length - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (timeline[mid].timeOffsetMs <= elapsedMs) lo = mid
    else hi = mid - 1
  }
  const a = timeline[lo]
  const b = timeline[lo + 1]
  const span = b.timeOffsetMs - a.timeOffsetMs
  const frac = span > 0 ? (elapsedMs - a.timeOffsetMs) / span : 0
  return { idx: lo, frac: Math.max(0, Math.min(frac, 1)) }
}

function interpolate(timeline: TimelineEntry[], elapsedMs: number) {
  const last = timeline[timeline.length - 1]
  if (elapsedMs >= last.timeOffsetMs) {
    return {
      lat: last.lat,
      lng: last.lng,
      heading: last.heading,
      speed: last.speed,
      altitude: last.altitude,
      cumDist: last.cumulativeDistanceM
    }
  }

  const { idx, frac } = findBracket(timeline, elapsedMs)
  const a = timeline[idx]
  const b = timeline[idx + 1]

  return {
    lat: a.lat + (b.lat - a.lat) * frac,
    lng: a.lng + (b.lng - a.lng) * frac,
    heading: lerpAngle(a.heading, b.heading, frac),
    speed: a.speed + (b.speed - a.speed) * frac,
    altitude:
      a.altitude != null && b.altitude != null
        ? a.altitude + (b.altitude - a.altitude) * frac
        : a.altitude,
    cumDist:
      a.cumulativeDistanceM +
      (b.cumulativeDistanceM - a.cumulativeDistanceM) * frac
  }
}

export function useTripPlayback(trackpoints: Trackpoint[]): void {
  const timeline = useMemo(() => buildTimeline(trackpoints), [trackpoints])
  const rafRef = useRef(0)
  const lastFrameRef = useRef(0)

  // Set total duration when timeline changes
  useEffect(() => {
    if (timeline.length >= 2) {
      usePlaybackStore.getState().setTotalDuration(
        timeline[timeline.length - 1].timeOffsetMs
      )
    }
    return (): void => {
      usePlaybackStore.getState().reset()
    }
  }, [timeline])

  // Animation loop
  useEffect(() => {
    if (timeline.length < 2) return

    let prevPlaying = usePlaybackStore.getState().playing
    let prevElapsed = usePlaybackStore.getState().elapsedMs
    let prevSeeking = usePlaybackStore.getState().seeking

    const unsub = usePlaybackStore.subscribe((state) => {
      // React to playing changes
      if (state.playing !== prevPlaying) {
        prevPlaying = state.playing
        if (state.playing) {
          lastFrameRef.current = performance.now()
          rafRef.current = requestAnimationFrame(frame)
        } else {
          cancelAnimationFrame(rafRef.current)
        }
      }

      // React to seeking (scrubber drag)
      if (state.seeking && (state.elapsedMs !== prevElapsed || state.seeking !== prevSeeking)) {
        prevElapsed = state.elapsedMs
        prevSeeking = state.seeking
        const result = interpolate(timeline, state.elapsedMs)
        usePlaybackStore.getState().tick(
          state.elapsedMs,
          { lat: result.lat, lng: result.lng },
          result.heading,
          result.speed,
          result.altitude,
          result.cumDist
        )
      }
      prevSeeking = state.seeking
    })

    function frame(now: number): void {
      const store = usePlaybackStore.getState()
      if (!store.playing || store.seeking) {
        if (store.playing) rafRef.current = requestAnimationFrame(frame)
        return
      }

      const delta = (now - lastFrameRef.current) * store.speedMultiplier
      lastFrameRef.current = now
      const elapsed = store.elapsedMs + delta

      const totalDuration = timeline[timeline.length - 1].timeOffsetMs

      if (elapsed >= totalDuration) {
        const last = timeline[timeline.length - 1]
        store.tick(
          totalDuration,
          { lat: last.lat, lng: last.lng },
          last.heading,
          last.speed,
          last.altitude,
          last.cumulativeDistanceM
        )
        store.pause()
        return
      }

      const result = interpolate(timeline, elapsed)
      store.tick(
        elapsed,
        { lat: result.lat, lng: result.lng },
        result.heading,
        result.speed,
        result.altitude,
        result.cumDist
      )

      rafRef.current = requestAnimationFrame(frame)
    }

    return (): void => {
      unsub()
      cancelAnimationFrame(rafRef.current)
    }
  }, [timeline])
}
