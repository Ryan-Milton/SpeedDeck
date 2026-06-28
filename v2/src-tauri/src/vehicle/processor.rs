//! Smoothing + session/trip stats — ported from v1 `gps/data_processor.py`.
//!
//! Consumes normalized `VehicleSample`s and produces `VehicleState` snapshots
//! (the payload emitted to the frontend on `vehicle:state`). EMA smoothing
//! constants and the min-speed drift threshold match v1 exactly.

use std::time::Instant;

use serde::Serialize;

use crate::geo::distance_3d;
use crate::vehicle::VehicleSample;

const SMOOTHING_ALPHA: f64 = 0.3;
const ALTITUDE_ALPHA: f64 = 0.2;
const MIN_SPEED_THRESHOLD: f64 = 0.56; // m/s (~2 km/h) — ignore GPS drift below this

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TripStatus {
    Idle,
    Recording,
    Paused,
}

impl TripStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TripStatus::Idle => "idle",
            TripStatus::Recording => "recording",
            TripStatus::Paused => "paused",
        }
    }
}

/// A single fix as broadcast to the frontend (altitude is smoothed). camelCase
/// to match v1's `GPSFix` shape consumed by the UI.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixSnapshot {
    pub timestamp: String,
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed: f64,
    pub heading: f64,
    pub satellites: u32,
    pub fix_quality: u8,
    pub hdop: Option<f64>,
}

/// Full state snapshot broadcast to clients (mirrors v1 `GPSState`).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VehicleState {
    pub fix: FixSnapshot,
    pub smoothed_speed: f64,
    pub max_speed: f64,
    pub avg_speed: f64,
    pub trip_status: String,
    pub trip_distance: f64,
    pub trip_duration: f64,
    pub trip_max_speed: f64,
    pub trip_avg_speed: f64,
    pub source: String,
}

pub struct DataProcessor {
    smoothed_speed: f64,
    smoothed_altitude: Option<f64>,
    max_speed: f64,
    speed_sum: f64,
    speed_count: u64,

    prev_lat: Option<f64>,
    prev_lon: Option<f64>,
    prev_alt: Option<f64>,

    pub trip_status: TripStatus,
    pub trip_distance: f64,
    pub trip_duration: f64,
    pub trip_max_speed: f64,
    pub trip_avg_speed: f64,
    trip_start: Option<Instant>,
    trip_speed_sum: f64,
    trip_speed_count: u64,
}

impl Default for DataProcessor {
    fn default() -> Self {
        Self::new()
    }
}

impl DataProcessor {
    pub fn new() -> Self {
        DataProcessor {
            smoothed_speed: 0.0,
            smoothed_altitude: None,
            max_speed: 0.0,
            speed_sum: 0.0,
            speed_count: 0,
            prev_lat: None,
            prev_lon: None,
            prev_alt: None,
            trip_status: TripStatus::Idle,
            trip_distance: 0.0,
            trip_duration: 0.0,
            trip_max_speed: 0.0,
            trip_avg_speed: 0.0,
            trip_start: None,
            trip_speed_sum: 0.0,
            trip_speed_count: 0,
        }
    }

    /// Process a raw sample into a full state snapshot.
    pub fn process(&mut self, sample: &VehicleSample) -> VehicleState {
        let speed = sample.speed_mps;

        // EMA speed smoothing.
        if self.speed_count == 0 {
            self.smoothed_speed = speed;
        } else {
            self.smoothed_speed = SMOOTHING_ALPHA * speed + (1.0 - SMOOTHING_ALPHA) * self.smoothed_speed;
        }

        // Session max.
        if speed > self.max_speed {
            self.max_speed = speed;
        }

        // Session average (only when moving; seed denominator to avoid div-by-zero).
        if speed >= MIN_SPEED_THRESHOLD {
            self.speed_sum += speed;
            self.speed_count += 1;
        } else if self.speed_count == 0 {
            self.speed_count = 1;
        }
        let avg_speed = self.speed_sum / self.speed_count.max(1) as f64;

        // EMA altitude smoothing.
        let alt_for_fix = match sample.altitude {
            Some(a) => {
                let smoothed = match self.smoothed_altitude {
                    None => a,
                    Some(prev) => ALTITUDE_ALPHA * a + (1.0 - ALTITUDE_ALPHA) * prev,
                };
                self.smoothed_altitude = Some(smoothed);
                Some(smoothed)
            }
            None => None,
        };

        // Trip accumulation.
        if self.trip_status == TripStatus::Recording {
            self.accumulate_trip(sample, alt_for_fix);
        }

        // Update previous position.
        self.prev_lat = Some(sample.latitude);
        self.prev_lon = Some(sample.longitude);
        self.prev_alt = alt_for_fix;

        VehicleState {
            fix: FixSnapshot {
                timestamp: now_rfc3339(),
                latitude: sample.latitude,
                longitude: sample.longitude,
                altitude: alt_for_fix,
                speed,
                heading: sample.heading,
                satellites: sample.satellites,
                fix_quality: sample.fix_quality,
                hdop: sample.hdop,
            },
            smoothed_speed: self.smoothed_speed,
            max_speed: self.max_speed,
            avg_speed,
            trip_status: self.trip_status.as_str().to_string(),
            trip_distance: self.trip_distance,
            trip_duration: self.trip_duration,
            trip_max_speed: self.trip_max_speed,
            trip_avg_speed: self.trip_avg_speed,
            source: sample.source.as_str().to_string(),
        }
    }

    fn accumulate_trip(&mut self, sample: &VehicleSample, alt_for_fix: Option<f64>) {
        let speed = sample.speed_mps;

        // Distance (only when moving above threshold).
        if let (Some(plat), Some(plon)) = (self.prev_lat, self.prev_lon) {
            if speed >= MIN_SPEED_THRESHOLD {
                self.trip_distance += distance_3d(
                    plat,
                    plon,
                    self.prev_alt,
                    sample.latitude,
                    sample.longitude,
                    alt_for_fix,
                );
            }
        }

        if speed > self.trip_max_speed {
            self.trip_max_speed = speed;
        }

        if speed >= MIN_SPEED_THRESHOLD {
            self.trip_speed_sum += speed;
            self.trip_speed_count += 1;
            self.trip_avg_speed = self.trip_speed_sum / self.trip_speed_count as f64;
        }

        if let Some(start) = self.trip_start {
            self.trip_duration = start.elapsed().as_secs_f64();
        }
    }

    pub fn start_trip(&mut self) {
        self.trip_status = TripStatus::Recording;
        self.trip_distance = 0.0;
        self.trip_duration = 0.0;
        self.trip_max_speed = 0.0;
        self.trip_avg_speed = 0.0;
        self.trip_start = Some(Instant::now());
        self.trip_speed_sum = 0.0;
        self.trip_speed_count = 0;
    }

    pub fn stop_trip(&mut self) {
        self.trip_status = TripStatus::Idle;
        self.trip_start = None;
    }

    pub fn pause_trip(&mut self) {
        self.trip_status = TripStatus::Paused;
    }

    pub fn resume_trip(&mut self) {
        self.trip_status = TripStatus::Recording;
    }

    pub fn reset_session_max(&mut self) {
        self.max_speed = 0.0;
    }

    pub fn reset_session_avg(&mut self) {
        self.speed_sum = 0.0;
        self.speed_count = 0;
    }
}

#[cfg(not(test))]
fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

// Deterministic timestamp under test (chrono clock is fine in prod, but keeping
// tests free of wall-clock makes assertions stable).
#[cfg(test)]
fn now_rfc3339() -> String {
    "1970-01-01T00:00:00+00:00".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vehicle::{SampleSource, VehicleSample};

    fn sample(speed: f64, lat: f64, lon: f64, alt: Option<f64>) -> VehicleSample {
        VehicleSample {
            latitude: lat,
            longitude: lon,
            altitude: alt,
            speed_mps: speed,
            heading: 0.0,
            satellites: 10,
            fix_quality: 1,
            hdop: Some(0.9),
            source: SampleSource::Simulator,
        }
    }

    #[test]
    fn first_sample_seeds_smoothed_speed() {
        let mut p = DataProcessor::new();
        let s = p.process(&sample(10.0, 47.0, -122.0, Some(50.0)));
        assert!((s.smoothed_speed - 10.0).abs() < 1e-9);
        assert!((s.max_speed - 10.0).abs() < 1e-9);
    }

    #[test]
    fn ema_pulls_toward_new_value() {
        let mut p = DataProcessor::new();
        p.process(&sample(10.0, 47.0, -122.0, None));
        let s = p.process(&sample(0.0, 47.0, -122.0, None));
        // 0.3*0 + 0.7*10 = 7.0
        assert!((s.smoothed_speed - 7.0).abs() < 1e-9);
    }

    #[test]
    fn trip_distance_accumulates_only_when_recording_and_moving() {
        let mut p = DataProcessor::new();
        p.process(&sample(10.0, 47.0000, -122.0, None)); // not recording yet
        p.start_trip();
        p.process(&sample(10.0, 47.0010, -122.0, None));
        let s = p.process(&sample(10.0, 47.0020, -122.0, None));
        assert!(s.trip_distance > 100.0, "got {}", s.trip_distance);
        assert_eq!(s.trip_status, "recording");
    }

    #[test]
    fn drift_below_threshold_is_ignored_for_distance() {
        let mut p = DataProcessor::new();
        p.start_trip();
        p.process(&sample(0.1, 47.0, -122.0, None));
        let s = p.process(&sample(0.1, 47.01, -122.0, None));
        assert_eq!(s.trip_distance, 0.0);
    }
}
