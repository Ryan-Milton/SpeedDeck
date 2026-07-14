import { useRef } from "react";
import { APP_BY_ID } from "../apps/registry";
import type { AppId } from "../stores/shell-store";
import { useVehicleFeed } from "../hooks/useVehicleFeed";
import { useNavigation } from "../hooks/useNavigation";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { useDevNav } from "../hooks/useDevNav";
import { useShellStore } from "../stores/shell-store";
import Dock from "./Dock";
import Launchpad from "./Launchpad";
import StatusBar from "./StatusBar";
import { ToastHost } from "../components";
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

  // Keep every visited app mounted and hide the inactive ones, instead of
  // remounting on each switch — tearing down Maps meant a full MapLibre
  // cold-start on every return. Append-only render cache (max 7 apps).
  const visitedRef = useRef<AppId[]>([]);
  if (!visitedRef.current.includes(activeApp)) {
    visitedRef.current = [...visitedRef.current, activeApp];
  }

  return (
    <div className="shell">
      <StatusBar />
      <div className="content">
        {visitedRef.current.map((id) => {
          const Screen = APP_BY_ID[id].Screen;
          const active = id === activeApp;
          return (
            // display:none cancels the fade-in animation, so it replays
            // on every reveal — same visual as the old key-remount.
            <div key={id} className={active ? "content-screen" : "content-screen hidden"}>
              <Screen />
            </div>
          );
        })}
      </div>
      <Dock />
      <ToastHost />
      {launchpadOpen && <Launchpad />}
    </div>
  );
}
