import { music, albumArtUrl, type RepeatMode } from "../../lib/music";
import { useMusicStore } from "../../stores/music-store";
import "./music.css";

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = { off: "Repeat", all: "Repeat All", one: "Repeat One" };

// Phase 7: full-screen Now Playing — art, transport, scrubber, shuffle/repeat/volume.
export default function NowPlayingApp() {
  const state = useMusicStore((s) => s.state);
  const np = state?.nowPlaying ?? null;

  if (!state || !np) {
    return (
      <div className="app-screen now-playing empty">
        <p className="muted">Nothing playing — pick a track in Music.</p>
      </div>
    );
  }

  const art = albumArtUrl(np.artKey);
  const pos = state.positionMs;
  const dur = state.durationMs || np.durationMs || 0;

  return (
    <div className="app-screen now-playing">
      <div className="np-art">
        {art ? <img src={art} alt="" /> : <span className="album-art-fallback big">♪</span>}
      </div>

      <div className="np-meta">
        <h2 className="np-title">{np.title ?? np.path}</h2>
        <p className="np-artist">{np.artist ?? "Unknown artist"}</p>
        <p className="np-album muted">{np.album ?? ""}</p>
      </div>

      <div className="np-scrubber">
        <span className="np-time">{fmt(pos)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(dur, 1)}
          value={Math.min(pos, dur || pos)}
          onChange={(e) => music.seek(Number(e.target.value)).catch(() => {})}
        />
        <span className="np-time">{dur ? fmt(dur) : "--:--"}</span>
      </div>

      <div className="np-transport">
        <button
          className={`np-toggle ${state.shuffle ? "on" : ""}`}
          onClick={() => music.setShuffle(!state.shuffle).catch(() => {})}
        >
          Shuffle
        </button>
        <button className="np-skip" onClick={() => music.prev().catch(() => {})}>
          ⏮
        </button>
        <button
          className="np-play"
          onClick={() => (state.isPlaying ? music.pause() : music.resume()).catch(() => {})}
        >
          {state.isPlaying ? "⏸" : "▶"}
        </button>
        <button className="np-skip" onClick={() => music.next().catch(() => {})}>
          ⏭
        </button>
        <button
          className={`np-toggle ${state.repeat !== "off" ? "on" : ""}`}
          onClick={() => music.setRepeat(NEXT_REPEAT[state.repeat]).catch(() => {})}
        >
          {REPEAT_LABEL[state.repeat]}
        </button>
      </div>

      <div className="np-volume">
        <span className="muted">Vol</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={state.volume}
          onChange={(e) => music.setVolume(Number(e.target.value)).catch(() => {})}
        />
      </div>
    </div>
  );
}
