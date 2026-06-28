import { useEffect } from "react";
import { onVehicleState, trip } from "./lib/ipc";
import { cardinalDirection, speedConvert, METERS_TO_FEET } from "./lib/units";
import { useVehicleStore } from "./stores/vehicle-store";

// Phase 2 telemetry readout. Proves the full GPS spine end-to-end: the Rust
// VehicleHub (simulator or live receiver) emits `vehicle:state` and the UI
// renders live speed/heading/altitude/position plus trip controls.
// Phase 3 replaces this with the CarPlay shell (HomeGrid / Dock / StatusBar).
export default function App() {
  const state = useVehicleStore((s) => s.state);
  const connected = useVehicleStore((s) => s.connected);
  const setState = useVehicleStore((s) => s.setState);

  useEffect(() => {
    const unlisten = onVehicleState(setState);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setState]);

  const speedMph = state ? Math.round(speedConvert(state.smoothedSpeed, "mph")) : 0;
  const heading = state ? Math.round(state.fix.heading) : 0;
  const cardinal = state ? cardinalDirection(state.fix.heading) : "—";
  const altFt =
    state && state.fix.altitude != null ? Math.round(state.fix.altitude * METERS_TO_FEET) : null;

  return (
    <div className="boot">
      <h1>SpeedDeck</h1>
      <p className="muted">
        v2 · GPS spine
        {state ? ` · source: ${state.source}` : connected ? "" : " · waiting for fix…"}
      </p>

      <div className="speed-hero">
        <span className="speed-value">{speedMph}</span>
        <span className="speed-unit">MPH</span>
      </div>

      <div className="card">
        <div className="row">
          <span className="label">heading</span>
          <span className="value">
            {heading}° {cardinal}
          </span>
        </div>
        <div className="row">
          <span className="label">altitude</span>
          <span className="value">{altFt != null ? `${altFt} ft` : "—"}</span>
        </div>
        <div className="row">
          <span className="label">position</span>
          <span className="value">
            {state
              ? `${state.fix.latitude.toFixed(5)}, ${state.fix.longitude.toFixed(5)}`
              : "—"}
          </span>
        </div>
        <div className="row">
          <span className="label">satellites · fix</span>
          <span className="value">
            {state ? `${state.fix.satellites} · ${state.fix.fixQuality}` : "—"}
          </span>
        </div>
        <div className="row">
          <span className="label">trip</span>
          <span className="value">
            {state
              ? `${state.tripStatus} · ${(state.tripDistance / 1000).toFixed(2)} km`
              : "—"}
          </span>
        </div>
      </div>

      <div className="controls">
        <button onClick={() => trip.start()}>Start</button>
        <button onClick={() => trip.pause()}>Pause</button>
        <button onClick={() => trip.resume()}>Resume</button>
        <button onClick={() => trip.stop()}>Stop</button>
      </div>
    </div>
  );
}
