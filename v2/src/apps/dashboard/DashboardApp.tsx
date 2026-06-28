import { speedConvert, cardinalDirection, METERS_TO_FEET } from "../../lib/units";
import { useVehicleStore } from "../../stores/vehicle-store";

// Phase 8 turns this into the full CarPlay split view (map + now playing +
// widgets). For now it surfaces the live telemetry already flowing from the
// vehicle layer — a useful, working glance card.
export default function DashboardApp() {
  const state = useVehicleStore((s) => s.state);

  const speed = state ? Math.round(speedConvert(state.smoothedSpeed, "mph")) : 0;
  const heading = state ? `${Math.round(state.fix.heading)}° ${cardinalDirection(state.fix.heading)}` : "—";
  const alt = state?.fix.altitude != null ? `${Math.round(state.fix.altitude * METERS_TO_FEET)} ft` : "—";
  const sats = state ? `${state.fix.satellites}` : "—";

  return (
    <div className="app-screen dashboard">
      <div className="dash-tile dash-speed">
        <span className="dash-big">{speed}</span>
        <span className="dash-unit">MPH</span>
      </div>
      <div className="dash-col">
        <div className="dash-tile">
          <span className="dash-label">Heading</span>
          <span className="dash-val">{heading}</span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Altitude</span>
          <span className="dash-val">{alt}</span>
        </div>
        <div className="dash-tile">
          <span className="dash-label">Satellites</span>
          <span className="dash-val">{sats}</span>
        </div>
      </div>
    </div>
  );
}
