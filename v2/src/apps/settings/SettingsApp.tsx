import { useVehicleStore } from "../../stores/vehicle-store";

// Minimal settings/about surface. Grows with unit selection, map region
// management, music sources, etc. in later phases.
export default function SettingsApp() {
  const state = useVehicleStore((s) => s.state);
  return (
    <div className="app-screen settings">
      <h2>Settings</h2>
      <div className="settings-list">
        <div className="settings-row">
          <span>GPS source</span>
          <span className="muted">{state?.source ?? "waiting…"}</span>
        </div>
        <div className="settings-row">
          <span>Fix quality</span>
          <span className="muted">{state ? state.fix.fixQuality : "—"}</span>
        </div>
        <div className="settings-row">
          <span>Version</span>
          <span className="muted">SpeedDeck v2.0.0</span>
        </div>
      </div>
    </div>
  );
}
