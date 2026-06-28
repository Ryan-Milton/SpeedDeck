import { useEffect, useState } from "react";
import {
  tiles,
  onDownloadProgress,
  type RegionInfo,
  type DownloadProgress,
} from "../../lib/tiles";

function fmtBytes(n: number): string {
  if (n <= 0) return "0 MB";
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Settings > Offline Maps: list bundled regions, show cache usage, clear cache,
// and surface in-app tile-download progress. Calls are guarded so the UI also
// renders in a plain browser (no Tauri backend) for development.
export default function OfflineMapsSection() {
  const [regions, setRegions] = useState<RegionInfo[]>([]);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  async function refresh() {
    try {
      setRegions(await tiles.listRegions());
      setCacheBytes(await tiles.cacheSize());
    } catch {
      /* no backend (browser preview) */
    }
  }

  useEffect(() => {
    refresh();
    let unlisten: (() => void) | undefined;
    onDownloadProgress((p) => {
      setProgress(p.active ? p : null);
      if (!p.active) refresh();
    })
      .then((fn) => (unlisten = fn))
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  async function clearCache() {
    try {
      await tiles.deleteCache();
      refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="offline-maps">
      <h3>Offline Maps</h3>

      <div className="settings-list">
        {regions.length === 0 && <div className="settings-row muted">No regions reported</div>}
        {regions.map((r) => (
          <div className="settings-row" key={r.id}>
            <span>{r.name}</span>
            <span className={r.installed ? "badge ok" : "badge"}>
              {r.installed ? "Installed" : "Not installed"}
            </span>
          </div>
        ))}
        <div className="settings-row">
          <span>Tile cache</span>
          <span className="muted">{fmtBytes(cacheBytes)}</span>
        </div>
      </div>

      {progress && (
        <div className="dl-progress">
          <div className="dl-bar">
            <div className="dl-fill" style={{ width: `${progress.percent}%` }} />
          </div>
          <span className="muted">
            Downloading tiles… {progress.downloaded}/{progress.total} ({progress.percent}%)
          </span>
          <button onClick={() => tiles.cancel().catch(() => {})}>Cancel</button>
        </div>
      )}

      <div className="settings-actions">
        <button onClick={clearCache}>Clear tile cache</button>
      </div>
    </div>
  );
}
