import { APPS } from "../apps/registry";
import { useShellStore } from "../stores/shell-store";

// The CarPlay home screen: a grid of rounded app icons with labels.
export default function HomeGrid() {
  const openApp = useShellStore((s) => s.openApp);

  return (
    <div className="home-grid">
      {APPS.map((a) => (
        <button
          key={a.id}
          className={`app-icon ${a.enabled ? "" : "disabled"}`}
          onClick={() => a.enabled && openApp(a.id)}
          disabled={!a.enabled}
        >
          <span
            className="app-glyph"
            style={{ background: `linear-gradient(160deg, ${a.gradient[0]}, ${a.gradient[1]})` }}
          >
            <a.Icon size={34} />
          </span>
          <span className="app-name">{a.label}</span>
        </button>
      ))}
    </div>
  );
}
