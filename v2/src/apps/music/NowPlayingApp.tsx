import { music, albumArtUrl, type RepeatMode } from "../../lib/music";
import { prettyTitle } from "../../lib/track-name";
import { formatDuration } from "../../lib/format";
import { useMusicStore } from "../../stores/music-store";
import { HudFrame, IconButton, Slider, EmptyState } from "../../components";
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeIcon,
} from "./transport-icons";
import { MusicIcon } from "../icons";
import "./music.css";

const NEXT_REPEAT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat",
  all: "Repeat all",
  one: "Repeat one",
};

// Full-screen Now Playing — framed art, HUD transport, scrubber, volume.
export default function NowPlayingApp() {
  const state = useMusicStore((s) => s.state);
  const np = state?.nowPlaying ?? null;

  if (!state || !np) {
    return (
      <div className="app-screen now-playing empty">
        <EmptyState
          icon={<MusicIcon size={40} />}
          title="Nothing playing"
          sub="Pick a track in Music to start the soundtrack."
        />
      </div>
    );
  }

  const art = albumArtUrl(np.artKey);
  const pos = state.positionMs;
  const dur = state.durationMs || np.durationMs || 0;

  return (
    <div className="app-screen now-playing">
      <HudFrame active className="np-art">
        {art ? <img src={art} alt="" /> : <span className="album-art-fallback big">♪</span>}
      </HudFrame>

      <div className="np-meta">
        <span className="hud-label">Now Playing</span>
        <h2 className="np-title">{prettyTitle(np)}</h2>
        <p className="np-artist">{np.artist ?? "Unknown artist"}</p>
        {np.album && <p className="np-album muted">{np.album}</p>}
      </div>

      <div className="np-scrubber">
        <span className="np-time">{formatDuration(pos)}</span>
        <Slider
          ariaLabel="Seek"
          value={Math.min(pos, dur || pos)}
          min={0}
          max={Math.max(dur, 1)}
          onChange={(v) => music.seek(v).catch(() => {})}
        />
        <span className="np-time">{dur ? formatDuration(dur) : "--:--"}</span>
      </div>

      <div className="np-transport">
        <IconButton
          on={state.shuffle}
          aria-label="Shuffle"
          onClick={() => music.setShuffle(!state.shuffle).catch(() => {})}
        >
          <ShuffleIcon />
        </IconButton>
        <IconButton aria-label="Previous" onClick={() => music.prev().catch(() => {})}>
          <PrevIcon />
        </IconButton>
        <IconButton
          size="lg"
          aria-label={state.isPlaying ? "Pause" : "Play"}
          onClick={() => (state.isPlaying ? music.pause() : music.resume()).catch(() => {})}
        >
          {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton aria-label="Next" onClick={() => music.next().catch(() => {})}>
          <NextIcon />
        </IconButton>
        <IconButton
          on={state.repeat !== "off"}
          aria-label={REPEAT_LABEL[state.repeat]}
          onClick={() => music.setRepeat(NEXT_REPEAT[state.repeat]).catch(() => {})}
        >
          {state.repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
        </IconButton>
      </div>

      <div className="np-volume">
        <span className="np-vol-icon" aria-hidden>
          <VolumeIcon />
        </span>
        <Slider
          ariaLabel="Volume"
          value={state.volume}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => music.setVolume(v).catch(() => {})}
        />
      </div>
    </div>
  );
}
