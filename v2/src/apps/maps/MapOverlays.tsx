import { speedConvert, cardinalDirection, type SpeedUnit } from "../../lib/units";
import { useVehicleStore } from "../../stores/vehicle-store";
import { useSettingsStore } from "../../stores/settings-store";

function unitLabel(u: SpeedUnit): string {
  return u === "mph" ? "MPH" : u === "kmh" ? "KM/H" : "KN";
}

function CompassGlyph({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2} strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5 11 11l-2.5 4.5L13 13z" fill="white" stroke="none" />
    </svg>
  );
}

// CarPlay-style glanceable overlays on top of the live map.
export default function MapOverlays() {
  const state = useVehicleStore((s) => s.state);
  const unit = useSettingsStore((s) => s.speedUnit);
  const orientation = useSettingsStore((s) => s.mapOrientation);
  const toggleOrientation = useSettingsStore((s) => s.toggleMapOrientation);

  const hasFix = !!state && state.fix.fixQuality > 0;
  const speed = hasFix ? Math.round(speedConvert(state.smoothedSpeed, unit)) : null;
  const heading = state ? Math.round(state.fix.heading) : null;
  const cardinal = state ? cardinalDirection(state.fix.heading) : "--";

  return (
    <>
      <div className="map-overlay top-left">
        <div className="pill heading-pill">
          <span className="pill-big">{hasFix ? cardinal : "--"}</span>
          {hasFix && heading !== null && <span className="pill-sub">{heading}°</span>}
        </div>
      </div>

      <div className="map-overlay top-right">
        <div className="pill speed-pill">
          <span className="pill-speed">{speed !== null ? speed : "--"}</span>
          <span className="pill-unit">{unitLabel(unit)}</span>
        </div>
      </div>

      <div className="map-overlay bottom-left">
        <button
          className={`map-fab ${orientation === "north-up" ? "active" : ""}`}
          onClick={toggleOrientation}
          aria-label="Toggle map orientation"
        >
          <CompassGlyph size={22} />
        </button>
      </div>
    </>
  );
}
