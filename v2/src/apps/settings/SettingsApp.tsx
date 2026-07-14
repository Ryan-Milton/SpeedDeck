import { useVehicleStore } from "../../stores/vehicle-store";
import { useSettingsStore } from "../../stores/settings-store";
import type { SpeedUnit } from "../../lib/units";
import { HudPanel, SectionHeader, SettingsRow, ListRow, Tabs, AppHeader } from "../../components";
import OfflineMapsSection from "./OfflineMapsSection";
import MusicSection from "./MusicSection";
import "./settings.css";

const UNIT_TABS: { id: SpeedUnit; label: string }[] = [
  { id: "mph", label: "MPH" },
  { id: "kmh", label: "KM/H" },
  { id: "knots", label: "Knots" },
];

// Settings/about surface — grouped HUD panels.
export default function SettingsApp() {
  const state = useVehicleStore((s) => s.state);
  const speedUnit = useSettingsStore((s) => s.speedUnit);
  const setSpeedUnit = useSettingsStore((s) => s.setSpeedUnit);
  return (
    <div className="app-screen settings">
      <AppHeader title="Settings" />

      <SectionHeader title="Display" />
      <HudPanel brackets={false} className="settings-panel">
        <div className="settings-list">
          <ListRow
            label="Speed unit"
            value={<Tabs tabs={UNIT_TABS} value={speedUnit} onChange={setSpeedUnit} />}
          />
        </div>
      </HudPanel>

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
