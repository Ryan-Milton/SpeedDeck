import { useNavigationStore } from "../../../stores/navigation-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { formatNavDistance } from "../../../lib/units";
import { nav } from "../../../lib/nav";

function fmtDuration(sec: number): string {
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// Bottom sheet shown after a route is calculated, before navigation starts.
export default function RoutePreview() {
  const status = useNavigationStore((s) => s.status);
  const route = useNavigationStore((s) => s.route);
  const destination = useNavigationStore((s) => s.destination);
  const isCalculating = useNavigationStore((s) => s.isCalculating);
  const start = useNavigationStore((s) => s.startNavigation);
  const stop = useNavigationStore((s) => s.stopNavigation);
  const unit = useSettingsStore((s) => s.speedUnit);

  function startNavigation() {
    void nav.noteActivity().catch(() => {});
    start();
  }

  if (isCalculating) {
    return <div className="route-preview calculating">Calculating route…</div>;
  }
  if (status !== "previewing" || !route) return null;

  return (
    <div className="route-preview">
      <div className="rp-info">
        <span className="rp-dest">{destination?.name ?? "Destination"}</span>
        <span className="rp-meta">
          {formatNavDistance(route.distance, unit)} · {fmtDuration(route.duration)}
        </span>
      </div>
      <div className="rp-actions">
        <button className="rp-cancel" onClick={stop}>
          Cancel
        </button>
        <button className="rp-go" onClick={startNavigation}>
          Go
        </button>
      </div>
    </div>
  );
}
