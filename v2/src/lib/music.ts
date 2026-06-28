// IPC bindings for local music (media module).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type RepeatMode = "off" | "all" | "one";

export interface TrackInfo {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  discNo: number | null;
  durationMs: number | null;
  genre: string | null;
  year: number | null;
  artKey: string | null;
}

export interface AlbumInfo {
  album: string;
  artist: string;
  artKey: string | null;
  trackCount: number;
  year: number | null;
}

export interface MediaState {
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  queueLen: number;
  index: number;
  nowPlaying: TrackInfo | null;
}

export interface LibraryProgress {
  step: string; // "scan" | "done"
  scanned: number;
  total: number;
}

export const music = {
  scan: () => invoke<number>("music_scan"),
  folders: () => invoke<string[]>("music_folders"),
  addFolder: () => invoke<string[]>("music_add_folder"),
  removeFolder: (path: string) => invoke<string[]>("music_remove_folder", { path }),
  albums: () => invoke<AlbumInfo[]>("music_albums"),
  artists: () => invoke<string[]>("music_artists"),
  tracks: () => invoke<TrackInfo[]>("music_tracks"),
  tracksByAlbum: (album: string, artist: string) =>
    invoke<TrackInfo[]>("music_tracks_by_album", { album, artist }),
  search: (query: string) => invoke<TrackInfo[]>("music_search", { query }),
  trackCount: () => invoke<number>("music_track_count"),
  playTrack: (trackId: number) => invoke<void>("music_play_track", { trackId }),
  playAlbum: (album: string, artist: string, start: number) =>
    invoke<void>("music_play_album", { album, artist, start }),
  pause: () => invoke<void>("music_pause"),
  resume: () => invoke<void>("music_resume"),
  next: () => invoke<void>("music_next"),
  prev: () => invoke<void>("music_prev"),
  seek: (ms: number) => invoke<void>("music_seek", { ms }),
  setVolume: (volume: number) => invoke<void>("music_set_volume", { volume }),
  setShuffle: (on: boolean) => invoke<void>("music_set_shuffle", { on }),
  setRepeat: (mode: RepeatMode) => invoke<void>("music_set_repeat", { mode }),
  state: () => invoke<MediaState>("music_state"),
};

/** URL for cached album art served by the `music-art://` protocol. */
export function albumArtUrl(key: string | null | undefined): string | null {
  return key ? `music-art://localhost/${key}` : null;
}

export function onMediaState(cb: (s: MediaState) => void): Promise<UnlistenFn> {
  return listen<MediaState>("media:state", (e) => cb(e.payload));
}

export function onMediaLibrary(cb: (p: LibraryProgress) => void): Promise<UnlistenFn> {
  return listen<LibraryProgress>("media:library", (e) => cb(e.payload));
}
