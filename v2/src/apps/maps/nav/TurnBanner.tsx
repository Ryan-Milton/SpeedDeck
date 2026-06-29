import { useNavigationStore } from "../../../stores/navigation-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { formatNavDistance } from "../../../lib/units";
import { maneuverInstruction } from "../../../lib/nav-utils";
import ManeuverArrow from "./ManeuverArrow";

// Top-of-screen next-maneuver banner during navigation.
export default function TurnBanner() {
  const status = useNavigationStore((s) => s.status);
  const route = useNavigationStore((s) => s.route);
  const activeStepIndex = useNavigationStore((s) => s.activeStepIndex);
  const distanceToNextManeuver = useNavigationStore((s) => s.distanceToNextManeuver);
  const unit = useSettingsStore((s) => s.speedUnit);

  if (status !== "navigating" || !route) return null;

  const steps = route.steps;
  const next = steps[activeStepIndex + 1] ?? steps[activeStepIndex];
  if (!next) return null;
  const then = steps[activeStepIndex + 2];
  const close = distanceToNextManeuver < 100;

  return (
    <div className={`turn-banner ${close ? "imminent" : ""}`}>
      <div className="turn-arrow">
        <ManeuverArrow type={next.maneuver.type} modifier={next.maneuver.modifier} size={44} />
      </div>
      <div className="turn-text">
        <span className="turn-dist">{formatNavDistance(distanceToNextManeuver, unit)}</span>
        <span className="turn-instruction">
          {maneuverInstruction(next.maneuver.type, next.maneuver.modifier, next.name)}
        </span>
        {then && (
          <span className="turn-then">
            then {maneuverInstruction(then.maneuver.type, then.maneuver.modifier, then.name)}
          </span>
        )}
      </div>
    </div>
  );
}
