import { useVehicleStore } from "../../stores/vehicle-store";
import { useNavigationStore } from "../../stores/navigation-store";
import { useSettingsStore } from "../../stores/settings-store";
import { useShellStore } from "../../stores/shell-store";
import {
  speedConvert,
  speedUnitLabel,
  cardinalDirection,
  formatNavDistance,
} from "../../lib/units";
import { maneuverInstruction } from "../../lib/nav-utils";
import ManeuverArrow from "../maps/nav/ManeuverArrow";

// Next-turn while navigating; otherwise a big current-speed glance. Tap → Maps.
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
      <div className="dash-card glance-card" role="button" onClick={() => openApp("maps")}>
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
      </div>
    );
  }

  const speed = veh ? Math.round(speedConvert(veh.smoothedSpeed, unit)) : 0;
  const heading = veh ? `${Math.round(veh.fix.heading)}° ${cardinalDirection(veh.fix.heading)}` : "—";
  return (
    <div className="dash-card glance-card speed" role="button" onClick={() => openApp("maps")}>
      <span className="glance-speed">{speed}</span>
      <span className="glance-speed-unit">{speedUnitLabel(unit)}</span>
      <span className="glance-heading muted">{heading}</span>
    </div>
  );
}
