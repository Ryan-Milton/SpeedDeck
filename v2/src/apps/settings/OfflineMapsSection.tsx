import { useEffect, useState } from "react";
import {
  tiles,
  onDownloadProgress,
  type RegionInfo,
  type DownloadProgress,
} from "../../lib/tiles";
import { HudPanel, SectionHeader, SettingsRow, ListRow, Badge, Button } from "../../components";

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
    <>
      <SectionHeader title="Offline Maps" />
      <HudPanel brackets={false} className="settings-panel">
        <div className="settings-list">
          {regions.length === 0 && (
            <ListRow>
              <span className="muted">No regions yet</span>
            </ListRow>
          )}
          {regions.map((r) => (
            <ListRow
              key={r.id}
              label={r.name}
              value={
                <Badge variant={r.installed ? "ok" : undefined}>
                  {r.installed ? "Installed" : "Not installed"}
                </Badge>
              }
            />
          ))}
          <SettingsRow label="Tile cache" value={fmtBytes(cacheBytes)} />
        </div>

        {progress && (
          <div className="dl-progress">
            <div className="dl-bar">
              <div className="dl-fill" style={{ width: `${progress.percent}%` }} />
            </div>
            <span className="muted">
              Downloading tiles… {progress.downloaded}/{progress.total} ({progress.percent}%)
            </span>
            <Button size="sm" onClick={() => tiles.cancel().catch(() => {})}>
              Cancel
            </Button>
          </div>
        )}

        <div className="settings-actions">
          <Button onClick={clearCache}>Clear tile cache</Button>
        </div>
      </HudPanel>
    </>
  );
}
