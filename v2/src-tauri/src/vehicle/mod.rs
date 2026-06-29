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
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use nmea::RawFix;
use processor::DataProcessor;

use crate::trips::{Trackpoint, TripRecorder};

/// Where a sample came from. Future: `Obd2`, `DeadReckoning`, ...
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SampleSource {
    Gps,
    Simulator,
    Obd2,
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

/// A source of vehicle telemetry. Implementors own their own thread(s) and push
/// samples to `tx` until `stop` is set.
pub trait VehicleProvider: Send {
    fn name(&self) -> &'static str;
    fn spawn(self: Box<Self>, tx: Sender<VehicleSample>, stop: Arc<AtomicBool>);
}

/// Runs providers, processes their samples, and broadcasts state to the UI.
pub struct VehicleHub {
    stop: Arc<AtomicBool>,
    processor: Arc<Mutex<DataProcessor>>,
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
        let (tx, rx): (Sender<VehicleSample>, Receiver<VehicleSample>) = channel();
        let stop = Arc::new(AtomicBool::new(false));
        let processor = Arc::new(Mutex::new(DataProcessor::new()));

        for provider in providers {
            provider.spawn(tx.clone(), stop.clone());
        }
        // Drop our own sender so `rx` closes once all providers stop.
        drop(tx);

        let proc_for_consumer = processor.clone();
        thread::spawn(move || {
            while let Ok(sample) = rx.recv() {
                let state = {
                    let mut p = proc_for_consumer.lock().unwrap();
                    p.process(&sample)
                };
                // Persist a trackpoint (no-op unless a trip is recording).
                recorder.record(Trackpoint {
                    timestamp: state.fix.timestamp.clone(),
                    latitude: state.fix.latitude,
                    longitude: state.fix.longitude,
                    altitude: state.fix.altitude,
                    speed: Some(state.fix.speed),
                    heading: Some(state.fix.heading),
                    satellites: Some(state.fix.satellites as i64),
                    fix_quality: Some(state.fix.fix_quality as i64),
                    hdop: state.fix.hdop,
                });
                if app.emit("vehicle:state", &state).is_err() {
                    break; // app shutting down
                }
            }
        });

        VehicleHub { stop, processor }
    }

    /// Shared processor handle for command-driven mutations (e.g. trip control).
    pub fn processor(&self) -> Arc<Mutex<DataProcessor>> {
        self.processor.clone()
    }

    #[allow(dead_code)]
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}
