/**
 * Racing-telemetry speed gauge — the brand signature. A 270° arc with a cyan
 * value sweep, tick marks, and a big Saira numeral at the center.
 */
export function Gauge({
  value,
  max = 160,
  unit = "MPH",
  label = "SPEED",
  size = 240,
  ticks = 13,
}: {
  value: number;
  max?: number;
  unit?: string;
  label?: string;
  size?: number;
  ticks?: number;
}) {
  const stroke = 10;
  const r = size / 2 - stroke - 6;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const SWEEP = 0.75; // 270°
  const track = C * SWEEP;
  const frac = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const valLen = track * frac;

  // Tick marks spaced across the 270° arc (gap centered at the bottom).
  const startDeg = 135;
  const tickEls = Array.from({ length: ticks }, (_, i) => {
    const a = ((startDeg + (270 * i) / (ticks - 1)) * Math.PI) / 180;
    const ro = r + stroke / 2 + 4;
    const ri = ro - (i % ((ticks - 1) / 4 || 1) === 0 ? 12 : 7);
    const reached = i / (ticks - 1) <= frac;
    return (
      <line
        key={i}
        x1={cx + ri * Math.cos(a)}
        y1={cy + ri * Math.sin(a)}
        x2={cx + ro * Math.cos(a)}
        y2={cy + ro * Math.sin(a)}
        stroke={reached ? "var(--accent)" : "var(--text-dim)"}
        strokeWidth={1.5}
      />
    );
  });

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(135 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--surface-3)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${track} ${C}`}
          />
          <circle
            className="gauge-arc"
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${valLen} ${C}`}
          />
        </g>
        {tickEls}
      </svg>
      <div className="gauge-center">
        <span className="hud-label">{label}</span>
        <span className="gauge-value">{Math.round(value)}</span>
        <span className="gauge-unit">{unit}</span>
      </div>
    </div>
  );
}
