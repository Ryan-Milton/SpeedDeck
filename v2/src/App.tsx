import { useEffect, useState } from "react";
import Shell from "./shell/Shell";

// One-shot power-on sweep: the HUD frame draws itself, the wordmark rises,
// then the overlay fades out and unmounts. Skipped under reduced motion.
function BootOverlay() {
  return (
    <div className="boot-overlay" aria-hidden>
      <svg className="boot-frame" viewBox="0 0 160 100" fill="none">
        <rect
          className="boot-sweep"
          x="3"
          y="3"
          width="154"
          height="94"
          rx="3"
          pathLength={1000}
          stroke="var(--accent)"
          strokeWidth="1"
        />
      </svg>
      <span className="boot-wordmark boot-in">SPEEDDECK</span>
    </div>
  );
}

// The HUD shell is the whole app. It subscribes to live telemetry and hosts
// the status bar, dock, Launchpad, and each app surface.
export default function App() {
  const [booting, setBooting] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => setBooting(false), 1200);
    return () => clearTimeout(t);
  }, [booting]);

  return (
    <>
      <Shell />
      {booting && <BootOverlay />}
    </>
  );
}
