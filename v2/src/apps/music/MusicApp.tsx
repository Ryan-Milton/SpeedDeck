import { useEffect, useMemo, useState } from "react";
import {
  music,
  albumArtUrl,
  type AlbumInfo,
  type TrackInfo,
} from "../../lib/music";
import { prettyTitle } from "../../lib/track-name";
import { useMusicStore } from "../../stores/music-store";
import { Tabs, EmptyState, Button } from "../../components";
import { MusicIcon } from "../icons";
import "./music.css";

type Tab = "albums" | "artists" | "songs";

const TABS: { id: Tab; label: string }[] = [
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
];

function fmtDur(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function AlbumArt({ artKey, size }: { artKey: string | null; size: number }) {
  const url = albumArtUrl(artKey);
  return (
    <div className="album-art" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <span className="album-art-fallback">♪</span>}
    </div>
  );
}

// Music browse — Albums / Artists / Songs + search.
export default function MusicApp() {
  const [tab, setTab] = useState<Tab>("albums");
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<AlbumInfo[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [songs, setSongs] = useState<TrackInfo[]>([]);
  const [results, setResults] = useState<TrackInfo[]>([]);
  const [openAlbum, setOpenAlbum] = useState<AlbumInfo | null>(null);
  const [albumTracks, setAlbumTracks] = useState<TrackInfo[]>([]);
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const libraryVersion = useMusicStore((s) => s.libraryVersion);

  useEffect(() => {
    music.albums().then(setAlbums).catch(() => {});
    music.artists().then(setArtists).catch(() => {});
    music.tracks().then(setSongs).catch(() => {});
  }, [libraryVersion]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      music.search(q).then(setResults).catch(() => {});
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  const shownAlbums = useMemo(
    () => (artistFilter ? albums.filter((a) => a.artist === artistFilter) : albums),
    [albums, artistFilter]
  );

  async function openAlbumDetail(a: AlbumInfo) {
    setOpenAlbum(a);
    setAlbumTracks(await music.tracksByAlbum(a.album, a.artist).catch(() => []));
  }

  if (openAlbum) {
    return (
      <div className="app-screen music-app">
        <Button variant="ghost" className="music-back" onClick={() => setOpenAlbum(null)}>
          ‹ Back
        </Button>
        <div className="album-detail-head">
          <AlbumArt artKey={openAlbum.artKey} size={120} />
          <div>
            <span className="hud-label">Album</span>
            <h2>{openAlbum.album}</h2>
            <p className="muted">{openAlbum.artist}</p>
          </div>
        </div>
        <ul className="track-list">
          {albumTracks.map((t, i) => (
            <li
              key={t.id}
              className="track-row"
              onClick={() => music.playAlbum(openAlbum.album, openAlbum.artist, i).catch(() => {})}
            >
              <span className="track-no">{t.trackNo ?? i + 1}</span>
              <span className="track-title">{prettyTitle(t)}</span>
              <span className="track-dur">{fmtDur(t.durationMs)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const searching = query.trim().length >= 2;

  return (
    <div className="app-screen music-app">
      <div className="music-head">
        <Tabs
          tabs={TABS}
          value={tab}
          onChange={(t) => {
            setTab(t);
            setQuery("");
            setArtistFilter(null);
          }}
        />
        <input
          className="music-search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {searching ? (
        results.length === 0 ? (
          <EmptyState title="No matches" sub={`Nothing found for “${query.trim()}”.`} />
        ) : (
          <ul className="track-list">
            {results.map((t) => (
              <li key={t.id} className="track-row" onClick={() => music.playTrack(t.id).catch(() => {})}>
                <span className="track-title">{prettyTitle(t)}</span>
                <span className="track-sub muted">{t.artist ?? ""}</span>
              </li>
            ))}
          </ul>
        )
      ) : tab === "albums" ? (
        shownAlbums.length === 0 ? (
          <EmptyState
            icon={<MusicIcon size={40} />}
            title="No music yet"
            sub="Add a music folder in Settings to build your library."
          />
        ) : (
          <div className="album-grid">
            {shownAlbums.map((a) => (
              <button
                key={`${a.album}|${a.artist}`}
                className="album-tile"
                onClick={() => openAlbumDetail(a)}
              >
                <AlbumArt artKey={a.artKey} size={150} />
                <span className="album-name">{a.album}</span>
                <span className="album-artist muted">{a.artist}</span>
              </button>
            ))}
          </div>
        )
      ) : tab === "artists" ? (
        <ul className="track-list">
          {artists.map((a) => (
            <li
              key={a}
              className="track-row"
              onClick={() => {
                setArtistFilter(a);
                setTab("albums");
              }}
            >
              <span className="track-title">{a}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="track-list">
          {songs.map((t) => (
            <li key={t.id} className="track-row" onClick={() => music.playTrack(t.id).catch(() => {})}>
              <span className="track-title">{prettyTitle(t)}</span>
              <span className="track-sub muted">
                {t.artist ?? ""} {t.album ? `· ${t.album}` : ""}
              </span>
              <span className="track-dur">{fmtDur(t.durationMs)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
