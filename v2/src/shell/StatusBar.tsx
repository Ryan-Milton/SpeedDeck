import { useEffect, useState } from "react";
import { useVehicleStore } from "../stores/vehicle-store";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// CarPlay-style top status bar: brand/clock on the left, GPS signal on the right.
export default function StatusBar() {
  const time = useClock();
  const state = useVehicleStore((s) => s.state);
  const connected = useVehicleStore((s) => s.connected);

  const hasFix = !!state && state.fix.fixQuality > 0;
  const sats = state?.fix.satellites ?? 0;

  return (
    <div className="statusbar">
      <span className="status-left">SpeedDeck</span>
      <span className="status-right">
        <span className={`gps-dot ${hasFix ? "ok" : connected ? "weak" : "off"}`} />
        <span className="gps-sats">{connected ? `${sats} sat` : "no GPS"}</span>
        <span className="status-clock">{time}</span>
      </span>
    </div>
  );
}
