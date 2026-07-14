import { useVehicleStore } from "../../stores/vehicle-store";
import { useNavigationStore } from "../../stores/navigation-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useShellStore } from "../../stores/shell-store";
import {
  speedConvert,
  speedUnitLabel,
  cardinalDirection,
  formatNavDistance,
  METERS_TO_FEET,
} from "../../lib/units";
import { maneuverInstruction } from "../../lib/nav-utils";
import ManeuverArrow from "../maps/nav/ManeuverArrow";
import { HudPanel, Gauge, StatGroup } from "../../components";

// Next-turn while navigating; otherwise the speed gauge. Tap → Maps.
export default function GlanceCard() {
  const veh = useVehicleStore((s) => s.state);
  const status = useNavigationStore((s) => s.status);
  const route = useNavigationStore((s) => s.route);
  const activeStepIndex = useNavigationStore((s) => s.activeStepIndex);
  const distanceToNextManeuver = useNavigationStore((s) => s.distanceToNextManeuver);
  const eta = useNavigationStore((s) => s.eta);
  const unit = useSettingsStore((s) => s.speedUnit);
  const openApp = useShellStore((s) => s.openApp);

  if (status === "navigating" && route) {
    const next = route.steps[activeStepIndex + 1] ?? route.steps[activeStepIndex];
    return (
      <HudPanel className="glance-card" onClick={() => openApp("maps")}>
        <span className="hud-label">Next turn</span>
        <div className="glance-turn">
          <ManeuverArrow type={next?.maneuver.type ?? "straight"} modifier={next?.maneuver.modifier} size={40} />
          <div className="glance-turn-text">
            <span className="glance-dist">{formatNavDistance(distanceToNextManeuver, unit)}</span>
            <span className="glance-instr">
              {maneuverInstruction(next?.maneuver.type ?? "", next?.maneuver.modifier, next?.name)}
            </span>
          </div>
        </div>
        <span className="glance-eta muted">ETA {eta || "--:--"}</span>
      </HudPanel>
    );
  }

  const speed = veh ? Math.round(speedConvert(veh.smoothedSpeed, unit)) : 0;
  const heading = veh ? `${Math.round(veh.fix.heading)}° ${cardinalDirection(veh.fix.heading)}` : "—";
  const max = unit === "kmh" ? 200 : unit === "knots" ? 100 : 120;
  const spUnit = speedUnitLabel(unit).toLowerCase();
  const maxSp = veh ? Math.round(speedConvert(veh.maxSpeed, unit)) : null;
  const avgSp = veh ? Math.round(speedConvert(veh.avgSpeed, unit)) : null;
  const alt =
    veh?.fix.altitude != null
      ? Math.round(unit === "kmh" ? veh.fix.altitude : veh.fix.altitude * METERS_TO_FEET)
      : null;
  return (
    <HudPanel className="glance-card speed" onClick={() => openApp("maps")}>
      <Gauge value={speed} max={max} unit={speedUnitLabel(unit)} label="Speed" size={232} />
      <span className="glance-heading hud-label">{heading}</span>
      <div className="glance-stats">
        <StatGroup label="Max" value={maxSp ?? "—"} unit={maxSp != null ? spUnit : undefined} />
        <StatGroup label="Avg" value={avgSp ?? "—"} unit={avgSp != null ? spUnit : undefined} />
        <StatGroup
          label="Alt"
          value={alt ?? "—"}
          unit={alt != null ? (unit === "kmh" ? "m" : "ft") : undefined}
        />
      </div>
    </HudPanel>
  );
}
