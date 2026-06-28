//! NMEA 0183 parsing — ported from v1 `gps/nmea_parser.py`.
//!
//! Accumulates GGA + RMC (+ VTG) data into unified `RawFix` snapshots and emits
//! a fix after every RMC (which carries position + speed), exactly like v1.
//! A small hand-rolled parser is used instead of a crate so the VTG-preferred
//! ground-speed quirk and the emit-on-RMC cadence stay byte-for-byte faithful.

const KNOTS_TO_MPS: f64 = 0.514444;

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
    latitude: f64,
    longitude: f64,
    altitude: Option<f64>,
    satellites: u32,
    fix_quality: u8,
    hdop: Option<f64>,
    speed_mps: f64,
    vtg_speed: Option<f64>,
    heading: f64,
    has_rmc: bool,
}

impl NmeaParser {
    pub fn new() -> Self {
        Self::default()
    }

    /// Parse one NMEA sentence. Returns a `RawFix` once an RMC completes a cycle.
    pub fn parse(&mut self, sentence: &str) -> Option<RawFix> {
        let body = validate_checksum(sentence)?;
        let fields: Vec<&str> = body.split(',').collect();
        let kind = *fields.first()?;
        if kind.len() < 3 {
            return None;
        }
        // Talker-agnostic: match the last three chars (GPGGA, GNGGA, ...).
        match &kind[kind.len() - 3..] {
            "GGA" => self.handle_gga(&fields),
            "RMC" => self.handle_rmc(&fields),
            "VTG" => self.handle_vtg(&fields),
            _ => return None,
        }

        // Emit a fix after every RMC; reset the per-cycle VTG cache.
        if self.has_rmc {
            self.has_rmc = false;
            let fix = self.build_fix();
            self.vtg_speed = None;
            Some(fix)
        } else {
            None
        }
    }

    fn handle_gga(&mut self, f: &[&str]) {
        if let (Some(lat), Some(lon)) = (
            parse_coord(f.get(2).copied(), f.get(3).copied()),
            parse_coord(f.get(4).copied(), f.get(5).copied()),
        ) {
            self.latitude = lat;
            self.longitude = lon;
        }
        if let Some(alt) = f.get(9).and_then(|v| parse_f64(v)) {
            self.altitude = Some(alt);
        }
        if let Some(n) = f.get(7).and_then(|v| parse_f64(v)) {
            self.satellites = n as u32;
        }
        if let Some(q) = f.get(6).and_then(|v| parse_f64(v)) {
            self.fix_quality = q as u8;
        }
        if let Some(h) = f.get(8).and_then(|v| parse_f64(v)) {
            self.hdop = Some(h);
        }
    }

    fn handle_rmc(&mut self, f: &[&str]) {
        self.has_rmc = true;
        if let (Some(lat), Some(lon)) = (
            parse_coord(f.get(3).copied(), f.get(4).copied()),
            parse_coord(f.get(5).copied(), f.get(6).copied()),
        ) {
            self.latitude = lat;
            self.longitude = lon;
        }
        if let Some(spd) = f.get(7).and_then(|v| parse_f64(v)) {
            // Prefer VTG ground speed when available (more reliable on some chipsets).
            self.speed_mps = match self.vtg_speed {
                Some(v) => v,
                None => spd * KNOTS_TO_MPS,
            };
        }
        if let Some(course) = f.get(8).and_then(|v| parse_f64(v)) {
            self.heading = course;
        }
    }

    fn handle_vtg(&mut self, f: &[&str]) {
        // VTG field 7 is ground speed in km/h.
        if let Some(kmh) = f.get(7).and_then(|v| parse_f64(v)) {
            self.vtg_speed = Some(kmh / 3.6);
        }
    }

    fn build_fix(&self) -> RawFix {
        RawFix {
            latitude: self.latitude,
            longitude: self.longitude,
            altitude: self.altitude,
            speed_mps: self.speed_mps,
            heading: self.heading,
            satellites: self.satellites,
            fix_quality: self.fix_quality,
            hdop: self.hdop,
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
        t.parse().ok()
    }
}

/// Parse an NMEA coordinate (ddmm.mmmm / dddmm.mmmm + hemisphere) to decimal
/// degrees. Mirrors v1, which skips zero/empty values.
fn parse_coord(val: Option<&str>, dir: Option<&str>) -> Option<f64> {
    let v = parse_f64(val?)?;
    if v == 0.0 {
        return None;
    }
    let deg = (v / 100.0).trunc();
    let min = v - deg * 100.0;
    let mut dec = deg + min / 60.0;
    if matches!(dir.map(str::trim), Some("S") | Some("W")) {
        dec = -dec;
    }
    Some(dec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rmc_emits_fix_with_knots_speed() {
        let mut p = NmeaParser::new();
        // 10 knots ~= 5.14444 m/s, heading 84.4, near Seattle.
        let line = with_checksum("GPRMC,123519,A,4736.372,N,12219.926,W,10.0,84.4,230394,,");
        let fix = p.parse(&line).expect("RMC should emit a fix");
        assert!((fix.speed_mps - 10.0 * KNOTS_TO_MPS).abs() < 1e-6);
        assert!((fix.heading - 84.4).abs() < 1e-6);
        assert!(fix.latitude > 47.0 && fix.latitude < 48.0);
        assert!(fix.longitude < -122.0 && fix.longitude > -123.0);
    }

    #[test]
    fn vtg_overrides_rmc_speed() {
        let mut p = NmeaParser::new();
        let vtg = with_checksum("GPVTG,84.4,T,,M,10.0,N,55.5,K,A");
        assert!(p.parse(&vtg).is_none());
        let rmc = with_checksum("GPRMC,123519,A,4736.372,N,12219.926,W,10.0,84.4,230394,,");
        let fix = p.parse(&rmc).unwrap();
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
        assert!(p.parse(&corrupted).is_none());
        // Non-hex checksum is also rejected.
        assert!(p.parse(&format!("${body}*ZZ")).is_none());
    }

    fn with_checksum(body: &str) -> String {
        let cs = body.bytes().fold(0u8, |a, b| a ^ b);
        format!("${body}*{cs:02X}")
    }
}
