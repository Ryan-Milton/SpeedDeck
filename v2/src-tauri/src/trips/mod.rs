//! Trip recording: SQLite store, buffered recorder, GPX export, Tauri commands.
//! Ported from v1 `trip/` (database.py, recorder.py, gpx_export.py).

pub mod database;
pub mod gpx;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::State;

pub use database::{Trackpoint, TripInfo, TripStore};

/// Flush buffered trackpoints to the DB every N points (~1 s at 10 Hz).
const FLUSH_EVERY: usize = 10;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Trip recording state machine (idle → recording → paused → idle). Cloneable;
/// clones share the same underlying state (one for the VehicleHub consumer, one
/// in Tauri managed state for commands).
#[derive(Clone)]
pub struct TripRecorder {
    store: TripStore,
    recording: Arc<AtomicBool>,
    active_id: Arc<Mutex<Option<i64>>>,
    buffer: Arc<Mutex<Vec<Trackpoint>>>,
}

impl TripRecorder {
    pub fn new(store: TripStore) -> Self {
        TripRecorder {
            store,
            recording: Arc::new(AtomicBool::new(false)),
            active_id: Arc::new(Mutex::new(None)),
            buffer: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn store(&self) -> &TripStore {
        &self.store
    }

    pub fn start(&self) -> Result<i64, String> {
        let id = self.store.create_trip(None, &now_rfc3339())?;
        *self.active_id.lock().unwrap() = Some(id);
        self.buffer.lock().unwrap().clear();
        self.recording.store(true, Ordering::SeqCst);
        Ok(id)
    }

    pub fn pause(&self) {
        self.recording.store(false, Ordering::SeqCst);
        self.flush();
    }

    pub fn resume(&self) {
        if self.active_id.lock().unwrap().is_some() {
            self.recording.store(true, Ordering::SeqCst);
        }
    }

    pub fn stop(&self, distance_m: f64, max_speed: f64, avg_speed: f64) -> Result<(), String> {
        self.recording.store(false, Ordering::SeqCst);
        self.flush();
        if let Some(id) = self.active_id.lock().unwrap().take() {
            self.store
                .end_trip(id, &now_rfc3339(), distance_m, max_speed, avg_speed)?;
        }
        Ok(())
    }

    /// Buffer a trackpoint (no-op unless actively recording). Flushes in batches.
    pub fn record(&self, point: Trackpoint) {
        if !self.recording.load(Ordering::SeqCst) {
            return;
        }
        let to_flush = {
            let mut buf = self.buffer.lock().unwrap();
            buf.push(point);
            if buf.len() >= FLUSH_EVERY {
                Some(buf.drain(..).collect::<Vec<_>>())
            } else {
                None
            }
        };
        if let Some(points) = to_flush {
            self.write(points);
        }
    }

    fn flush(&self) {
        let points = {
            let mut buf = self.buffer.lock().unwrap();
            buf.drain(..).collect::<Vec<_>>()
        };
        self.write(points);
    }

    fn write(&self, points: Vec<Trackpoint>) {
        if points.is_empty() {
            return;
        }
        if let Some(id) = *self.active_id.lock().unwrap() {
            let _ = self.store.insert_trackpoints(id, &points);
        }
    }
}

// --- query/management commands (recording start/stop live in lib.rs with the
//     VehicleHub so trip stats come from the processor) ---

#[tauri::command]
pub fn trip_list(recorder: State<'_, TripRecorder>) -> Result<Vec<TripInfo>, String> {
    recorder.store().get_trips()
}

#[tauri::command]
pub fn trip_trackpoints(
    recorder: State<'_, TripRecorder>,
    trip_id: i64,
) -> Result<Vec<Trackpoint>, String> {
    recorder.store().get_trackpoints(trip_id)
}

#[tauri::command]
pub fn trip_delete(recorder: State<'_, TripRecorder>, trip_id: i64) -> Result<(), String> {
    recorder.store().delete_trip(trip_id)
}

#[tauri::command]
pub fn trip_rename(
    recorder: State<'_, TripRecorder>,
    trip_id: i64,
    name: String,
) -> Result<(), String> {
    recorder.store().rename_trip(trip_id, &name)
}

#[tauri::command]
pub fn trip_export_gpx(recorder: State<'_, TripRecorder>, trip_id: i64) -> Result<String, String> {
    gpx::export_trip_gpx(recorder.store(), trip_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tp(lat: f64, lon: f64, speed: f64) -> Trackpoint {
        Trackpoint {
            timestamp: "2026-01-01T00:00:00+00:00".into(),
            latitude: lat,
            longitude: lon,
            altitude: Some(50.0),
            speed: Some(speed),
            heading: Some(90.0),
            satellites: Some(10),
            fix_quality: Some(1),
            hdop: Some(0.9),
        }
    }

    #[test]
    fn record_buffers_until_flush_then_persists() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();

        // 9 points stay buffered (FLUSH_EVERY = 10).
        for i in 0..9 {
            rec.record(tp(47.0 + i as f64 * 1e-4, -122.0, 10.0));
        }
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 0);

        // 10th triggers a flush.
        rec.record(tp(47.001, -122.0, 10.0));
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 10);
    }

    #[test]
    fn stop_flushes_remainder_and_finalizes() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.0, -122.0, 12.0));
        rec.record(tp(47.001, -122.0, 12.0));
        rec.stop(123.4, 20.0, 12.0).unwrap();

        assert_eq!(store.get_trackpoints(id).unwrap().len(), 2);
        let trip = store.get_trip(id).unwrap().unwrap();
        assert!(trip.ended_at.is_some());
        assert!((trip.distance_m - 123.4).abs() < 1e-6);
    }

    #[test]
    fn paused_recording_drops_points() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.pause();
        rec.record(tp(47.0, -122.0, 0.0)); // ignored while paused
        rec.resume();
        rec.record(tp(47.0, -122.0, 5.0));
        rec.stop(0.0, 5.0, 5.0).unwrap();
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 1);
    }

    #[test]
    fn gpx_export_contains_trackpoints() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.6062, -122.3321, 10.0));
        rec.stop(0.0, 10.0, 10.0).unwrap();

        let xml = gpx::export_trip_gpx(&store, id).unwrap();
        assert!(xml.contains("<gpx"));
        assert!(xml.contains("lat=\"47.6062000\""));
        assert!(xml.contains("<speed>10.00</speed>"));
    }
}
