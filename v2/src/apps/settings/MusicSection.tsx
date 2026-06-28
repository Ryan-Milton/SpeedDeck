import { useEffect, useState } from "react";
import { music } from "../../lib/music";
import { useMusicStore } from "../../stores/music-store";

// Settings > Music: scan folders, library stats, rescan. Mirrors OfflineMapsSection.
export default function MusicSection() {
  const [folders, setFolders] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const library = useMusicStore((s) => s.library);
  const libraryVersion = useMusicStore((s) => s.libraryVersion);

  async function refresh() {
    try {
      setFolders(await music.folders());
      setCount(await music.trackCount());
    } catch {
      /* no backend (browser preview) */
    }
  }

  useEffect(() => {
    refresh();
  }, [libraryVersion]);

  async function addFolder() {
    try {
      setFolders(await music.addFolder());
    } catch {
      /* dialog cancelled / no backend */
    }
  }

  async function removeFolder(path: string) {
    setFolders(await music.removeFolder(path).catch(() => folders));
  }

  async function rescan() {
    setScanning(true);
    try {
      await music.scan();
    } catch {
      /* ignore */
    } finally {
      setScanning(false);
      refresh();
    }
  }

  const scanningNow = scanning || (library != null && library.step !== "done");

  return (
    <div className="offline-maps">
      <h3>Music</h3>
      <div className="settings-list">
        {folders.length === 0 && <div className="settings-row muted">No folders configured</div>}
        {folders.map((f) => (
          <div className="settings-row" key={f}>
            <span className="music-folder-path">{f}</span>
            <button className="badge" onClick={() => removeFolder(f)}>
              Remove
            </button>
          </div>
        ))}
        <div className="settings-row">
          <span>Tracks</span>
          <span className="muted">{count}</span>
        </div>
        {scanningNow && library && (
          <div className="settings-row">
            <span>Scanning…</span>
            <span className="muted">
              {library.scanned}
              {library.total ? ` / ${library.total}` : ""}
            </span>
          </div>
        )}
      </div>

      <div className="settings-actions">
        <button onClick={addFolder}>Add folder</button>
        <button onClick={rescan} disabled={scanningNow}>
          {scanningNow ? "Scanning…" : "Rescan"}
        </button>
      </div>
    </div>
  );
}
