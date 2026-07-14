import { music } from "../../lib/music";
import { prettyTitle } from "../../lib/track-name";
import { useMusicStore } from "../../stores/music-store";
import { useShellStore } from "../../stores/shell-store";
import { HudPanel, IconButton, AlbumArt } from "../../components";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "../music/transport-icons";

// Compact now-playing card. Body tap opens Now Playing; transport buttons don't.
export default function NowPlayingCard() {
  const state = useMusicStore((s) => s.state);
  const openApp = useShellStore((s) => s.openApp);
  const np = state?.nowPlaying ?? null;

  return (
    <HudPanel className="np-card" onClick={() => openApp("nowplaying")} ariaLabel="Open Now Playing">
      <AlbumArt artKey={np?.artKey} size={88} />
      <div className="np-card-meta">
        <span className="hud-label">Now Playing</span>
        {np ? (
          <>
            <span className="np-card-title truncate">{prettyTitle(np)}</span>
            <span className="np-card-artist muted truncate">{np.artist ?? "Unknown artist"}</span>
          </>
        ) : (
          <span className="muted">Nothing playing</span>
        )}
      </div>
      <div className="np-card-controls" onClick={(e) => e.stopPropagation()}>
        <IconButton aria-label="Previous" onClick={() => music.prev().catch(() => {})}>
          <PrevIcon />
        </IconButton>
        <IconButton
          aria-label={state?.isPlaying ? "Pause" : "Play"}
          onClick={() => (state?.isPlaying ? music.pause() : music.resume()).catch(() => {})}
        >
          {state?.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton aria-label="Next" onClick={() => music.next().catch(() => {})}>
          <NextIcon />
        </IconButton>
      </div>
    </HudPanel>
  );
}
