import { useEffect, useState } from "react";
import { trips, type TripInfo } from "../../lib/trips";
import { METERS_TO_MI } from "../../lib/units";
import "./trips.css";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function miles(m: number): string {
  return `${(m * METERS_TO_MI).toFixed(1)} mi`;
}

// Phase 5 Trips surface: recorded-trip history with detail + GPX export.
// A trip map/elevation preview can be added later (reuse the maps layers).
export default function TripsApp() {
  const [list, setList] = useState<TripInfo[]>([]);
  const [selected, setSelected] = useState<TripInfo | null>(null);
  const [pointCount, setPointCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const ts = await trips.list();
      setList(ts);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function select(t: TripInfo) {
    setSelected(t);
    setPointCount(null);
    try {
      const pts = await trips.trackpoints(t.id);
      setPointCount(pts.length);
    } catch {
      setPointCount(null);
    }
  }

  async function onDelete(t: TripInfo) {
    await trips.remove(t.id).catch(() => {});
    if (selected?.id === t.id) setSelected(null);
    refresh();
  }

  async function onRename(t: TripInfo) {
    const name = window.prompt("Trip name", t.name ?? "");
    if (name == null) return;
    await trips.rename(t.id, name).catch(() => {});
    refresh();
    if (selected?.id === t.id) setSelected({ ...t, name });
  }

  async function onExport(t: TripInfo) {
    try {
      const xml = await trips.exportGpx(t.id);
      const blob = new Blob([xml], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(t.name ?? `trip-${t.id}`).replace(/\s+/g, "_")}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app-screen trips">
      <h2>Trips</h2>
      {error && <p className="muted">{error}</p>}

      <div className="trips-body">
        <ul className="trip-list">
          {list.length === 0 && <li className="muted trip-empty">No recorded trips yet</li>}
          {list.map((t) => (
            <li
              key={t.id}
              className={`trip-item ${selected?.id === t.id ? "active" : ""}`}
              onClick={() => select(t)}
            >
              <span className="trip-name">{t.name ?? `Trip ${t.id}`}</span>
              <span className="trip-meta">
                {fmtDate(t.startedAt)} · {miles(t.distanceM)}
              </span>
            </li>
          ))}
        </ul>

        <div className="trip-detail">
          {selected ? (
            <>
              <h3>{selected.name ?? `Trip ${selected.id}`}</h3>
              <div className="settings-list">
                <div className="settings-row">
                  <span>Started</span>
                  <span className="muted">{fmtDate(selected.startedAt)}</span>
                </div>
                <div className="settings-row">
                  <span>Duration</span>
                  <span className="muted">{fmtDuration(selected.startedAt, selected.endedAt)}</span>
                </div>
                <div className="settings-row">
                  <span>Distance</span>
                  <span className="muted">{miles(selected.distanceM)}</span>
                </div>
                <div className="settings-row">
                  <span>Max speed</span>
                  <span className="muted">{(selected.maxSpeed * 2.23694).toFixed(0)} mph</span>
                </div>
                <div className="settings-row">
                  <span>Trackpoints</span>
                  <span className="muted">{pointCount ?? "…"}</span>
                </div>
              </div>
              <div className="trip-actions">
                <button onClick={() => onExport(selected)}>Export GPX</button>
                <button onClick={() => onRename(selected)}>Rename</button>
                <button className="danger" onClick={() => onDelete(selected)}>
                  Delete
                </button>
              </div>
            </>
          ) : (
            <p className="muted">Select a trip to see details.</p>
          )}
        </div>
      </div>
    </div>
  );
}
