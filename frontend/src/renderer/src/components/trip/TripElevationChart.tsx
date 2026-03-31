import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, ReferenceLine, ReferenceDot, ResponsiveContainer } from 'recharts'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { usePlaybackStore } from '../../stores/playback-store'
import { useSettingsStore } from '../../stores/settings-store'
import { distance3d, convertDistance, convertAltitude, distanceUnitLabel, altitudeUnitLabel } from '../../lib/utils'

export function TripElevationChart(): React.JSX.Element {
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)
  const playbackPosition = usePlaybackStore((s) => s.position)
  const playbackCumDist = usePlaybackStore((s) => s.cumulativeDistance)
  const playbackAlt = usePlaybackStore((s) => s.altitude)

  const data = useMemo(() => {
    let cumDist = 0
    return trackpoints
      .filter((p) => p.altitude != null)
      .map((p, i, arr) => {
        if (i > 0) {
          cumDist += distance3d(
            arr[i - 1].latitude, arr[i - 1].longitude, arr[i - 1].altitude,
            p.latitude, p.longitude, p.altitude
          )
        }
        return {
          dist: convertDistance(cumDist, speedUnit),
          elev: convertAltitude(p.altitude!, altUnit)
        }
      })
  }, [trackpoints, speedUnit, altUnit])

  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center text-text-tertiary text-sm" style={{ height: 140 }}>
        No elevation data
      </div>
    )
  }

  const minElev = Math.floor(Math.min(...data.map((d) => d.elev)) - 10)
  const maxElev = Math.ceil(Math.max(...data.map((d) => d.elev)) + 10)

  // Playback cursor position (converted to display units)
  const cursorDist = playbackPosition ? convertDistance(playbackCumDist, speedUnit) : null
  const cursorElev = playbackPosition && playbackAlt != null ? convertAltitude(playbackAlt, altUnit) : null

  return (
    <div className="border-t border-separator bg-surface" style={{ height: 140 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <defs>
            <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0A84FF" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#0A84FF" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dist"
            tick={{ fill: '#8E8E93', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: distanceUnitLabel(speedUnit), position: 'insideBottomRight', offset: -5, fill: '#48484A', fontSize: 10 }}
          />
          <YAxis
            domain={[minElev, maxElev]}
            tick={{ fill: '#8E8E93', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={45}
            label={{ value: altitudeUnitLabel(altUnit), position: 'insideTopLeft', offset: -5, fill: '#48484A', fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="elev"
            stroke="#0A84FF"
            strokeWidth={2}
            fill="url(#elevFill)"
            isAnimationActive={false}
          />
          {cursorDist !== null && (
            <ReferenceLine
              x={cursorDist}
              stroke="#FFFFFF"
              strokeWidth={2}
              strokeDasharray="4 2"
            />
          )}
          {cursorDist !== null && cursorElev !== null && (
            <ReferenceDot
              x={cursorDist}
              y={cursorElev}
              r={5}
              fill="#0A84FF"
              stroke="#FFFFFF"
              strokeWidth={2}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
