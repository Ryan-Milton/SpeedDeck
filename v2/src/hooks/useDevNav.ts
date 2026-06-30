import { useEffect } from "react";
import { useShellStore, type AppId } from "../stores/shell-store";

// Dev-only navigation affordance for automated screenshots / manual testing.
// Two ways to jump straight to a surface without clicking the dock:
//   1. URL deep-link on load:  http://localhost:1420/?app=maps  (or #maps)
//   2. Hidden keyboard shortcut: Ctrl+Alt+<digit> to switch in-place.
//        0 = home, 1 = maps, 2 = music, 3 = dashboard,
//        4 = nowplaying, 5 = trips, 6 = settings
// The keyboard path is what works inside the real Tauri WKWebView (its URL
// can't be rewritten from outside), so synthetic keystrokes can drive it.
// Compiled out of production builds via `import.meta.env.DEV`.

const KEY_TO_APP: Record<string, AppId | null> = {
  "0": null,
  "1": "maps",
  "2": "music",
  "3": "dashboard",
  "4": "nowplaying",
  "5": "trips",
  "6": "settings",
};

const VALID: AppId[] = [
  "maps",
  "music",
  "dashboard",
  "nowplaying",
  "trips",
  "phone",
  "settings",
];

function go(target: AppId | null) {
  const { openApp, goHome } = useShellStore.getState();
  if (target) openApp(target);
  else goHome();
}

export function useDevNav() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;

    // 1. Deep-link from the URL on first load.
    const params = new URLSearchParams(window.location.search);
    const raw = (params.get("app") ?? window.location.hash.replace(/^#/, "")).toLowerCase();
    if (raw === "home") go(null);
    else if (VALID.includes(raw as AppId)) go(raw as AppId);

    // 2. Hidden keyboard shortcut for in-place switching.
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey)) return;
      if (!(e.key in KEY_TO_APP)) return;
      e.preventDefault();
      go(KEY_TO_APP[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
