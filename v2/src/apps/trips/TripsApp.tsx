import { useEffect, useState } from "react";
import { trips, type TripInfo } from "../../lib/trips";
import { trip } from "../../lib/ipc";
import { METERS_TO_MI } from "../../lib/units";
import { useVehicleStore } from "../../stores/vehicle-store";
import { HudPanel, Button, StatGroup, EmptyState, SettingsRow } from "../../components";
import { TripsIcon } from "../icons";
import "./trips.css";

// Record/pause/resume/stop control.
function RecordControl() {
  const status = useVehicleStore((s) => s.state?.tripStatus ?? "idle");
  return (
    <div className="trip-record">
      {status === "idle" ? (
        <Button variant="danger" onClick={() => trip.start().catch(() => {})}>
          <span className="rec-dot" /> Record
        </Button>
      ) : (
        <>
          {status === "recording" ? (
            <Button onClick={() => trip.pause().catch(() => {})}>Pause</Button>
          ) : (
            <Button onClick={() => trip.resume().catch(() => {})}>Resume</Button>
          )}
          <Button variant="danger" onClick={() => trip.stop().catch(() => {})}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

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
      <div className="trips-header">
        <h2>Trips</h2>
        <RecordControl />
      </div>
      {error && <p className="muted">{error}</p>}

      <div className="trips-body">
        {list.length === 0 ? (
          <EmptyState
            className="trip-list-empty"
            icon={<TripsIcon size={40} />}
            title="No trips yet"
            sub="Hit Record to log your first drive — distance, speed, and route."
          />
        ) : (
          <ul className="trip-list">
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
        )}

        <HudPanel className="trip-detail">
          {selected ? (
            <>
              <span className="hud-label">Trip</span>
              <h3>{selected.name ?? `Trip ${selected.id}`}</h3>
              <div className="trip-stats">
                <StatGroup label="Distance" value={(selected.distanceM * METERS_TO_MI).toFixed(1)} unit="mi" />
                <StatGroup label="Max speed" value={(selected.maxSpeed * 2.23694).toFixed(0)} unit="mph" />
                <StatGroup label="Duration" value={fmtDuration(selected.startedAt, selected.endedAt)} />
              </div>
              <div className="settings-list trip-meta-list">
                <SettingsRow label="Started" value={fmtDate(selected.startedAt)} />
                <SettingsRow label="Trackpoints" value={pointCount ?? "…"} />
              </div>
              <div className="trip-actions">
                <Button onClick={() => onExport(selected)}>Export GPX</Button>
                <Button onClick={() => onRename(selected)}>Rename</Button>
                <Button variant="danger" onClick={() => onDelete(selected)}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <EmptyState title="No trip selected" sub="Pick a trip on the left to see its stats." />
          )}
        </HudPanel>
      </div>
    </div>
  );
}
