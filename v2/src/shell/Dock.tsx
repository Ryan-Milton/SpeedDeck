import { useLayoutEffect, useRef } from "react";
import { APP_BY_ID } from "../apps/registry";
import { useShellStore } from "../stores/shell-store";
import { AppIcon } from "../components";

const DOCK_COUNT = 3; // most-recent apps shown in the dock

// macOS-style floating dock: the current app (cyan ring) plus the two prior
// apps, then a divider and the Launchpad button. Icons slide when the MRU
// reorders (FLIP); the surfaced app content cross-fades separately.
export default function Dock() {
  const mru = useShellStore((s) => s.mru);
  const openApp = useShellStore((s) => s.openApp);
  const toggleLaunchpad = useShellStore((s) => s.toggleLaunchpad);
  const launchpadOpen = useShellStore((s) => s.launchpadOpen);

  const recent = mru.slice(0, DOCK_COUNT);
  const railRef = useRef<HTMLDivElement>(null);
  const prevRects = useRef<Map<string, DOMRect>>(new Map());

  // FLIP: animate each tile from its previous position to the new one.
  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const tiles = rail.querySelectorAll<HTMLElement>("[data-app]");
    tiles.forEach((el) => {
      const id = el.dataset.app!;
      const prev = prevRects.current.get(id);
      const next = el.getBoundingClientRect();
      if (prev) {
        const dx = prev.left - next.left;
        if (dx) {
          el.animate(
            [{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }],
            { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" }
          );
        }
      }
      prevRects.current.set(id, next);
    });
  }, [mru]);

  return (
    <nav className="dock" aria-label="App dock">
      <div className="dock-rail" ref={railRef}>
        {recent.map((id, i) => (
          <div className="dock-slot" data-app={id} key={id}>
            <AppIcon app={APP_BY_ID[id]} size={54} current={i === 0} onClick={() => openApp(id)} />
          </div>
        ))}
      </div>
      <span className="dock-divider" />
      <button
        className={`dock-launch${launchpadOpen ? " on" : ""}`}
        onClick={toggleLaunchpad}
        aria-label="Launchpad"
        aria-expanded={launchpadOpen}
      >
        <span className="launch-glyph">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
      </button>
    </nav>
  );
}
