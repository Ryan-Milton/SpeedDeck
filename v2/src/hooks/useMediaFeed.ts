// Single subscription to media:state / media:library, funneled into the store.
// Mount once near the shell root (next to useVehicleFeed / useNavigation).

import { useEffect } from "react";
import { music, onMediaState, onMediaLibrary } from "../lib/music";
import { useMusicStore } from "../stores/music-store";

export function useMediaFeed(): void {
  const setState = useMusicStore((s) => s.setState);
  const setLibrary = useMusicStore((s) => s.setLibrary);

  useEffect(() => {
    // Prime current playback state (e.g. after navigating back to the app).
    music.state().then(setState).catch(() => {});

    let unState: (() => void) | undefined;
    let unLib: (() => void) | undefined;
    onMediaState(setState).then((fn) => (unState = fn)).catch(() => {});
    onMediaLibrary(setLibrary).then((fn) => (unLib = fn)).catch(() => {});
    return () => {
      unState?.();
      unLib?.();
    };
  }, [setState, setLibrary]);
}
