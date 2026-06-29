import { APPS } from "../apps/registry";
import { useShellStore } from "../stores/shell-store";

// CarPlay's left dock: quick app shortcuts plus the home/grid button at the
// bottom. Always visible alongside the active app.
export default function Dock() {
  const activeApp = useShellStore((s) => s.activeApp);
  const openApp = useShellStore((s) => s.openApp);
  const goHome = useShellStore((s) => s.goHome);

  const dockApps = APPS.filter((a) => a.inDock);

  return (
    <nav className="dock">
      <div className="dock-apps">
        {dockApps.map((a) => (
          <button
            key={a.id}
            className={`dock-btn ${activeApp === a.id ? "active" : ""} ${a.enabled ? "" : "disabled"}`}
            style={{ background: `linear-gradient(160deg, ${a.gradient[0]}, ${a.gradient[1]})` }}
            onClick={() => a.enabled && openApp(a.id)}
            aria-label={a.label}
            disabled={!a.enabled}
          >
            <a.Icon size={26} />
          </button>
        ))}
      </div>
      <button
        className={`dock-btn home ${activeApp === null ? "active" : ""}`}
        onClick={goHome}
        aria-label="Home"
      >
        <span className="home-grid-glyph">
          <i /><i /><i /><i />
        </span>
      </button>
    </nav>
  );
}
