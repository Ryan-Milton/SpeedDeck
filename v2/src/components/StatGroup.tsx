import type { ReactNode } from "react";

/** A HUD telemetry readout: tracked label above a big Saira value + unit. */
export function StatGroup({
  label,
  value,
  unit,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
}) {
  return (
    <div className="stat-group">
      <span className="hud-label">{label}</span>
      <span className="stat-value">
        {value}
        {unit && <span className="stat-unit">{unit}</span>}
      </span>
    </div>
  );
}
