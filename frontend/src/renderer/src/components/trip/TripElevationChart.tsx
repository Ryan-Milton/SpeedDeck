import { useMemo } from 'react'
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { useTripViewerStore } from '../../stores/trip-viewer-store'
import { useSettingsStore } from '../../stores/settings-store'
import { haversineDistance, convertDistance, convertAltitude, distanceUnitLabel, altitudeUnitLabel } from '../../lib/utils'

export function TripElevationChart(): React.JSX.Element {
  const trackpoints = useTripViewerStore((s) => s.trackpoints)
  const speedUnit = useSettingsStore((s) => s.speedUnit)
  const altUnit = useSettingsStore((s) => s.altitudeUnit)

  const data = useMemo(() => {
    let cumDist = 0
    return trackpoints
      .filter((p) => p.altitude != null)
      .map((p, i, arr) => {
        if (i > 0) {
          cumDist += haversineDistance(
            arr[i - 1].latitude, arr[i - 1].longitude,
            p.latitude, p.longitude
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
      <div className="flex items-center justify-center text-zinc-500 text-sm" style={{ height: 140 }}>
        No elevation data
      </div>
    )
  }

  const minElev = Math.floor(Math.min(...data.map((d) => d.elev)) - 10)
  const maxElev = Math.ceil(Math.max(...data.map((d) => d.elev)) + 10)

  return (
    <div className="border-t border-zinc-800 bg-zinc-950/80" style={{ height: 140 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <defs>
            <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="dist"
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toFixed(1)}
            label={{ value: distanceUnitLabel(speedUnit), position: 'insideBottomRight', offset: -5, fill: '#52525b', fontSize: 10 }}
          />
          <YAxis
            domain={[minElev, maxElev]}
            tick={{ fill: '#71717a', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={45}
            label={{ value: altitudeUnitLabel(altUnit), position: 'insideTopLeft', offset: -5, fill: '#52525b', fontSize: 10 }}
          />
          <Area
            type="monotone"
            dataKey="elev"
            stroke="#22d3ee"
            strokeWidth={2}
            fill="url(#elevFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
