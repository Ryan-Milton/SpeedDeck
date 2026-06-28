//! GPX 1.1 export — ported from v1 `trip/gpx_export.py`.

use super::database::TripStore;

pub fn export_trip_gpx(store: &TripStore, trip_id: i64) -> Result<String, String> {
    let trip = store
        .get_trip(trip_id)?
        .ok_or_else(|| format!("Trip {trip_id} not found"))?;
    let points = store.get_trackpoints(trip_id)?;
    let name = trip.name.clone().unwrap_or_else(|| format!("Trip {trip_id}"));

    let mut s = String::new();
    s.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    s.push_str(
        "<gpx xmlns=\"http://www.topografix.com/GPX/1/1\" \
xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \
xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\" \
version=\"1.1\" creator=\"SpeedDeck\">\n",
    );
    s.push_str("  <metadata>\n");
    s.push_str(&format!("    <name>{}</name>\n", xml_escape(&name)));
    s.push_str(&format!("    <time>{}</time>\n", xml_escape(&trip.started_at)));
    s.push_str("  </metadata>\n");
    s.push_str("  <trk>\n");
    s.push_str(&format!("    <name>{}</name>\n", xml_escape(&name)));
    s.push_str("    <trkseg>\n");

    for p in &points {
        s.push_str(&format!(
            "      <trkpt lat=\"{:.7}\" lon=\"{:.7}\">\n",
            p.latitude, p.longitude
        ));
        if let Some(alt) = p.altitude {
            s.push_str(&format!("        <ele>{alt:.1}</ele>\n"));
        }
        s.push_str(&format!("        <time>{}</time>\n", xml_escape(&p.timestamp)));
        if p.speed.is_some() || p.heading.is_some() {
            s.push_str("        <extensions>\n");
            if let Some(sp) = p.speed {
                s.push_str(&format!("          <speed>{sp:.2}</speed>\n"));
            }
            if let Some(h) = p.heading {
                s.push_str(&format!("          <course>{h:.1}</course>\n"));
            }
            s.push_str("        </extensions>\n");
        }
        s.push_str("      </trkpt>\n");
    }

    s.push_str("    </trkseg>\n  </trk>\n</gpx>\n");
    Ok(s)
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
