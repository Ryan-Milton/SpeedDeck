//! GPS vehicle provider (provider #1).
//!
//! Owns a serial NMEA line source, parses it into `RawFix`es, and pushes
//! normalized `VehicleSample`s into the `VehicleHub`. This is the first
//! implementor of `VehicleProvider`; OBD2 will be a second one later.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use super::nmea::NmeaParser;
use super::serial::spawn_serial_reader;
use super::{SampleSource, VehicleProvider, VehicleSample};

pub struct GpsProvider {
    pub port: String,
    pub baud: u32,
    pub update_hz: u32,
}

impl VehicleProvider for GpsProvider {
    fn name(&self) -> &'static str {
        "gps"
    }

    fn spawn(self: Box<Self>, tx: Sender<VehicleSample>, stop: Arc<AtomicBool>) {
        thread::spawn(move || {
            // The serial reader runs in its own thread feeding raw NMEA lines.
            let (line_tx, line_rx) = channel::<String>();
            spawn_serial_reader(self.port, self.baud, self.update_hz, line_tx, stop.clone());

            let mut parser = NmeaParser::new();
            while !stop.load(Ordering::SeqCst) {
                match line_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(line) => {
                        if let Some(fix) = parser.parse(&line) {
                            let sample = VehicleSample::from_raw(fix, SampleSource::Gps);
                            if tx.send(sample).is_err() {
                                break;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => continue,
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    }
}
