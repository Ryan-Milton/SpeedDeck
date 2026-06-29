import MapPane from "./MapPane";
import NowPlayingCard from "./NowPlayingCard";
import GlanceCard from "./GlanceCard";
import "./dashboard.css";

// Phase 8: CarPlay-style Dashboard split view — live map on the left, a right
// column with Now Playing + a glance card (next-turn while navigating, else
// speed). Tapping a pane opens the corresponding app.
export default function DashboardApp() {
  return (
    <div className="app-screen dash-split">
      <MapPane />
      <aside className="dash-aside">
        <NowPlayingCard />
        <GlanceCard />
      </aside>
    </div>
  );
}
