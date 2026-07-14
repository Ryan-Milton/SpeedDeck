import { useEffect, useState } from "react";
import { trips, type TripInfo, type Trackpoint } from "../../lib/trips";
import { trip } from "../../lib/ipc";
import {
  speedConvert,
  distanceConvert,
  speedUnitLabel,
  type SpeedUnit,
} from "../../lib/units";
import { useVehicleStore } from "../../stores/vehicle-store";
import { useSettingsStore } from "../../stores/settings-store";
import { toastError } from "../../stores/ui-store";
import {
  HudPanel,
  Button,
  StatGroup,
  EmptyState,
  SettingsRow,
  ListRow,
  AppHeader,
  ConfirmDialog,
  PromptDialog,
} from "../../components";
import { TripsIcon } from "../icons";
import "./trips.css";

// Record/pause/resume/stop control.
function RecordControl() {
  const status = useVehicleStore((s) => s.tripStatus);
  const act = (p: Promise<unknown>) => p.catch(() => toastError("Trip recorder didn't respond."));
  return (
    <div className="trip-record">
      {status === "idle" ? (
        <Button variant="danger" onClick={() => act(trip.start())}>
          <span className="rec-dot" /> Record
        </Button>
      ) : (
        <>
          {status === "recording" ? (
            <Button onClick={() => act(trip.pause())}>Pause</Button>
          ) : (
            <Button onClick={() => act(trip.resume())}>Resume</Button>
          )}
          <Button variant="danger" onClick={() => act(trip.stop())}>
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

function fmtElapsed(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!isFinite(ms) || ms < 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtDistance(meters: number, unit: SpeedUnit): string {
  const suffix = unit === "kmh" ? "km" : "mi";
  return `${distanceConvert(meters, unit).toFixed(1)} ${suffix}`;
}

const tripName = (t: TripInfo) => t.name ?? `Trip ${t.id}`;

// Route silhouette from the recorded trackpoints. A plain SVG polyline keeps
// the detail pane light — no second MapLibre instance per kept-alive screen.
function RouteSilhouette({ points }: { points: Trackpoint[] }) {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  // Equirectangular with latitude correction so the shape isn't stretched.
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const w = Math.max((maxLon - minLon) * lonScale, 1e-6);
  const h = Math.max(maxLat - minLat, 1e-6);
  const VIEW = 100;
  const PAD = 8;
  const scale = (VIEW - 2 * PAD) / Math.max(w, h);
  const ox = PAD + ((VIEW - 2 * PAD) - w * scale) / 2;
  const oy = PAD + ((VIEW - 2 * PAD) - h * scale) / 2;
  const pts = points
    .map((p) => {
      const x = ox + (p.longitude - minLon) * lonScale * scale;
      const y = oy + (maxLat - p.latitude) * scale;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const coords = pts.split(" ");
  const [sx, sy] = coords[0].split(",").map(Number);
  const last = coords[coords.length - 1].split(",").map(Number);
  return (
    <svg className="trip-route" viewBox={`0 0 ${VIEW} ${VIEW}`} role="img" aria-label="Trip route">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={sx} cy={sy} r="2.4" fill="var(--ok)" />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill="var(--alert)" />
    </svg>
  );
}

// Recorded-trip history with detail + GPX export.
// A trip map/elevation preview can be added later (reuse the maps layers).
export default function TripsApp() {
  const [list, setList] = useState<TripInfo[]>([]);
  const [selected, setSelected] = useState<TripInfo | null>(null);
  const [points, setPoints] = useState<Trackpoint[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<TripInfo | null>(null);
  const [renaming, setRenaming] = useState<TripInfo | null>(null);
  const unit = useSettingsStore((s) => s.speedUnit);

  async function refresh() {
    try {
      setList(await trips.list());
    } catch {
      toastError("Couldn't load your trips.");
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function select(t: TripInfo) {
    setSelected(t);
    setPoints(null);
    try {
      setPoints(await trips.trackpoints(t.id));
    } catch {
      setPoints(null);
    }
  }

  async function doDelete(t: TripInfo) {
    setConfirmDelete(null);
    await trips.remove(t.id).catch(() => toastError("Couldn't delete the trip."));
    if (selected?.id === t.id) setSelected(null);
    refresh();
  }

  async function doRename(t: TripInfo, name: string) {
    setRenaming(null);
    await trips.rename(t.id, name).catch(() => toastError("Couldn't rename the trip."));
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
      a.download = `${tripName(t).replace(/\s+/g, "_")}.gpx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toastError("GPX export failed.");
    }
  }

  return (
    <div className="app-screen trips">
      <AppHeader title="Trips" trailing={<RecordControl />} />

      <div className="trips-body">
        {list.length === 0 ? (
          <EmptyState
            className="trip-list-empty"
            icon={<TripsIcon size={40} />}
            title="No trips yet"
            sub="Hit Record to log your first drive — distance, speed, and route."
          />
        ) : (
          <div className="trip-list">
            {list.map((t) => (
              <ListRow
                key={t.id}
                className="trip-item"
                active={selected?.id === t.id}
                onClick={() => select(t)}
              >
                <span className="trip-name truncate">{tripName(t)}</span>
                <span className="trip-meta">
                  {fmtDate(t.startedAt)} · {fmtDistance(t.distanceM, unit)}
                </span>
              </ListRow>
            ))}
          </div>
        )}

        <HudPanel className="trip-detail">
          {selected ? (
            <>
              <span className="hud-label">Trip</span>
              <h3 className="truncate">{tripName(selected)}</h3>
              {points && points.length > 1 && <RouteSilhouette points={points} />}
              <div className="trip-stats">
                <StatGroup
                  label="Distance"
                  value={distanceConvert(selected.distanceM, unit).toFixed(1)}
                  unit={unit === "kmh" ? "km" : "mi"}
                />
                <StatGroup
                  label="Avg speed"
                  value={speedConvert(selected.avgSpeed, unit).toFixed(0)}
                  unit={speedUnitLabel(unit).toLowerCase()}
                />
                <StatGroup
                  label="Max speed"
                  value={speedConvert(selected.maxSpeed, unit).toFixed(0)}
                  unit={speedUnitLabel(unit).toLowerCase()}
                />
                <StatGroup label="Duration" value={fmtElapsed(selected.startedAt, selected.endedAt)} />
              </div>
              <div className="settings-list trip-meta-list">
                <SettingsRow label="Started" value={fmtDate(selected.startedAt)} />
                <SettingsRow label="Trackpoints" value={points?.length ?? "…"} />
              </div>
              <div className="trip-actions">
                <Button onClick={() => onExport(selected)}>Export GPX</Button>
                <Button onClick={() => setRenaming(selected)}>Rename</Button>
                <Button variant="danger" onClick={() => setConfirmDelete(selected)}>
                  Delete
                </Button>
              </div>
            </>
          ) : (
            <EmptyState title="No trip selected" sub="Pick a trip on the left to see its stats." />
          )}
        </HudPanel>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${tripName(confirmDelete)}”?`}
          body="The recorded route and stats are removed permanently."
          confirmLabel="Delete"
          danger
          onConfirm={() => doDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {renaming && (
        <PromptDialog
          title="Rename trip"
          initial={renaming.name ?? ""}
          placeholder="Trip name"
          onSubmit={(name) => doRename(renaming, name)}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  );
}
