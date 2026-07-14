//! Fake GPS provider for development without hardware — ported from v1
//! `gps/simulator.py`. Generates GGA+RMC sentences following a drive cycle and
//! runs them through the real `NmeaParser`, so the whole GPS path is exercised
//! end-to-end. Random jitter is replaced with deterministic sine variation
//! (keeps it reproducible; the wobble is purely cosmetic).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::nmea::{NmeaParser, ParseResult};
use super::{
    send_sample, ReceiverStatus, SampleSource, VehicleEvent, VehicleProvider, VehicleSample,
};

const SEATTLE_LAT: f64 = 47.6062;
const SEATTLE_LON: f64 = -122.3321;
const KNOTS_TO_MPS: f64 = 0.514444;

pub struct SimulatorProvider {
    update_hz: f64,
}

impl SimulatorProvider {
    pub fn new() -> Self {
        SimulatorProvider { update_hz: 10.0 }
    }
}

impl Default for SimulatorProvider {
    fn default() -> Self {
        Self::new()
    }
}

struct SimState {
    lat: f64,
    lon: f64,
    heading: f64,
    speed_knots: f64,
    altitude: f64,
    satellites: u32,
    t: f64,
    interval: f64,
}

impl VehicleProvider for SimulatorProvider {
    fn name(&self) -> &'static str {
        "simulator"
    }

    fn spawn(self: Box<Self>, tx: SyncSender<VehicleEvent>, stop: Arc<AtomicBool>) {
        thread::spawn(move || {
            if tx
                .send(VehicleEvent::Health {
                    source: SampleSource::Simulator,
                    status: ReceiverStatus::Fix,
                })
                .is_err()
            {
                return;
            }
            let interval = 1.0 / self.update_hz;
            let mut st = SimState {
                lat: SEATTLE_LAT,
                lon: SEATTLE_LON,
                heading: 45.0,
                speed_knots: 0.0,
                altitude: 56.0,
                satellites: 12,
                t: 0.0,
                interval,
            };
            let mut parser = NmeaParser::new();

            while !stop.load(Ordering::SeqCst) {
                st.update();
                let gga = st.make_gga();
                let rmc = st.make_rmc();
                // Feed both through the parser; RMC completes a fix.
                parser.parse(&gga);
                if let ParseResult::Fix(fix) = parser.parse(&rmc) {
                    let sample = VehicleSample::from_raw(fix, SampleSource::Simulator);
                    if !send_sample(&tx, sample) {
                        break;
                    }
                }
                thread::sleep(Duration::from_secs_f64(interval));
            }
        });
    }
}

impl SimState {
    fn update(&mut self) {
        self.t += self.interval;

        // 60-second drive cycle: stop, accelerate, cruise, faster, decelerate.
        let cycle = self.t % 60.0;
        let target = if cycle < 5.0 {
            0.0
        } else if cycle < 15.0 {
            20.0
        } else if cycle < 40.0 {
            35.0 + 3.0 * (self.t * 0.7).sin()
        } else if cycle < 50.0 {
            50.0 + 2.0 * (self.t * 0.9).sin()
        } else {
            10.0
        };

        // Smooth speed transitions toward the target.
        self.speed_knots += (target - self.speed_knots) * 0.05;
        if self.speed_knots < 0.0 {
            self.speed_knots = 0.0;
        }

        // Gentle heading drift (simulates curves).
        self.heading += (self.t * 0.1).sin() * 0.5;
        self.heading = self.heading.rem_euclid(360.0);

        // Move position based on speed + heading.
        let speed_mps = self.speed_knots * KNOTS_TO_MPS;
        let dlat = speed_mps * self.heading.to_radians().cos() * self.interval / 111_320.0;
        let dlon = speed_mps * self.heading.to_radians().sin() * self.interval
            / (111_320.0 * self.lat.to_radians().cos());
        self.lat += dlat;
        self.lon += dlon;

        // Slight altitude variation.
        self.altitude += 0.1 * (self.t * 1.3).sin();
    }

    fn make_gga(&self) -> String {
        let (lat_s, lat_d) = format_lat(self.lat);
        let (lon_s, lon_d) = format_lon(self.lon);
        let body = format!(
            "GPGGA,000000.00,{lat_s},{lat_d},{lon_s},{lon_d},1,{sats:02},0.9,{alt:.1},M,-17.0,M,,",
            sats = self.satellites,
            alt = self.altitude,
        );
        with_checksum(&body)
    }

    fn make_rmc(&self) -> String {
        let (lat_s, lat_d) = format_lat(self.lat);
        let (lon_s, lon_d) = format_lon(self.lon);
        let body = format!(
            "GPRMC,000000.00,A,{lat_s},{lat_d},{lon_s},{lon_d},{spd:.1},{hdg:.1},010100,,,A",
            spd = self.speed_knots,
            hdg = self.heading,
        );
        with_checksum(&body)
    }
}

fn format_lat(lat: f64) -> (String, char) {
    let dir = if lat >= 0.0 { 'N' } else { 'S' };
    let lat = lat.abs();
    let deg = lat.trunc();
    let mins = (lat - deg) * 60.0;
    (format!("{:02}{:07.4}", deg as i64, mins), dir)
}

fn format_lon(lon: f64) -> (String, char) {
    let dir = if lon >= 0.0 { 'E' } else { 'W' };
    let lon = lon.abs();
    let deg = lon.trunc();
    let mins = (lon - deg) * 60.0;
    (format!("{:03}{:07.4}", deg as i64, mins), dir)
}

fn with_checksum(body: &str) -> String {
    let cs = body.bytes().fold(0u8, |acc, b| acc ^ b);
    format!("${body}*{cs:02X}")
}
