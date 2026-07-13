import { music, albumArtUrl } from "../../lib/music";
import { prettyTitle } from "../../lib/track-name";
import { useMusicStore } from "../../stores/music-store";
import { useShellStore } from "../../stores/shell-store";
import { HudPanel } from "../../components";
import { PlayIcon, PauseIcon, PrevIcon, NextIcon } from "../music/transport-icons";

// Compact now-playing card. Body tap opens Now Playing; transport buttons don't.
export default function NowPlayingCard() {
  const state = useMusicStore((s) => s.state);
  const openApp = useShellStore((s) => s.openApp);
  const np = state?.nowPlaying ?? null;
  const art = albumArtUrl(np?.artKey);

  return (
    <HudPanel className="np-card" onClick={() => openApp("nowplaying")}>
      <div className="np-card-art">
        {art ? <img src={art} alt="" /> : <span className="np-card-fallback">♪</span>}
      </div>
      <div className="np-card-meta">
        <span className="hud-label">Now Playing</span>
        {np ? (
          <>
            <span className="np-card-title">{prettyTitle(np)}</span>
            <span className="np-card-artist muted">{np.artist ?? "Unknown artist"}</span>
          </>
        ) : (
          <span className="muted">Nothing playing</span>
        )}
      </div>
      <div className="np-card-controls" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => music.prev().catch(() => {})} aria-label="Previous">
          <PrevIcon />
        </button>
        <button
          onClick={() => (state?.isPlaying ? music.pause() : music.resume()).catch(() => {})}
          aria-label={state?.isPlaying ? "Pause" : "Play"}
        >
          {state?.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button onClick={() => music.next().catch(() => {})} aria-label="Next">
          <NextIcon />
        </button>
      </div>
    </HudPanel>
  );
}
