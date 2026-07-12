import { APP_BY_ID } from "../apps/registry";
import { useVehicleFeed } from "../hooks/useVehicleFeed";
import { useNavigation } from "../hooks/useNavigation";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { useDevNav } from "../hooks/useDevNav";
import { useShellStore } from "../stores/shell-store";
import Dock from "./Dock";
import HomeGrid from "./HomeGrid";
import StatusBar from "./StatusBar";
import "./shell.css";

// The CarPlay shell: status bar across the top, the left dock, and the content
// area that shows either the home grid or the active app.
export default function Shell() {
  useVehicleFeed(); // single live subscription to backend telemetry
  useNavigation(); // route guidance + reroute driven by the GPS feed
  useMediaFeed(); // live music playback state
  useDevNav(); // dev-only deep-link + keyboard nav (no-op in production)

  const activeApp = useShellStore((s) => s.activeApp);
  const ActiveScreen = activeApp ? APP_BY_ID[activeApp].Screen : null;

  return (
    <div className="shell">
      <StatusBar />
      <div className="shell-body">
        <Dock />
        <main className="content">{ActiveScreen ? <ActiveScreen /> : <HomeGrid />}</main>
      </div>
    </div>
  );
}
