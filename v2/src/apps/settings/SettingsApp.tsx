import { useVehicleStore } from "../../stores/vehicle-store";
import { HudPanel, SectionHeader, SettingsRow } from "../../components";
import OfflineMapsSection from "./OfflineMapsSection";
import MusicSection from "./MusicSection";
import "./settings.css";

// Settings/about surface — grouped HUD panels.
export default function SettingsApp() {
  const state = useVehicleStore((s) => s.state);
  return (
    <div className="app-screen settings">
      <h2>Settings</h2>

      <SectionHeader title="System" />
      <HudPanel brackets={false} className="settings-panel">
        <div className="settings-list">
          <SettingsRow label="GPS source" value={state?.source ?? "waiting…"} />
          <SettingsRow label="Fix quality" value={state ? state.fix.fixQuality : "—"} />
          <SettingsRow label="Version" value="SpeedDeck v2.0.0" />
        </div>
      </HudPanel>

      <OfflineMapsSection />
      <MusicSection />
    </div>
  );
}
