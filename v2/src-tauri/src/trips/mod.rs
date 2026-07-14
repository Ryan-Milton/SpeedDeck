//! Trip recording: SQLite store, serialized writer, GPX export, Tauri commands.

pub mod database;
pub mod gpx;

use std::sync::mpsc::{channel, sync_channel, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::State;

pub use database::{Trackpoint, TripInfo, TripStore};

/// The writer owns batching, while this bounded queue applies backpressure rather
/// than silently dropping trackpoints when SQLite is temporarily slow.
const WRITER_QUEUE_CAPACITY: usize = 256;
const FLUSH_EVERY: usize = 10;
const WRITE_RETRIES: usize = 3;

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[derive(Clone, Copy)]
enum RecorderPhase {
    Idle,
    Recording(i64),
    Paused(i64),
}

struct RecorderState {
    phase: RecorderPhase,
    write_error: Option<String>,
}

enum WriterCommand {
    Point {
        trip_id: i64,
        point: Trackpoint,
        reply: Sender<Result<(), String>>,
    },
    Flush {
        reply: Sender<Result<(), String>>,
    },
    Finalize {
        trip_id: i64,
        distance_m: f64,
        max_speed: f64,
        avg_speed: f64,
        reply: Sender<Result<(), String>>,
    },
    Delete {
        trip_id: i64,
        reply: Sender<Result<(), String>>,
    },
}

struct RecorderInner {
    store: TripStore,
    state: Mutex<RecorderState>,
    submission: Mutex<()>,
    writer: SyncSender<WriterCommand>,
}

/// Trip recording state machine (idle -> recording -> paused -> idle). The
/// database writer is the sole trackpoint writer, so flush/finalize barriers
/// cannot overtake accepted telemetry.
#[derive(Clone)]
pub struct TripRecorder {
    inner: Arc<RecorderInner>,
}

impl TripRecorder {
    pub fn new(store: TripStore) -> Self {
        let (writer, receiver) = sync_channel(WRITER_QUEUE_CAPACITY);
        let writer_store = store.clone();
        thread::spawn(move || run_writer(writer_store, receiver));
        Self {
            inner: Arc::new(RecorderInner {
                store,
                state: Mutex::new(RecorderState {
                    phase: RecorderPhase::Idle,
                    write_error: None,
                }),
                submission: Mutex::new(()),
                writer,
            }),
        }
    }

    pub fn store(&self) -> &TripStore {
        &self.inner.store
    }

    pub fn start(&self) -> Result<i64, String> {
        let _submission = self.inner.submission.lock().unwrap();
        if !matches!(self.inner.state.lock().unwrap().phase, RecorderPhase::Idle) {
            return Err("a trip is already active".to_string());
        }
        let id = self.inner.store.create_trip(None, &now_rfc3339())?;
        let mut state = self.inner.state.lock().unwrap();
        state.phase = RecorderPhase::Recording(id);
        state.write_error = None;
        Ok(id)
    }

    pub fn pause(&self) -> Result<(), String> {
        let _submission = self.inner.submission.lock().unwrap();
        let (id, prior_phase, needs_flush) = {
            let state = self.inner.state.lock().unwrap();
            match state.phase {
                RecorderPhase::Recording(id) => (id, state.phase, true),
                RecorderPhase::Paused(id) => (id, state.phase, state.write_error.is_some()),
                RecorderPhase::Idle => return Err("no recording trip to pause".to_string()),
            }
        };
        if !needs_flush {
            return Ok(());
        }
        if let Err(error) = self.flush_writer() {
            let mut state = self.inner.state.lock().unwrap();
            state.phase = prior_phase;
            state.write_error = Some(error.clone());
            return Err(error);
        }
        let mut state = self.inner.state.lock().unwrap();
        state.phase = RecorderPhase::Paused(id);
        state.write_error = None;
        Ok(())
    }

    pub fn resume(&self) -> Result<(), String> {
        let _submission = self.inner.submission.lock().unwrap();
        let (id, needs_flush) = {
            let state = self.inner.state.lock().unwrap();
            match state.phase {
                RecorderPhase::Paused(id) => (id, state.write_error.is_some()),
                RecorderPhase::Recording(_) => return Ok(()),
                RecorderPhase::Idle => return Err("no paused trip to resume".to_string()),
            }
        };
        if needs_flush {
            self.flush_writer()?;
        }
        let mut state = self.inner.state.lock().unwrap();
        state.phase = RecorderPhase::Recording(id);
        state.write_error = None;
        Ok(())
    }

    pub fn stop(&self, distance_m: f64, max_speed: f64, avg_speed: f64) -> Result<(), String> {
        let _submission = self.inner.submission.lock().unwrap();
        let (id, prior_phase) = match self.inner.state.lock().unwrap().phase {
            RecorderPhase::Idle => return Ok(()),
            phase @ (RecorderPhase::Recording(id) | RecorderPhase::Paused(id)) => (id, phase),
        };
        match self.finalize_writer(id, distance_m, max_speed, avg_speed) {
            Ok(()) => {
                let mut state = self.inner.state.lock().unwrap();
                state.phase = RecorderPhase::Idle;
                state.write_error = None;
                Ok(())
            }
            Err(error) => {
                let mut state = self.inner.state.lock().unwrap();
                state.phase = prior_phase;
                Err(error)
            }
        }
    }

    /// Returns whether the point was accepted. Queue/storage failures are
    /// explicit, while the bounded queue prevents telemetry from growing memory.
    pub fn record(&self, point: Trackpoint) -> Result<bool, String> {
        let submission = self.inner.submission.lock().unwrap();
        let trip_id = {
            let state = self.inner.state.lock().unwrap();
            if let Some(error) = &state.write_error {
                return Err(error.clone());
            }
            let RecorderPhase::Recording(trip_id) = state.phase else {
                return Ok(false);
            };
            trip_id
        };
        let (reply, response) = channel();
        if let Err(error) = self.send_writer(WriterCommand::Point {
            trip_id,
            point,
            reply,
        }) {
            self.pause_after_write_failure(trip_id, &error);
            return Err(error);
        }
        drop(submission);
        let result = response
            .recv()
            .map_err(|_| "trip database writer stopped unexpectedly".to_string())?;
        if let Err(error) = result {
            self.pause_after_write_failure(trip_id, &error);
            return Err(error);
        }
        Ok(true)
    }

    fn pause_after_write_failure(&self, trip_id: i64, error: &str) {
        let mut state = self.inner.state.lock().unwrap();
        if matches!(state.phase, RecorderPhase::Recording(id) if id == trip_id) {
            state.phase = RecorderPhase::Paused(trip_id);
        }
        state.write_error = Some(error.to_string());
    }

    pub fn delete(&self, trip_id: i64) -> Result<(), String> {
        let _submission = self.inner.submission.lock().unwrap();
        match self.inner.state.lock().unwrap().phase {
            RecorderPhase::Recording(active_id) | RecorderPhase::Paused(active_id)
                if active_id == trip_id =>
            {
                return Err(format!("cannot delete active trip {trip_id}"));
            }
            _ => {}
        }
        let (reply, response) = channel();
        self.send_writer(WriterCommand::Delete { trip_id, reply })?;
        response
            .recv()
            .map_err(|_| "trip database writer stopped unexpectedly".to_string())?
    }

    fn send_writer(&self, command: WriterCommand) -> Result<(), String> {
        self.inner
            .writer
            .try_send(command)
            .map_err(|error| match error {
                TrySendError::Full(_) => "trip database writer queue is full".to_string(),
                TrySendError::Disconnected(_) => {
                    "trip database writer stopped unexpectedly".to_string()
                }
            })
    }

    fn flush_writer(&self) -> Result<(), String> {
        let (reply, response) = channel();
        self.send_writer(WriterCommand::Flush { reply })?;
        response
            .recv()
            .map_err(|_| "trip database writer stopped unexpectedly".to_string())?
    }

    fn finalize_writer(
        &self,
        trip_id: i64,
        distance_m: f64,
        max_speed: f64,
        avg_speed: f64,
    ) -> Result<(), String> {
        let (reply, response) = channel();
        self.send_writer(WriterCommand::Finalize {
            trip_id,
            distance_m,
            max_speed,
            avg_speed,
            reply,
        })?;
        response
            .recv()
            .map_err(|_| "trip database writer stopped unexpectedly".to_string())?
    }
}

fn run_writer(store: TripStore, receiver: Receiver<WriterCommand>) {
    let mut pending_id = None;
    let mut pending = Vec::with_capacity(FLUSH_EVERY);
    let mut write_failure: Option<String> = None;

    while let Ok(command) = receiver.recv() {
        match command {
            WriterCommand::Point {
                trip_id,
                point,
                reply,
            } => {
                if let Some(error) = &write_failure {
                    let _ = reply.send(Err(error.clone()));
                    continue;
                }
                debug_assert!(pending_id.is_none() || pending_id == Some(trip_id));
                pending_id = Some(trip_id);
                pending.push(point);
                let result = if pending.len() >= FLUSH_EVERY {
                    flush_pending(&store, pending_id, &mut pending)
                } else {
                    Ok(())
                };
                if let Err(error) = &result {
                    write_failure = Some(error.clone());
                }
                let _ = reply.send(result);
            }
            WriterCommand::Flush { reply } => {
                let result = flush_pending(&store, pending_id, &mut pending);
                match &result {
                    Ok(()) => {
                        pending_id = None;
                        write_failure = None;
                    }
                    Err(error) => write_failure = Some(error.clone()),
                }
                let _ = reply.send(result);
            }
            WriterCommand::Finalize {
                trip_id,
                distance_m,
                max_speed,
                avg_speed,
                reply,
            } => {
                let flush_result = flush_pending(&store, pending_id, &mut pending);
                let result = flush_result.and_then(|()| {
                    store.end_trip(trip_id, &now_rfc3339(), distance_m, max_speed, avg_speed)
                });
                match &result {
                    Ok(()) => {
                        pending_id = None;
                        write_failure = None;
                    }
                    Err(error) if !pending.is_empty() => write_failure = Some(error.clone()),
                    Err(_) => write_failure = None,
                }
                let _ = reply.send(result);
            }
            WriterCommand::Delete { trip_id, reply } => {
                let result = flush_pending(&store, pending_id, &mut pending)
                    .and_then(|()| store.delete_trip(trip_id));
                match &result {
                    Ok(()) => {
                        pending_id = None;
                        write_failure = None;
                    }
                    Err(error) if !pending.is_empty() => write_failure = Some(error.clone()),
                    Err(_) => write_failure = None,
                }
                let _ = reply.send(result);
            }
        }
    }
}

fn flush_pending(
    store: &TripStore,
    pending_id: Option<i64>,
    pending: &mut Vec<Trackpoint>,
) -> Result<(), String> {
    if pending.is_empty() {
        return Ok(());
    }
    let trip_id = pending_id.expect("pending points have a trip id");
    let mut last_error = String::new();
    for _ in 0..WRITE_RETRIES {
        match store.insert_trackpoints(trip_id, pending) {
            Ok(()) => {
                pending.clear();
                return Ok(());
            }
            Err(error) => last_error = error,
        }
    }
    Err(format!(
        "failed to write {} trip trackpoints after {WRITE_RETRIES} attempts: {last_error}",
        pending.len()
    ))
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
    recorder.delete(trip_id)
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
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::thread;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn tp(lat: f64, lon: f64, speed: f64) -> Trackpoint {
        Trackpoint {
            timestamp: format!("2026-01-01T00:00:{lat:.4}+00:00"),
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

        for i in 0..9 {
            rec.record(tp(47.0 + i as f64 * 1e-4, -122.0, 10.0))
                .unwrap();
        }
        rec.pause().unwrap();
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 9);
    }

    #[test]
    fn writer_retries_a_transient_database_failure() {
        let store = TripStore::open_in_memory().unwrap();
        store.fail_next_trackpoint_inserts(1);
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.0, -122.0, 10.0)).unwrap();
        rec.stop(0.0, 10.0, 10.0).unwrap();

        assert_eq!(store.get_trackpoints(id).unwrap().len(), 1);
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_some());
    }

    #[test]
    fn permanent_writer_failure_is_bounded_and_surfaced() {
        let store = TripStore::open_in_memory().unwrap();
        store.fail_next_trackpoint_inserts(usize::MAX);
        let rec = TripRecorder::new(store);
        rec.start().unwrap();

        for i in 0..FLUSH_EVERY - 1 {
            rec.record(tp(47.0 + i as f64 * 1e-4, -122.0, 10.0))
                .unwrap();
        }
        let error = rec
            .record(tp(48.0, -122.0, 10.0))
            .expect_err("the full batch must surface its write failure");
        assert!(error.contains("failed to write"));

        let error = rec
            .record(tp(49.0, -122.0, 10.0))
            .expect_err("points must be rejected while the bounded batch is pending");
        assert!(error.contains("failed to write"));
        assert!(rec.stop(0.0, 10.0, 10.0).is_err());
    }

    #[test]
    fn a_failed_batch_is_retried_by_the_next_barrier() {
        let store = TripStore::open_in_memory().unwrap();
        store.fail_next_trackpoint_inserts(WRITE_RETRIES);
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();

        for i in 0..FLUSH_EVERY - 1 {
            rec.record(tp(47.0 + i as f64 * 1e-4, -122.0, 10.0))
                .unwrap();
        }
        assert!(rec.record(tp(48.0, -122.0, 10.0)).is_err());
        rec.pause().unwrap();

        assert_eq!(store.get_trackpoints(id).unwrap().len(), FLUSH_EVERY);
        assert!(!rec.record(tp(49.0, -122.0, 10.0)).unwrap());
    }

    #[test]
    fn stop_surfaces_an_exhausted_write_retry_and_can_be_retried() {
        let store = TripStore::open_in_memory().unwrap();
        store.fail_next_trackpoint_inserts(WRITE_RETRIES);
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.0, -122.0, 10.0)).unwrap();

        assert!(rec.stop(0.0, 10.0, 10.0).is_err());
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_none());

        rec.stop(0.0, 10.0, 10.0).unwrap();
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 1);
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_some());
    }

    #[test]
    fn failed_stop_from_paused_preserves_pause_and_can_be_retried() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.pause().unwrap();
        store.fail_next_end_trip_updates(1);

        assert!(rec.stop(0.0, 0.0, 0.0).is_err());
        assert!(!rec.record(tp(47.0, -122.0, 1.0)).unwrap());
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_none());

        rec.stop(0.0, 0.0, 0.0).unwrap();
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_some());
    }

    #[test]
    fn full_and_failed_writer_controls_return_without_changing_phase() {
        let store = TripStore::open_in_memory().unwrap();
        let id = store.create_trip(None, &now_rfc3339()).unwrap();
        let (writer, receiver) = sync_channel(1);
        let (reply, _response) = channel();
        assert!(writer.try_send(WriterCommand::Flush { reply }).is_ok());
        let rec = TripRecorder {
            inner: Arc::new(RecorderInner {
                store,
                state: Mutex::new(RecorderState {
                    phase: RecorderPhase::Recording(id),
                    write_error: None,
                }),
                submission: Mutex::new(()),
                writer,
            }),
        };

        assert_eq!(
            rec.pause().unwrap_err(),
            "trip database writer queue is full"
        );
        assert!(matches!(
            rec.inner.state.lock().unwrap().phase,
            RecorderPhase::Recording(active_id) if active_id == id
        ));

        drop(receiver);
        assert_eq!(
            rec.stop(0.0, 0.0, 0.0).unwrap_err(),
            "trip database writer stopped unexpectedly"
        );
        assert!(matches!(
            rec.inner.state.lock().unwrap().phase,
            RecorderPhase::Recording(active_id) if active_id == id
        ));
    }

    #[test]
    fn duplicate_start_is_rejected() {
        let rec = TripRecorder::new(TripStore::open_in_memory().unwrap());
        rec.start().unwrap();
        assert_eq!(rec.start().unwrap_err(), "a trip is already active");
    }

    #[test]
    fn active_trip_cannot_be_deleted_and_other_deletes_are_barriered() {
        let store = TripStore::open_in_memory().unwrap();
        let old_id = store.create_trip(None, &now_rfc3339()).unwrap();
        store
            .end_trip(old_id, &now_rfc3339(), 0.0, 0.0, 0.0)
            .unwrap();
        let rec = TripRecorder::new(store.clone());
        let active_id = rec.start().unwrap();
        rec.record(tp(47.0, -122.0, 10.0)).unwrap();

        assert_eq!(
            rec.delete(active_id).unwrap_err(),
            format!("cannot delete active trip {active_id}")
        );
        assert!(store.get_trip(active_id).unwrap().is_some());

        rec.delete(old_id).unwrap();
        assert!(store.get_trip(old_id).unwrap().is_none());
        assert_eq!(store.get_trackpoints(active_id).unwrap().len(), 1);
        assert!(rec.delete(old_id).unwrap_err().contains("was not found"));
    }

    #[test]
    fn reopening_store_finalizes_unfinished_trips() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = PathBuf::from(std::env::temp_dir()).join(format!(
            "speeddeck-trip-recovery-{}-{unique}.db",
            std::process::id()
        ));
        let id = {
            let store = TripStore::open(&path).unwrap();
            store
                .create_trip(None, "2026-01-01T00:00:00+00:00")
                .unwrap()
        };

        {
            let reopened = TripStore::open(&path).unwrap();
            assert!(reopened.get_trip(id).unwrap().unwrap().ended_at.is_some());
        }

        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn stop_flushes_remainder_and_finalizes() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.0, -122.0, 12.0)).unwrap();
        rec.record(tp(47.001, -122.0, 12.0)).unwrap();
        rec.stop(123.4, 20.0, 12.0).unwrap();

        assert_eq!(store.get_trackpoints(id).unwrap().len(), 2);
        let trip = store.get_trip(id).unwrap().unwrap();
        assert!(trip.ended_at.is_some());
        assert!((trip.distance_m - 123.4).abs() < 1e-6);
    }

    #[test]
    fn concurrent_record_and_stop_preserve_accepted_points() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = Arc::new(TripRecorder::new(store.clone()));
        let id = rec.start().unwrap();
        let writer = rec.clone();
        let recording = thread::spawn(move || {
            let mut accepted = 0;
            for i in 0..500 {
                accepted += usize::from(
                    writer
                        .record(tp(47.0 + i as f64 * 1e-5, -122.0, 10.0))
                        .unwrap(),
                );
            }
            accepted
        });
        rec.stop(0.0, 10.0, 10.0).unwrap();
        let accepted = recording.join().unwrap();

        assert_eq!(store.get_trackpoints(id).unwrap().len(), accepted);
        assert!(store.get_trip(id).unwrap().unwrap().ended_at.is_some());
    }

    #[test]
    fn paused_recording_drops_points() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.pause().unwrap();
        assert!(!rec.record(tp(47.0, -122.0, 0.0)).unwrap());
        rec.resume().unwrap();
        rec.record(tp(47.0, -122.0, 5.0)).unwrap();
        rec.stop(0.0, 5.0, 5.0).unwrap();
        assert_eq!(store.get_trackpoints(id).unwrap().len(), 1);
    }

    #[test]
    fn gpx_export_contains_trackpoints() {
        let store = TripStore::open_in_memory().unwrap();
        let rec = TripRecorder::new(store.clone());
        let id = rec.start().unwrap();
        rec.record(tp(47.6062, -122.3321, 10.0)).unwrap();
        rec.stop(0.0, 10.0, 10.0).unwrap();

        let xml = gpx::export_trip_gpx(&store, id).unwrap();
        assert!(xml.contains("<gpx"));
        assert!(xml.contains("lat=\"47.6062000\""));
        assert!(xml.contains("<speed>10.00</speed>"));
    }
}
