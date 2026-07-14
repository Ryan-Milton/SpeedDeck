import LiveMap from "../maps/LiveMap";
import { useShellStore } from "../../stores/shell-store";
import { HudPanel } from "../../components";

// Dashboard map pane — embeds the live map; tap opens the full Maps app.
export default function MapPane() {
  const openApp = useShellStore((s) => s.openApp);
  return (
    <HudPanel active className="dash-map" onClick={() => openApp("maps")} ariaLabel="Open Maps">
      <LiveMap />
      <span className="dash-map-label hud-label">Map</span>
    </HudPanel>
  );
}
