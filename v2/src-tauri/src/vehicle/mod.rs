//! Vehicle-data abstraction.
//!
//! `VehicleProvider`s push normalized `VehicleSample`s into the `VehicleHub`,
//! which feeds them through the `DataProcessor` and emits `vehicle:state` to the
//! frontend. GPS is provider #1 (`gps_provider`); OBD2 will be a future provider
//! adding fields (rpm, fuel, ...) to `VehicleSample` without touching anything
//! downstream.

pub mod gps_provider;
pub mod nmea;
pub mod processor;
pub mod serial;
pub mod simulator;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use nmea::RawFix;
use processor::{DataProcessor, VehicleState};

use crate::trips::{Trackpoint, TripRecorder};

/// Where a sample came from. Future: `Obd2`, `DeadReckoning`, ...
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleSource {
    Gps,
    Simulator,
    Obd2,
}

/// Receiver transport/fix health is independent from the latest valid sample.
/// A valid position is never inferred from an open serial connection alone.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReceiverStatus {
    Connected,
    Fix,
    NoFix,
    Stale,
    Disconnected,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverHealth {
    pub sequence: u64,
    pub source: SampleSource,
    pub status: ReceiverStatus,
}

impl SampleSource {
    pub fn as_str(&self) -> &'static str {
        match self {
            SampleSource::Gps => "gps",
            SampleSource::Simulator => "simulator",
            SampleSource::Obd2 => "obd2",
        }
    }
}

/// A normalized, source-agnostic telemetry sample. Today it carries GPS-derived
/// fields; OBD2 fields are added here later as `Option<_>` (additive — existing
/// consumers ignore them until they care).
#[derive(Clone, Debug)]
pub struct VehicleSample {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed_mps: f64,
    pub heading: f64,
    pub satellites: u32,
    pub fix_quality: u8,
    pub hdop: Option<f64>,
    pub source: SampleSource,
    // future (OBD2): pub rpm: Option<u32>, pub fuel_pct: Option<f64>, ...
}

impl VehicleSample {
    pub fn from_raw(fix: RawFix, source: SampleSource) -> Self {
        VehicleSample {
            latitude: fix.latitude,
            longitude: fix.longitude,
            altitude: fix.altitude,
            speed_mps: fix.speed_mps,
            heading: fix.heading,
            satellites: fix.satellites,
            fix_quality: fix.fix_quality,
            hdop: fix.hdop,
            source,
        }
    }
}

pub enum VehicleEvent {
    Sample(VehicleSample),
    Health {
        source: SampleSource,
        status: ReceiverStatus,
    },
}

/// A source of vehicle telemetry. Implementors own their own thread(s) and push
/// samples to `tx` until `stop` is set.
pub trait VehicleProvider: Send {
    fn name(&self) -> &'static str;
    fn spawn(self: Box<Self>, tx: SyncSender<VehicleEvent>, stop: Arc<AtomicBool>);
}

/// Runs providers, processes their samples, and broadcasts state to the UI.
pub struct VehicleHub {
    stop: Arc<AtomicBool>,
    processor: Arc<Mutex<DataProcessor>>,
    trip_gate: Arc<Mutex<()>>,
    ui_updates: Arc<UiUpdates>,
}

struct UiUpdates {
    latest: Mutex<Option<VehicleState>>,
    ready: Condvar,
    stopped: AtomicBool,
}

impl VehicleHub {
    /// Start the hub: spawn every provider plus the consumer thread that emits
    /// `vehicle:state` and records trackpoints while a trip is active. Store the
    /// returned handle in Tauri state so command handlers (trip control, ...)
    /// can reach the shared `DataProcessor`.
    pub fn start(
        app: AppHandle,
        providers: Vec<Box<dyn VehicleProvider>>,
        recorder: TripRecorder,
    ) -> Self {
        // Backpressure preserves every sample for the recorder. UI snapshots use
        // a separate single-slot coalescer below, so a slow frontend is isolated.
        let (tx, rx): (SyncSender<VehicleEvent>, Receiver<VehicleEvent>) = sync_channel(64);
        let stop = Arc::new(AtomicBool::new(false));
        let processor = Arc::new(Mutex::new(DataProcessor::new()));
        let trip_gate = Arc::new(Mutex::new(()));
        let ui_updates = Arc::new(UiUpdates {
            latest: Mutex::new(None),
            ready: Condvar::new(),
            stopped: AtomicBool::new(false),
        });

        for provider in providers {
            provider.spawn(tx.clone(), stop.clone());
        }
        // Drop our own sender so `rx` closes once all providers stop.
        drop(tx);

        let ui_for_emitter = ui_updates.clone();
        let app_for_emitter = app.clone();
        thread::spawn(move || loop {
            let state = {
                let mut latest = ui_for_emitter.latest.lock().unwrap();
                while latest.is_none() && !ui_for_emitter.stopped.load(Ordering::SeqCst) {
                    latest = ui_for_emitter.ready.wait(latest).unwrap();
                }
                if ui_for_emitter.stopped.load(Ordering::SeqCst) {
                    return;
                }
                latest.take().expect("UI state is available")
            };
            if app_for_emitter.emit("vehicle:state", state).is_err() {
                return;
            }
        });

        let proc_for_consumer = processor.clone();
        let gate_for_consumer = trip_gate.clone();
        let ui_for_consumer = ui_updates.clone();
        thread::spawn(move || {
            let mut sequence = 0u64;
            while let Ok(event) = rx.recv() {
                sequence = sequence
                    .checked_add(1)
                    .expect("vehicle event sequence overflow");
                match event {
                    VehicleEvent::Health { source, status } => {
                        let health = ReceiverHealth {
                            sequence,
                            source,
                            status,
                        };
                        let _ = app.emit("vehicle:health", health);
                    }
                    VehicleEvent::Sample(sample) => {
                        let (mut state, recording_error) = {
                            // Commands take this same lock, so a point cannot be
                            // accepted on the wrong side of a trip transition.
                            let _trip_transition = gate_for_consumer.lock().unwrap();
                            let mut p = proc_for_consumer.lock().unwrap();
                            let state = p.process(&sample, sequence);
                            let recording_error = recorder
                                .record(Trackpoint {
                                    timestamp: state.fix.timestamp.clone(),
                                    latitude: state.fix.latitude,
                                    longitude: state.fix.longitude,
                                    altitude: state.fix.altitude,
                                    speed: Some(state.fix.speed),
                                    heading: Some(state.fix.heading),
                                    satellites: Some(state.fix.satellites as i64),
                                    fix_quality: Some(state.fix.fix_quality as i64),
                                    hdop: state.fix.hdop,
                                })
                                .err();
                            if recording_error.is_some() {
                                p.pause_trip();
                            }
                            (state, recording_error)
                        };
                        if let Some(error) = recording_error {
                            state.trip_status = "paused".to_string();
                            let _ = app.emit("trip:status", "paused");
                            let _ = app.emit("trip:recording-error", error);
                        }
                        *ui_for_consumer.latest.lock().unwrap() = Some(state);
                        ui_for_consumer.ready.notify_one();
                    }
                }
            }
        });

        VehicleHub {
            stop,
            processor,
            trip_gate,
            ui_updates,
        }
    }

    /// Shared processor handle for command-driven mutations (e.g. trip control).
    pub fn processor(&self) -> Arc<Mutex<DataProcessor>> {
        self.processor.clone()
    }

    /// Serializes control commands with the telemetry consumer's process/record
    /// section, defining the exact boundary of each trip transition.
    pub fn trip_gate(&self) -> Arc<Mutex<()>> {
        self.trip_gate.clone()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        self.ui_updates.stopped.store(true, Ordering::SeqCst);
        self.ui_updates.ready.notify_all();
    }
}

pub fn send_sample(tx: &SyncSender<VehicleEvent>, sample: VehicleSample) -> bool {
    tx.send(VehicleEvent::Sample(sample)).is_ok()
}
