import { useHistoryStore } from '../../stores/history-store'
import { useSettingsStore } from '../../stores/settings-store'
import { convertSpeed, speedUnitLabel } from '../../lib/utils'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'

export function SpeedGraph(): React.JSX.Element {
  const points = useHistoryStore((s) => s.points)
  const unit = useSettingsStore((s) => s.speedUnit)

  const data = points.map((p) => ({
    t: p.t,
    speed: Math.round(convertSpeed(p.speed, unit))
  }))

  const maxY = Math.max(10, ...data.map((d) => d.speed)) * 1.1

  return (
    <div className="h-[120px] w-full px-4 pb-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <XAxis dataKey="t" hide />
          <YAxis
            domain={[0, maxY]}
            width={40}
            tick={{ fill: '#48484A', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Line
            type="monotone"
            dataKey="speed"
            stroke="#0A84FF"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="text-center -mt-1">
        <span className="text-[11px] text-text-secondary">
          Speed ({speedUnitLabel(unit)}) — Last 10 min
        </span>
      </div>
    </div>
  )
}
