import { music, albumArtUrl } from "../../lib/music";
import { useMusicStore } from "../../stores/music-store";
import { useShellStore } from "../../stores/shell-store";

// Compact now-playing card. Body tap opens Now Playing; transport buttons don't.
export default function NowPlayingCard() {
  const state = useMusicStore((s) => s.state);
  const openApp = useShellStore((s) => s.openApp);
  const np = state?.nowPlaying ?? null;
  const art = albumArtUrl(np?.artKey);

  return (
    <div className="dash-card np-card" role="button" onClick={() => openApp("nowplaying")}>
      <div className="np-card-art">
        {art ? <img src={art} alt="" /> : <span className="np-card-fallback">♪</span>}
      </div>
      <div className="np-card-meta">
        {np ? (
          <>
            <span className="np-card-title">{np.title ?? np.path}</span>
            <span className="np-card-artist muted">{np.artist ?? "Unknown artist"}</span>
          </>
        ) : (
          <span className="muted">Nothing playing</span>
        )}
      </div>
      <div className="np-card-controls" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => music.prev().catch(() => {})} aria-label="Previous">
          ⏮
        </button>
        <button
          onClick={() => (state?.isPlaying ? music.pause() : music.resume()).catch(() => {})}
          aria-label="Play/Pause"
        >
          {state?.isPlaying ? "⏸" : "▶"}
        </button>
        <button onClick={() => music.next().catch(() => {})} aria-label="Next">
          ⏭
        </button>
      </div>
    </div>
  );
}
