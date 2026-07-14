//! NMEA 0183 parsing — ported from v1 `gps/nmea_parser.py`.
//!
//! Accumulates GGA + RMC (+ VTG) data into unified `RawFix` snapshots. An RMC
//! produces a fix only when it explicitly reports an active, valid position.
//! A small hand-rolled parser is used instead of a crate so the VTG-preferred
//! ground-speed quirk and the emit-on-RMC cadence stay byte-for-byte faithful.

use std::time::{Duration, Instant};

const KNOTS_TO_MPS: f64 = 0.514444;
const GGA_METADATA_MAX_AGE: Duration = Duration::from_secs(3);

/// A single parsed GPS measurement from a GGA+RMC sentence pair.
#[derive(Debug, Clone)]
pub struct RawFix {
    pub latitude: f64,
    pub longitude: f64,
    pub altitude: Option<f64>,
    pub speed_mps: f64,
    pub heading: f64,
    pub satellites: u32,
    pub fix_quality: u8,
    pub hdop: Option<f64>,
}

#[derive(Default)]
pub struct NmeaParser {
    gga: GgaData,
    vtg_speed: Option<f64>,
}

#[derive(Default)]
struct GgaData {
    altitude: Option<f64>,
    satellites: u32,
    fix_quality: u8,
    hdop: Option<f64>,
    updated_at: Option<Instant>,
}

/// The parser distinguishes an RMC that explicitly reports no valid fix from
/// sentences that simply do not complete a position sample.
pub enum ParseResult {
    Fix(RawFix),
    NoFix,
    Ignored,
}

impl NmeaParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse one NMEA sentence. Active RMC sentences with valid coordinates
    /// produce a fix; void or malformed RMC sentences produce `NoFix`.
    pub fn parse(&mut self, sentence: &str) -> ParseResult {
        self.parse_at(sentence, Instant::now())
    }

    pub fn parse_at(&mut self, sentence: &str, received_at: Instant) -> ParseResult {
        let Some(body) = validate_checksum(sentence) else {
            return ParseResult::Ignored;
        };
        let fields: Vec<&str> = body.split(',').collect();
        let Some(kind) = fields.first().copied() else {
            return ParseResult::Ignored;
        };
        if kind.len() < 3 {
            return ParseResult::Ignored;
        }
        // Talker-agnostic: match the last three chars (GPGGA, GNGGA, ...).
        match &kind[kind.len() - 3..] {
            "GGA" => {
                self.handle_gga(&fields, received_at);
                ParseResult::Ignored
            }
            "RMC" => {
                let result = self.handle_rmc(&fields, received_at);
                // VTG is cycle-local. GGA normally arrives less frequently than
                // RMC, so retain only fresh metadata across RMC epochs.
                self.vtg_speed = None;
                result
            }
            "VTG" => {
                self.handle_vtg(&fields);
                ParseResult::Ignored
            }
            _ => ParseResult::Ignored,
        }
    }

    fn handle_gga(&mut self, f: &[&str], received_at: Instant) {
        // A GGA sentence is one measurement. Missing or malformed fields must
        // clear that field rather than refreshing metadata from an older GGA.
        self.gga = GgaData {
            altitude: f.get(9).and_then(|value| parse_f64(value)),
            satellites: f.get(7).and_then(|value| parse_u32(value)).unwrap_or(0),
            fix_quality: f.get(6).and_then(|value| parse_u8(value)).unwrap_or(0),
            hdop: f.get(8).and_then(|value| parse_f64(value)),
            updated_at: Some(received_at),
        };
    }

    fn handle_rmc(&self, f: &[&str], received_at: Instant) -> ParseResult {
        if !matches!(f.get(2).map(|status| status.trim()), Some("A")) {
            return ParseResult::NoFix;
        }
        let (Some(latitude), Some(longitude)) = (
            parse_latitude(f.get(3).copied(), f.get(4).copied()),
            parse_longitude(f.get(5).copied(), f.get(6).copied()),
        ) else {
            return ParseResult::NoFix;
        };

        let speed_mps = self.vtg_speed.unwrap_or_else(|| {
            f.get(7).and_then(|speed| parse_f64(speed)).unwrap_or(0.0) * KNOTS_TO_MPS
        });
        let heading = f.get(8).and_then(|course| parse_f64(course)).unwrap_or(0.0);
        let fresh_gga = self.gga.updated_at.is_some_and(|updated| {
            received_at.saturating_duration_since(updated) <= GGA_METADATA_MAX_AGE
        });
        ParseResult::Fix(RawFix {
            latitude,
            longitude,
            altitude: fresh_gga.then_some(self.gga.altitude).flatten(),
            speed_mps,
            heading,
            satellites: if fresh_gga { self.gga.satellites } else { 0 },
            // An active RMC is itself a valid position even when the receiver
            // has not emitted a fresh GGA sentence during this epoch.
            fix_quality: if fresh_gga && self.gga.fix_quality > 0 {
                self.gga.fix_quality
            } else {
                1
            },
            hdop: fresh_gga.then_some(self.gga.hdop).flatten(),
        })
    }

    fn handle_vtg(&mut self, f: &[&str]) {
        // VTG field 7 is ground speed in km/h.
        if let Some(kmh) = f.get(7).and_then(|v| parse_f64(v)) {
            self.vtg_speed = Some(kmh / 3.6);
        }
    }
}

/// Validate the `*HH` XOR checksum; return the body between `$` and `*`.
fn validate_checksum(sentence: &str) -> Option<&str> {
    let s = sentence.trim().strip_prefix('$')?;
    let (body, cs) = s.split_once('*')?;
    let expected = u8::from_str_radix(cs.trim(), 16).ok()?;
    let actual = body.bytes().fold(0u8, |acc, b| acc ^ b);
    (actual == expected).then_some(body)
}

/// Parse a numeric field, treating empty/blank as absent.
fn parse_f64(v: &str) -> Option<f64> {
    let t = v.trim();
    if t.is_empty() {
        None
    } else {
        t.parse::<f64>().ok().filter(|value| value.is_finite())
    }
}

fn parse_u32(v: &str) -> Option<u32> {
    v.trim().parse().ok()
}

fn parse_u8(v: &str) -> Option<u8> {
    v.trim().parse().ok()
}

/// Parse an NMEA coordinate (ddmm.mmmm / dddmm.mmmm + hemisphere) to decimal
/// degrees, checking the expected hemisphere and coordinate bounds.
fn parse_coord(
    val: Option<&str>,
    dir: Option<&str>,
    positive: &str,
    negative: &str,
    max_deg: f64,
) -> Option<f64> {
    let v = parse_f64(val?)?;
    if !v.is_finite() || v < 0.0 {
        return None;
    }
    let deg = (v / 100.0).trunc();
    let min = v - deg * 100.0;
    if min >= 60.0 || deg > max_deg || (deg == max_deg && min != 0.0) {
        return None;
    }
    let mut dec = deg + min / 60.0;
    match dir?.trim() {
        value if value == positive => {}
        value if value == negative => dec = -dec,
        _ => return None,
    }
    Some(dec)
}

fn parse_latitude(val: Option<&str>, dir: Option<&str>) -> Option<f64> {
    parse_coord(val, dir, "N", "S", 90.0)
}

fn parse_longitude(val: Option<&str>, dir: Option<&str>) -> Option<f64> {
    parse_coord(val, dir, "E", "W", 180.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rmc_emits_fix_with_knots_speed() {
        let mut p = NmeaParser::new();
        // 10 knots ~= 5.14444 m/s, heading 84.4, near Seattle.
        let line = with_checksum("GPRMC,123519,A,4736.372,N,12219.926,W,10.0,84.4,230394,,");
        let ParseResult::Fix(fix) = p.parse(&line) else {
            panic!("RMC should emit a fix");
        };
        assert!((fix.speed_mps - 10.0 * KNOTS_TO_MPS).abs() < 1e-6);
        assert!((fix.heading - 84.4).abs() < 1e-6);
        assert!(fix.latitude > 47.0 && fix.latitude < 48.0);
        assert!(fix.longitude < -122.0 && fix.longitude > -123.0);
    }

    #[test]
    fn vtg_overrides_rmc_speed() {
        let mut p = NmeaParser::new();
        let vtg = with_checksum("GPVTG,84.4,T,,M,10.0,N,55.5,K,A");
        assert!(matches!(p.parse(&vtg), ParseResult::Ignored));
        let rmc = with_checksum("GPRMC,123519,A,4736.372,N,12219.926,W,10.0,84.4,230394,,");
        let ParseResult::Fix(fix) = p.parse(&rmc) else {
            panic!("RMC should emit a fix");
        };
        // 55.5 km/h / 3.6 = 15.4166 m/s, used instead of the RMC's 10 knots.
        assert!((fix.speed_mps - 55.5 / 3.6).abs() < 1e-6);
    }

    #[test]
    fn bad_checksum_rejected() {
        let mut p = NmeaParser::new();
        let body = "GPRMC,123519,A,4736.372,N,12219.926,W,10.0,84.4,230394,,";
        let real = body.bytes().fold(0u8, |a, b| a ^ b);
        // A checksum that is guaranteed to differ from the real one.
        let corrupted = format!("${body}*{:02X}", real ^ 0xFF);
        assert!(matches!(p.parse(&corrupted), ParseResult::Ignored));
        // Non-hex checksum is also rejected.
        assert!(matches!(
            p.parse(&format!("${body}*ZZ")),
            ParseResult::Ignored
        ));
    }

    #[test]
    fn void_rmc_does_not_emit_a_fix() {
        let mut p = NmeaParser::new();
        let line = with_checksum("GPRMC,123519,V,4736.372,N,12219.926,W,10.0,84.4,230394,,");
        assert!(matches!(p.parse(&line), ParseResult::NoFix));
    }

    #[test]
    fn active_rmc_without_valid_coordinates_does_not_emit_a_fix() {
        let mut p = NmeaParser::new();
        let missing = with_checksum("GPRMC,123519,A,,,,10.0,84.4,230394,,");
        assert!(matches!(p.parse(&missing), ParseResult::NoFix));

        let invalid = with_checksum("GPRMC,123519,A,4760.000,N,18100.000,E,10.0,84.4,230394,,");
        assert!(matches!(p.parse(&invalid), ParseResult::NoFix));
    }

    #[test]
    fn fresh_gga_metadata_survives_an_invalid_rmc() {
        let mut p = NmeaParser::new();
        let gga = with_checksum("GPGGA,123519,4736.372,N,12219.926,W,1,08,0.9,123.4,M,,M,,");
        let void = with_checksum("GPRMC,123519,V,,,,,0.0,0.0,230394,,");
        let active = with_checksum("GPRMC,123520,A,4736.372,N,12219.926,W,1.0,0.0,230394,,");

        assert!(matches!(p.parse(&gga), ParseResult::Ignored));
        assert!(matches!(p.parse(&void), ParseResult::NoFix));
        let ParseResult::Fix(fix) = p.parse(&active) else {
            panic!("active RMC should emit a fix");
        };
        assert_eq!(fix.altitude, Some(123.4));
        assert_eq!(fix.satellites, 8);
        assert_eq!(fix.fix_quality, 1);
    }

    #[test]
    fn malformed_gga_replaces_the_entire_metadata_snapshot() {
        let mut p = NmeaParser::new();
        let valid = with_checksum("GPGGA,123519,4736.372,N,12219.926,W,2,08,0.9,123.4,M,,M,,");
        let malformed = with_checksum("GPGGA,123520,4736.372,N,12219.926,W,bad,bad,bad,bad,M,,M,,");
        let rmc = with_checksum("GPRMC,123520,A,4736.372,N,12219.926,W,1.0,0.0,230394,,");

        assert!(matches!(p.parse(&valid), ParseResult::Ignored));
        assert!(matches!(p.parse(&malformed), ParseResult::Ignored));
        let ParseResult::Fix(fix) = p.parse(&rmc) else {
            panic!("active RMC should emit a fix");
        };
        assert_eq!(fix.altitude, None);
        assert_eq!(fix.satellites, 0);
        assert_eq!(fix.fix_quality, 1);
        assert_eq!(fix.hdop, None);
    }

    #[test]
    fn gga_age_uses_line_receipt_time() {
        let mut p = NmeaParser::new();
        let received_at = Instant::now();
        let gga = with_checksum("GPGGA,123519,4736.372,N,12219.926,W,1,08,0.9,123.4,M,,M,,");
        let rmc = with_checksum("GPRMC,123523,A,4736.372,N,12219.926,W,1.0,0.0,230394,,");

        assert!(matches!(
            p.parse_at(&gga, received_at),
            ParseResult::Ignored
        ));
        let ParseResult::Fix(fix) = p.parse_at(
            &rmc,
            received_at + GGA_METADATA_MAX_AGE + Duration::from_millis(1),
        ) else {
            panic!("active RMC should emit a fix");
        };
        assert_eq!(fix.altitude, None);
        assert_eq!(fix.satellites, 0);
        assert_eq!(fix.hdop, None);
    }

    fn with_checksum(body: &str) -> String {
        let cs = body.bytes().fold(0u8, |a, b| a ^ b);
        format!("${body}*{cs:02X}")
    }
}
