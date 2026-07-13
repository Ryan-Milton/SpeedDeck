import { APP_BY_ID } from "../apps/registry";
import { useVehicleFeed } from "../hooks/useVehicleFeed";
import { useNavigation } from "../hooks/useNavigation";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { useDevNav } from "../hooks/useDevNav";
import { useShellStore } from "../stores/shell-store";
import Dock from "./Dock";
import Launchpad from "./Launchpad";
import StatusBar from "./StatusBar";
import "./shell.css";

// The HUD shell: top status bar, the surfaced app (cross-fades on switch),
// a floating bottom dock, and the Launchpad overlay. There is no Home screen.
export default function Shell() {
  useVehicleFeed(); // single live subscription to backend telemetry
  useNavigation(); // route guidance + reroute driven by the GPS feed
  useMediaFeed(); // live music playback state
  useDevNav(); // dev-only deep-link + keyboard nav (no-op in production)

  const activeApp = useShellStore((s) => s.mru[0]);
  const launchpadOpen = useShellStore((s) => s.launchpadOpen);
  const ActiveScreen = APP_BY_ID[activeApp].Screen;

  return (
    <div className="shell">
      <StatusBar />
      <div className="content">
        {/* key by app id so each switch replays the fade-in */}
        <div className="content-screen" key={activeApp}>
          <ActiveScreen />
        </div>
      </div>
      <Dock />
      {launchpadOpen && <Launchpad />}
    </div>
  );
}
