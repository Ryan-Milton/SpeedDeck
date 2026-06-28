import { useNavigationStore } from "../../../stores/navigation-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { formatNavDistance, speedConvert } from "../../../lib/units";

function fmtRemaining(sec: number): string {
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Bottom bar during navigation: ETA, remaining distance/time, speed limit, End.
export default function NavStatusBar() {
  const status = useNavigationStore((s) => s.status);
  const eta = useNavigationStore((s) => s.eta);
  const distanceRemaining = useNavigationStore((s) => s.distanceRemaining);
  const durationRemaining = useNavigationStore((s) => s.durationRemaining);
  const speedLimit = useNavigationStore((s) => s.currentSpeedLimit);
  const stop = useNavigationStore((s) => s.stopNavigation);
  const unit = useSettingsStore((s) => s.speedUnit);

  if (status !== "navigating") return null;

  // currentSpeedLimit is km/h; convert to the user's unit via m/s.
  const limit = speedLimit != null ? Math.round(speedConvert(speedLimit / 3.6, unit)) : null;

  return (
    <div className="nav-statusbar">
      {limit != null && (
        <div className="speed-limit" aria-label="Speed limit">
          <span>{limit}</span>
        </div>
      )}
      <div className="nav-eta">
        <span className="nav-eta-time">{eta || "--:--"}</span>
        <span className="nav-eta-sub">
          {formatNavDistance(distanceRemaining, unit)} · {fmtRemaining(durationRemaining)}
        </span>
      </div>
      <button className="nav-end" onClick={stop}>
        End
      </button>
    </div>
  );
}
