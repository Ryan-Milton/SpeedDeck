import { useEffect, useState } from "react";
import { useVehicleStore } from "../stores/vehicle-store";
import { useNavigationStore } from "../stores/navigation-store";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// HUD top status bar: current street (wordmark fallback) on the left,
// GPS chip + clock on the right. The street name is already computed every
// GPS tick by the nav store — this is its first consumer.
export default function StatusBar() {
  const time = useClock();
  const state = useVehicleStore((s) => s.state);
  const connected = useVehicleStore((s) => s.connected);
  const street = useNavigationStore((s) => s.currentStreetName);

  const hasFix = !!state && state.fix.fixQuality > 0;
  const sats = state?.fix.satellites ?? 0;

  return (
    <div className="statusbar">
      {street ? (
        <span className="status-left street truncate">{street}</span>
      ) : (
        <span className="status-left">SpeedDeck</span>
      )}
      <span className="status-right">
        <span className="gps-chip">
          <span className={`gps-dot ${hasFix ? "ok" : connected ? "weak" : "off"}`} />
          <span className="gps-label">{connected ? `${sats} sat · fix` : "no gps"}</span>
        </span>
        <span className="status-clock">{time}</span>
      </span>
    </div>
  );
}
