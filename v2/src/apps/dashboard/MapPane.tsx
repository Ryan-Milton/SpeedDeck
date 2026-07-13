import LiveMap from "../maps/LiveMap";
import { useShellStore } from "../../stores/shell-store";

// Dashboard map pane — embeds the live map; tap opens the full Maps app.
export default function MapPane() {
  const openApp = useShellStore((s) => s.openApp);
  return (
    <div
      className="dash-map active"
      role="button"
      aria-label="Open Maps"
      onClick={() => openApp("maps")}
    >
      <LiveMap />
      <span className="dash-map-label hud-label">Map</span>
      <i className="hud-corner tl" />
      <i className="hud-corner tr" />
      <i className="hud-corner bl" />
      <i className="hud-corner br" />
    </div>
  );
}
