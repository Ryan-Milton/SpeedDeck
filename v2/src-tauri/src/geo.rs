//! Geographic math — ported verbatim from v1 `utils/geo.py`.

pub const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// Great-circle distance in meters between two lat/lon points.
pub fn haversine_distance(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let lat1 = lat1.to_radians();
    let lat2 = lat2.to_radians();
    let dlat = lat2 - lat1;
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlon / 2.0).sin().powi(2);
    EARTH_RADIUS_M * 2.0 * a.sqrt().asin()
}

/// Distance in meters accounting for altitude when both endpoints have it.
/// Falls back to 2D haversine otherwise (matches v1 `distance_3d`).
pub fn distance_3d(
    lat1: f64,
    lon1: f64,
    alt1: Option<f64>,
    lat2: f64,
    lon2: f64,
    alt2: Option<f64>,
) -> f64 {
    let horiz = haversine_distance(lat1, lon1, lat2, lon2);
    match (alt1, alt2) {
        (Some(a1), Some(a2)) => {
            let dalt = a2 - a1;
            (horiz * horiz + dalt * dalt).sqrt()
        }
        _ => horiz,
    }
}

/// Initial bearing in degrees (0–360) from point 1 to point 2.
pub fn initial_bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let lat1 = lat1.to_radians();
    let lat2 = lat2.to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let x = dlon.sin() * lat2.cos();
    let y = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * dlon.cos();
    (x.atan2(y).to_degrees() + 360.0).rem_euclid(360.0)
}

/// 16-point cardinal abbreviation for a heading in degrees.
pub fn cardinal_direction(heading: f64) -> &'static str {
    const DIRECTIONS: [&str; 16] = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW",
        "NW", "NNW",
    ];
    let idx = ((heading / 22.5).round() as i64).rem_euclid(16) as usize;
    DIRECTIONS[idx]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_known_distance() {
        // ~1 degree of latitude is ~111 km.
        let d = haversine_distance(47.0, -122.0, 48.0, -122.0);
        assert!((d - 111_195.0).abs() < 500.0, "got {d}");
    }

    #[test]
    fn bearing_due_north_and_east() {
        assert!((initial_bearing(0.0, 0.0, 1.0, 0.0) - 0.0).abs() < 1e-6);
        assert!((initial_bearing(0.0, 0.0, 0.0, 1.0) - 90.0).abs() < 1e-6);
    }

    #[test]
    fn cardinal_wraps() {
        assert_eq!(cardinal_direction(0.0), "N");
        assert_eq!(cardinal_direction(360.0), "N");
        assert_eq!(cardinal_direction(90.0), "E");
        assert_eq!(cardinal_direction(45.0), "NE");
    }
}
