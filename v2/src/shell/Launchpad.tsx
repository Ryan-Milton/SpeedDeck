import { useEffect, useRef, useState } from "react";
import { APPS } from "../apps/registry";
import { useShellStore, type AppId } from "../stores/shell-store";
import { AppIcon, HudPanel } from "../components";

const PER_PAGE = 8; // 2 rows x 4 cols
const COLS = 4;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Centered modal app launcher. Shows every app in a paged 2x4 grid; selecting
// one surfaces it (and closes). Touch-swipe or keyboard/d-pad to navigate.
export default function Launchpad() {
  const current = useShellStore((s) => s.mru[0]);
  const openApp = useShellStore((s) => s.openApp);
  const close = useShellStore((s) => s.closeLaunchpad);

  const pages = chunk(APPS, PER_PAGE);
  const [page, setPage] = useState(0);
  // Flat index across all apps for roving keyboard focus.
  const [focus, setFocus] = useState(() => Math.max(0, APPS.findIndex((a) => a.id === current)));
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => setPage(Math.floor(focus / PER_PAGE)), [focus]);
  useEffect(() => {
    btnRefs.current[focus]?.focus();
  }, [focus]);

  // Keyboard + controller (Steam Input maps the gamepad to these keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const max = APPS.length - 1;
      switch (e.key) {
        case "Escape":
        case "Backspace":
          e.preventDefault();
          close();
          break;
        case "ArrowRight":
          e.preventDefault();
          setFocus((f) => Math.min(max, f + 1));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setFocus((f) => Math.max(0, f - 1));
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocus((f) => Math.min(max, f + COLS));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocus((f) => Math.max(0, f - COLS));
          break;
        case "PageDown":
        case "]":
          e.preventDefault();
          setPage((p) => Math.min(pages.length - 1, p + 1));
          break;
        case "PageUp":
        case "[":
          e.preventDefault();
          setPage((p) => Math.max(0, p - 1));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pages.length, close]);

  // Touch swipe between pages.
  const touchX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touchX.current = e.touches[0].clientX);
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 60) {
      if (dx < 0) setPage((p) => Math.min(pages.length - 1, p + 1));
      else setPage((p) => Math.max(0, p - 1));
    }
    touchX.current = null;
  };

  const select = (id: AppId) => openApp(id);

  return (
    <div className="launchpad-scrim boot-in" onClick={close}>
      <HudPanel className="launchpad" onClick={(e) => e.stopPropagation()}>
        <div className="launchpad-head">
          <span className="hud-label">Applications</span>
        </div>
        <div className="launchpad-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="launchpad-track" style={{ transform: `translateX(-${page * 100}%)` }}>
            {pages.map((p, pi) => (
              <div className="launchpad-page" key={pi}>
                {p.map((app, i) => {
                  const flat = pi * PER_PAGE + i;
                  return (
                    <AppIcon
                      key={app.id}
                      ref={(el) => {
                        btnRefs.current[flat] = el;
                      }}
                      app={app}
                      size={88}
                      showLabel
                      current={app.id === current}
                      onClick={() => select(app.id)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {pages.length > 1 && (
          <div className="launchpad-dots">
            {pages.map((_, i) => (
              <button
                key={i}
                className={`lp-dot${i === page ? " active" : ""}`}
                aria-label={`Page ${i + 1}`}
                onClick={() => setPage(i)}
              />
            ))}
          </div>
        )}
      </HudPanel>
    </div>
  );
}
