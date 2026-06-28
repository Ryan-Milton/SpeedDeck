import LiveMap from "./LiveMap";
import MapOverlays from "./MapOverlays";
import "./maps.css";

// Phase 4: the CarPlay Maps surface — a full-bleed live moving map with
// glanceable speed/heading overlays. Turn-by-turn navigation lands in Phase 6.
export default function MapsApp() {
  return (
    <div className="maps-app">
      <LiveMap />
      <MapOverlays />
    </div>
  );
}
