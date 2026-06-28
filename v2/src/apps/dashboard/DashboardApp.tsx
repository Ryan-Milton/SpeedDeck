import { speedConvert, cardinalDirection, METERS_TO_FEET } from "../../lib/units";
import { trip } from "../../lib/ipc";
import { useVehicleStore } from "../../stores/vehicle-store";

// Phase 8 turns this into the full CarPlay split view (map + now playing +
// widgets). For now it surfaces live telemetry plus trip-record controls.
export default function DashboardApp() {
  const state = useVehicleStore((s) => s.state);
  const status = state?.tripStatus ?? "idle";

  const speed = state ? Math.round(speedConvert(state.smoothedSpeed, "mph")) : 0;
  const heading = state ? `${Math.round(state.fix.heading)}° ${cardinalDirection(state.fix.heading)}` : "—";
  const alt = state?.fix.altitude != null ? `${Math.round(state.fix.altitude * METERS_TO_FEET)} ft` : "—";
  const tripKm = state ? (state.tripDistance / 1000).toFixed(2) : "0.00";

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
        <div className="dash-tile dash-trip">
          <div>
            <span className="dash-label">Trip · {status}</span>
            <span className="dash-val">{tripKm} km</span>
          </div>
          <div className="dash-rec">
            {status === "idle" ? (
              <button className="rec-btn start" onClick={() => trip.start().catch(() => {})}>
                ● Record
              </button>
            ) : (
              <>
                {status === "recording" ? (
                  <button className="rec-btn" onClick={() => trip.pause().catch(() => {})}>
                    Pause
                  </button>
                ) : (
                  <button className="rec-btn" onClick={() => trip.resume().catch(() => {})}>
                    Resume
                  </button>
                )}
                <button className="rec-btn stop" onClick={() => trip.stop().catch(() => {})}>
                  ■ Stop
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
