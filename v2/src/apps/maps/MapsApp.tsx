import LiveMap from "./LiveMap";
import MapOverlays from "./MapOverlays";
import SearchOverlay from "./nav/SearchOverlay";
import RoutePreview from "./nav/RoutePreview";
import TurnBanner from "./nav/TurnBanner";
import NavStatusBar from "./nav/NavStatusBar";
import { useNavigationStore } from "../../stores/navigation-store";
import "./maps.css";
import "./nav/nav.css";

// Phase 4 + 6: the CarPlay Maps surface — full-bleed live map with glanceable
// overlays, destination search, route preview, and turn-by-turn guidance.
export default function MapsApp() {
  const status = useNavigationStore((s) => s.status);
  const isOffRoute = useNavigationStore((s) => s.isOffRoute);
  const setSearchOpen = useNavigationStore((s) => s.setSearchOpen);

  return (
    <div className="maps-app">
      <LiveMap />
      <MapOverlays />

      {status === "idle" && (
        <button className="search-fab" onClick={() => setSearchOpen(true)}>
          Where to?
        </button>
      )}

      {status === "navigating" && isOffRoute && (
        <div className="reroute-chip" role="status">
          Rerouting…
        </div>
      )}
      <TurnBanner />
      <RoutePreview />
      <NavStatusBar />
      <SearchOverlay />
    </div>
  );
}
