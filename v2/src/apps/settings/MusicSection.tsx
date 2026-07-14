import { useEffect, useState } from "react";
import { music } from "../../lib/music";
import { useMusicStore } from "../../stores/music-store";
import { toastError } from "../../stores/ui-store";
import {
  HudPanel,
  SectionHeader,
  SettingsRow,
  ListRow,
  Button,
  ConfirmDialog,
} from "../../components";

// Settings > Music: scan folders, library stats, rescan. Mirrors OfflineMapsSection.
export default function MusicSection() {
  const [folders, setFolders] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
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
    setConfirmRemove(null);
    setFolders(
      await music.removeFolder(path).catch(() => {
        toastError("Couldn't remove the folder.");
        return folders;
      })
    );
  }

  async function rescan() {
    setScanning(true);
    try {
      await music.scan();
    } catch {
      toastError("Library scan failed.");
    } finally {
      setScanning(false);
      refresh();
    }
  }

  const scanningNow = scanning || (library != null && library.step !== "done");
  const scanPct =
    library && library.total ? Math.round((library.scanned / library.total) * 100) : null;

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
                <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(f)}>
                  Remove
                </Button>
              }
            />
          ))}
          <SettingsRow label="Tracks" value={count} />
        </div>

        {scanningNow && library && (
          <div className="dl-progress">
            <div className="dl-bar">
              <div
                className={`dl-fill${scanPct == null ? " indeterminate" : ""}`}
                style={scanPct != null ? { width: `${scanPct}%` } : undefined}
              />
            </div>
            <span className="muted">
              Scanning… {library.scanned}
              {library.total ? ` / ${library.total}` : ""}
            </span>
          </div>
        )}

        <div className="settings-actions">
          <Button onClick={addFolder}>Add folder</Button>
          <Button onClick={rescan} loading={scanningNow}>
            {scanningNow ? "Scanning…" : "Rescan"}
          </Button>
        </div>
      </HudPanel>

      {confirmRemove && (
        <ConfirmDialog
          title="Remove music folder?"
          body={`${confirmRemove} is removed from the library. The files on disk are untouched.`}
          confirmLabel="Remove"
          danger
          onConfirm={() => removeFolder(confirmRemove)}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </>
  );
}
