import { useEffect, useState } from "react";
import { music } from "../../lib/music";
import { useMusicStore } from "../../stores/music-store";
import { HudPanel, SectionHeader, SettingsRow, ListRow, Button } from "../../components";

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
    <>
      <SectionHeader title="Music" />
      <HudPanel brackets={false} className="settings-panel">
        <div className="settings-list">
          {folders.length === 0 && (
            <ListRow>
              <span className="muted">No folders yet — add one below</span>
            </ListRow>
          )}
          {folders.map((f) => (
            <ListRow
              key={f}
              label={<span className="music-folder-path">{f}</span>}
              value={
                <Button size="sm" variant="ghost" onClick={() => removeFolder(f)}>
                  Remove
                </Button>
              }
            />
          ))}
          <SettingsRow label="Tracks" value={count} />
          {scanningNow && library && (
            <SettingsRow
              label="Scanning…"
              value={`${library.scanned}${library.total ? ` / ${library.total}` : ""}`}
            />
          )}
        </div>

        <div className="settings-actions">
          <Button onClick={addFolder}>Add folder</Button>
          <Button onClick={rescan} disabled={scanningNow}>
            {scanningNow ? "Scanning…" : "Rescan"}
          </Button>
        </div>
      </HudPanel>
    </>
  );
}
