//! GPS vehicle provider (provider #1).
//!
//! Owns a serial NMEA line source, parses it into `RawFix`es, and pushes
//! normalized `VehicleSample`s into the `VehicleHub`. This is the first
//! implementor of `VehicleProvider`; OBD2 will be a second one later.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{sync_channel, RecvTimeoutError, SyncSender};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use super::nmea::{NmeaParser, ParseResult};
use super::serial::{spawn_serial_reader, SerialEvent};
use super::{send_sample, ReceiverStatus, SampleSource, VehicleEvent, VehicleProvider};

const STALE_FIX_AFTER: Duration = Duration::from_secs(3);

pub struct GpsProvider {
    pub port: Option<String>,
    pub port_is_override: bool,
    pub baud: u32,
    pub update_hz: u32,
}

impl VehicleProvider for GpsProvider {
    fn name(&self) -> &'static str {
        "gps"
    }

    fn spawn(self: Box<Self>, tx: SyncSender<VehicleEvent>, stop: Arc<AtomicBool>) {
        thread::spawn(move || {
            // The serial reader runs in its own thread feeding raw NMEA lines.
            let (line_tx, line_rx) = sync_channel::<SerialEvent>(64);
            spawn_serial_reader(
                self.port,
                self.port_is_override,
                self.baud,
                self.update_hz,
                line_tx,
                stop.clone(),
            );

            let mut parser = NmeaParser::new();
            let mut status = None;
            let mut last_fix = None;
            while !stop.load(Ordering::SeqCst) {
                match line_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(SerialEvent::Connected) => {
                        parser = NmeaParser::new();
                        last_fix = None;
                        if !publish_health(&tx, &mut status, ReceiverStatus::Connected) {
                            break;
                        }
                    }
                    Ok(SerialEvent::Disconnected) => {
                        parser = NmeaParser::new();
                        last_fix = None;
                        if !publish_health(&tx, &mut status, ReceiverStatus::Disconnected) {
                            break;
                        }
                    }
                    Ok(SerialEvent::Line {
                        sentence,
                        received_at,
                    }) => {
                        match parser.parse_at(&sentence, received_at) {
                            ParseResult::Fix(fix) => {
                                last_fix = Some(received_at);
                                if Instant::now().saturating_duration_since(received_at)
                                    >= STALE_FIX_AFTER
                                {
                                    if !publish_health(&tx, &mut status, ReceiverStatus::Stale) {
                                        break;
                                    }
                                    continue;
                                }
                                if !publish_health(&tx, &mut status, ReceiverStatus::Fix) {
                                    break;
                                }
                                if !send_sample(
                                    &tx,
                                    super::VehicleSample::from_raw(fix, SampleSource::Gps),
                                ) {
                                    break;
                                }
                            }
                            ParseResult::NoFix => {
                                if !publish_health(&tx, &mut status, ReceiverStatus::NoFix) {
                                    break;
                                }
                            }
                            ParseResult::Ignored => {}
                        }
                        if status == Some(ReceiverStatus::Fix)
                            && last_fix.is_some_and(|time| time.elapsed() >= STALE_FIX_AFTER)
                            && !publish_health(&tx, &mut status, ReceiverStatus::Stale)
                        {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if status == Some(ReceiverStatus::Fix)
                            && last_fix.is_some_and(|time| time.elapsed() >= STALE_FIX_AFTER)
                            && !publish_health(&tx, &mut status, ReceiverStatus::Stale)
                        {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });
    }
}

fn publish_health(
    tx: &SyncSender<VehicleEvent>,
    current: &mut Option<ReceiverStatus>,
    next: ReceiverStatus,
) -> bool {
    if *current == Some(next) {
        return true;
    }
    *current = Some(next);
    tx.send(VehicleEvent::Health {
        source: SampleSource::Gps,
        status: next,
    })
    .is_ok()
}
