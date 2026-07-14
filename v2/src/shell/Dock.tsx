import { APPS } from "../apps/registry";
import { useShellStore } from "../stores/shell-store";
import { AppIcon } from "../components";

// Floating dock: a FIXED set of pinned apps (registry `inDock`), then a divider
// and the Launchpad button. Pinned order never changes — while driving, muscle
// memory needs stable targets, so no MRU reshuffling here. The active app gets
// the cyan ring; everything else lives in the Launchpad.
export default function Dock() {
  const activeApp = useShellStore((s) => s.mru[0]);
  const openApp = useShellStore((s) => s.openApp);
  const toggleLaunchpad = useShellStore((s) => s.toggleLaunchpad);
  const launchpadOpen = useShellStore((s) => s.launchpadOpen);

  const pinned = APPS.filter((a) => a.inDock && a.enabled);

  return (
    <nav className="dock" aria-label="App dock">
      <div className="dock-rail">
        {pinned.map((app) => (
          <AppIcon
            key={app.id}
            app={app}
            size={54}
            current={app.id === activeApp}
            onClick={() => openApp(app.id)}
          />
        ))}
      </div>
      <span className="dock-divider" />
      <button
        className={`dock-launch${launchpadOpen ? " on" : ""}`}
        onClick={toggleLaunchpad}
        aria-label="All apps"
        aria-expanded={launchpadOpen}
      >
        <span className="launch-glyph">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
      </button>
    </nav>
  );
}
