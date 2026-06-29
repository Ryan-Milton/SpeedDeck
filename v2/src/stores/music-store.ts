// Live playback state pushed from the Rust media controller on `media:state`,
// plus the latest library scan progress.

import { create } from "zustand";
import type { MediaState, LibraryProgress } from "../lib/music";

interface MusicStore {
  state: MediaState | null;
  library: LibraryProgress | null;
  /** Bumped whenever a scan completes, so views can refetch the library. */
  libraryVersion: number;
  setState: (state: MediaState) => void;
  setLibrary: (p: LibraryProgress) => void;
}

export const useMusicStore = create<MusicStore>((set, get) => ({
  state: null,
  library: null,
  libraryVersion: 0,
  setState: (state) => set({ state }),
  setLibrary: (library) =>
    set({
      library,
      libraryVersion: library.step === "done" ? get().libraryVersion + 1 : get().libraryVersion,
    }),
}));
