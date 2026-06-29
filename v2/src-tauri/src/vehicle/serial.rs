//! Serial NMEA line reader — ported from v1 `gps/serial_reader.py`.
//!
//! Runs in a background thread: opens the serial port, configures the GPS update
//! rate (Airoha AG3335 `PAIR050`), and pushes raw `$...` NMEA lines to a channel.
//! On disconnect it retries with exponential backoff (1s → 10s) and re-detects
//! the port, matching v1's reconnect behavior.

use std::io::{BufRead, BufReader, ErrorKind};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serialport::SerialPort;

/// Spawn the serial reader thread. Lines are sent to `tx` until `stop` is set.
pub fn spawn_serial_reader(
    port: String,
    baud: u32,
    update_hz: u32,
    tx: Sender<String>,
    stop: Arc<AtomicBool>,
) {
    thread::spawn(move || {
        let mut current_port = port;
        let mut backoff = Duration::from_secs(1);
        let max_backoff = Duration::from_secs(10);

        while !stop.load(Ordering::SeqCst) {
            match serialport::new(current_port.as_str(), baud)
                .timeout(Duration::from_millis(1000))
                .open()
            {
                Ok(mut sp) => {
                    backoff = Duration::from_secs(1); // reset on successful connect
                    configure_update_rate(&mut *sp, update_hz);

                    let mut reader = BufReader::new(sp);
                    let mut buf = Vec::with_capacity(128);
                    while !stop.load(Ordering::SeqCst) {
                        buf.clear();
                        match reader.read_until(b'\n', &mut buf) {
                            Ok(0) => break, // EOF — device went away
                            Ok(_) => {
                                let line = String::from_utf8_lossy(&buf).trim().to_string();
                                if line.starts_with('$') && tx.send(line).is_err() {
                                    return; // consumer dropped
                                }
                            }
                            Err(ref e) if e.kind() == ErrorKind::TimedOut => continue,
                            Err(_) => break, // I/O error — reconnect
                        }
                    }
                }
                Err(_) => {
                    // Re-detect in case the device reappeared on another path.
                    if let Some(detected) = detect_port() {
                        if detected != current_port {
                            current_port = detected;
                            backoff = Duration::from_secs(1);
                        }
                    }
                    sleep_with_stop(&stop, backoff);
                    backoff = (backoff * 2).min(max_backoff);
                }
            }
        }
    });
}

/// Send the `PAIR050` command to set the position fix interval (10 Hz = 100 ms).
fn configure_update_rate(port: &mut dyn SerialPort, update_hz: u32) {
    let interval_ms = (1000 / update_hz.max(1)).max(100);
    let cmd = format!("PAIR050,{interval_ms}");
    let checksum = cmd.bytes().fold(0u8, |acc, b| acc ^ b);
    let sentence = format!("${cmd}*{checksum:02X}\r\n");
    let _ = port.write_all(sentence.as_bytes());
}

/// Sleep for `dur`, waking early if `stop` is set (checks every 100 ms).
fn sleep_with_stop(stop: &Arc<AtomicBool>, dur: Duration) {
    let step = Duration::from_millis(100);
    let mut remaining = dur;
    while remaining > Duration::ZERO && !stop.load(Ordering::SeqCst) {
        let s = step.min(remaining);
        thread::sleep(s);
        remaining = remaining.saturating_sub(s);
    }
}

/// Auto-detect a USB GNSS serial port (Linux paths first, then macOS-style).
pub fn detect_port() -> Option<String> {
    let ports = serialport::available_ports().ok()?;
    ports
        .into_iter()
        .map(|p| p.port_name)
        .find(|n| {
            n.contains("ttyUSB")
                || n.contains("ttyACM")
                || n.contains("usbserial")
                || n.contains("usbmodem")
                || n.contains("SLAB_USBtoUART")
        })
}
