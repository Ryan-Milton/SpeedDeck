import LiveMap from "../maps/LiveMap";
import { useShellStore } from "../../stores/shell-store";

// Dashboard map pane — embeds the live map; tap opens the full Maps app.
export default function MapPane() {
  const openApp = useShellStore((s) => s.openApp);
  return (
    <div
      className="dash-map"
      role="button"
      aria-label="Open Maps"
      onClick={() => openApp("maps")}
    >
      <LiveMap />
    </div>
  );
}
