import { useEffect, useState } from "react";
import { ping, onTick } from "./lib/ipc";
import { useVehicleStore } from "./stores/vehicle-store";

// Phase 1 skeleton screen. Proves the two halves of the Tauri IPC bridge:
//   1. command round-trip  (frontend invoke -> Rust -> result)
//   2. event stream        (Rust emit -> frontend listen)
// Phase 3 replaces this with the CarPlay shell (HomeGrid / Dock / StatusBar).
export default function App() {
  const [pong, setPong] = useState("…");
  const tickCount = useVehicleStore((s) => s.tickCount);
  const tickMessage = useVehicleStore((s) => s.tickMessage);
  const setTick = useVehicleStore((s) => s.setTick);

  useEffect(() => {
    ping("SpeedDeck")
      .then(setPong)
      .catch((err) => setPong(`error: ${String(err)}`));

    const unlisten = onTick((t) => setTick(t.count, t.message));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [setTick]);

  return (
    <div className="boot">
      <h1>SpeedDeck</h1>
      <p className="muted">v2 — CarPlay-style shell · skeleton</p>

      <div className="card">
        <div className="row">
          <span className="label">command round-trip</span>
          <span className="value">{pong}</span>
        </div>
        <div className="row">
          <span className="label">event stream</span>
          <span className="value">
            tick #{tickCount}
            {tickMessage ? ` — ${tickMessage}` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
