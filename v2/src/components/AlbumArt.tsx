import { albumArtUrl } from "../lib/music";

/** Album art with the shared ♪ fallback — one implementation, any size. */
export function AlbumArt({ artKey, size }: { artKey: string | null | undefined; size: number }) {
  const url = albumArtUrl(artKey);
  return (
    <div className="album-art" style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" /> : <span className="album-art-fallback">♪</span>}
    </div>
  );
}
