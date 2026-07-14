import { useEffect, useMemo, useState } from "react";
import { music, type AlbumInfo, type TrackInfo } from "../../lib/music";
import { prettyTitle } from "../../lib/track-name";
import { formatDuration } from "../../lib/format";
import { useMusicStore } from "../../stores/music-store";
import { useShellStore } from "../../stores/shell-store";
import { toastError } from "../../stores/ui-store";
import { Tabs, EmptyState, Button, ListRow, AlbumArt } from "../../components";
import { MusicIcon } from "../icons";
import "./music.css";

type Tab = "albums" | "artists" | "songs";

const TABS: { id: Tab; label: string }[] = [
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "songs", label: "Songs" },
];

// Zero state for a browse tab. The copy must be honest: "no folder yet"
// (with a next step) is a different situation from "folder scanned, empty".
function LibraryEmpty({ hasFolders, noun }: { hasFolders: boolean; noun: string }) {
  const openApp = useShellStore((s) => s.openApp);
  if (!hasFolders) {
    return (
      <EmptyState
        icon={<MusicIcon size={40} />}
        title="No music yet"
        sub="Add a music folder in Settings to build your library."
        action={<Button onClick={() => openApp("settings")}>Open Settings</Button>}
      />
    );
  }
  return (
    <EmptyState
      icon={<MusicIcon size={40} />}
      title={`No ${noun} found`}
      sub="Your folders scanned clean but no playable tracks turned up. Try Rescan in Settings."
      action={<Button onClick={() => openApp("settings")}>Open Settings</Button>}
    />
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
  const [hasFolders, setHasFolders] = useState(true);
  const libraryVersion = useMusicStore((s) => s.libraryVersion);

  useEffect(() => {
    Promise.all([music.albums(), music.artists(), music.tracks(), music.folders()])
      .then(([a, ar, t, f]) => {
        setAlbums(a);
        setArtists(ar);
        setSongs(t);
        setHasFolders(f.length > 0);
      })
      .catch(() => toastError("Couldn't load the music library."));
  }, [libraryVersion]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const id = setTimeout(() => {
      music.search(q).then(setResults).catch(() => toastError("Search failed."));
    }, 200);
    return () => clearTimeout(id);
  }, [query]);

  const shownAlbums = useMemo(
    () => (artistFilter ? albums.filter((a) => a.artist === artistFilter) : albums),
    [albums, artistFilter]
  );

  async function openAlbumDetail(a: AlbumInfo) {
    setOpenAlbum(a);
    setAlbumTracks(
      await music.tracksByAlbum(a.album, a.artist).catch(() => {
        toastError("Couldn't load album tracks.");
        return [];
      })
    );
  }

  const play = (p: Promise<unknown>) => p.catch(() => toastError("Playback failed."));

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
        <div className="track-list">
          {albumTracks.map((t, i) => (
            <ListRow
              key={t.id}
              className="track-row"
              onClick={() => play(music.playAlbum(openAlbum.album, openAlbum.artist, i))}
            >
              <span className="track-no">{t.trackNo ?? i + 1}</span>
              <span className="track-title truncate">{prettyTitle(t)}</span>
              <span className="track-dur">{formatDuration(t.durationMs)}</span>
            </ListRow>
          ))}
        </div>
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
          <div className="track-list">
            {results.map((t) => (
              <ListRow key={t.id} className="track-row" onClick={() => play(music.playTrack(t.id))}>
                <span className="track-title truncate">{prettyTitle(t)}</span>
                <span className="track-sub muted">{t.artist ?? ""}</span>
              </ListRow>
            ))}
          </div>
        )
      ) : tab === "albums" ? (
        shownAlbums.length === 0 ? (
          artistFilter ? (
            <EmptyState
              icon={<MusicIcon size={40} />}
              title="No albums found"
              sub={`Nothing in the library by ${artistFilter}.`}
              action={
                <Button onClick={() => setArtistFilter(null)}>Show all albums</Button>
              }
            />
          ) : (
            <LibraryEmpty hasFolders={hasFolders} noun="albums" />
          )
        ) : (
          <div className="album-grid">
            {shownAlbums.map((a) => (
              <button
                key={`${a.album}|${a.artist}`}
                className="album-tile"
                onClick={() => openAlbumDetail(a)}
              >
                <AlbumArt artKey={a.artKey} size={150} />
                <span className="album-name truncate">{a.album}</span>
                <span className="album-artist muted truncate">{a.artist}</span>
              </button>
            ))}
          </div>
        )
      ) : tab === "artists" ? (
        artists.length === 0 ? (
          <LibraryEmpty hasFolders={hasFolders} noun="artists" />
        ) : (
        <div className="track-list">
          {artists.map((a) => (
            <ListRow
              key={a}
              className="track-row"
              onClick={() => {
                setArtistFilter(a);
                setTab("albums");
              }}
            >
              <span className="track-title truncate">{a}</span>
            </ListRow>
          ))}
        </div>
        )
      ) : songs.length === 0 ? (
        <LibraryEmpty hasFolders={hasFolders} noun="songs" />
      ) : (
        <div className="track-list">
          {songs.map((t) => (
            <ListRow key={t.id} className="track-row" onClick={() => play(music.playTrack(t.id))}>
              <span className="track-title truncate">{prettyTitle(t)}</span>
              <span className="track-sub muted truncate">
                {t.artist ?? ""} {t.album ? `· ${t.album}` : ""}
              </span>
              <span className="track-dur">{formatDuration(t.durationMs)}</span>
            </ListRow>
          ))}
        </div>
      )}
    </div>
  );
}
