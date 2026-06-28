//! Place search — ported from v1 `geocoder.py`: offline FTS5 + Nominatim fallback.

use std::cmp::Ordering;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;

const EARTH_RADIUS_M: f64 = 6_371_000.0;
const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub name: String,
    pub category: String,
    pub latitude: f64,
    pub longitude: f64,
    pub importance: i64,
    pub distance: f64,
    pub source: Option<String>,
}

fn haversine(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (a1, o1, a2, o2) = (
        lat1.to_radians(),
        lon1.to_radians(),
        lat2.to_radians(),
        lon2.to_radians(),
    );
    let dlat = a2 - a1;
    let dlon = o2 - o1;
    let a = (dlat / 2.0).sin().powi(2) + a1.cos() * a2.cos() * (dlon / 2.0).sin().powi(2);
    EARTH_RADIUS_M * 2.0 * a.sqrt().asin()
}

/// FTS5 prefix search over the offline places index; empty if DB is missing.
pub fn fts_search(
    db_path: &Path,
    query: &str,
    near: Option<(f64, f64)>,
    limit: usize,
) -> Vec<SearchResult> {
    if !db_path.is_file() {
        return Vec::new();
    }
    let conn = match Connection::open_with_flags(db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let safe = query.trim().replace('"', "\"\"");
    let fts_query = format!("\"{safe}\"*");

    let mut stmt = match conn.prepare(
        "SELECT p.name, p.category, p.latitude, p.longitude, p.importance
         FROM places_fts JOIN places p ON places_fts.rowid = p.rowid
         WHERE places_fts MATCH ?1 LIMIT 50",
    ) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    let rows = stmt.query_map([fts_query], |r| {
        Ok(SearchResult {
            name: r.get(0)?,
            category: r.get(1)?,
            latitude: r.get(2)?,
            longitude: r.get(3)?,
            importance: r.get(4)?,
            distance: 0.0,
            source: None,
        })
    });
    let mut results: Vec<SearchResult> = match rows {
        Ok(it) => it.flatten().collect(),
        Err(_) => return Vec::new(),
    };

    if let Some((lat, lon)) = near {
        for r in &mut results {
            r.distance = haversine(lat, lon, r.latitude, r.longitude);
        }
    }
    results.sort_by(|a, b| {
        b.importance
            .cmp(&a.importance)
            .then(a.distance.partial_cmp(&b.distance).unwrap_or(Ordering::Equal))
    });
    results.truncate(limit);
    results
}

/// Map a Nominatim JSON array into SearchResults (pure; unit-tested).
pub fn map_nominatim(data: &Value, near: Option<(f64, f64)>) -> Vec<SearchResult> {
    let arr = match data.as_array() {
        Some(a) => a,
        None => return Vec::new(),
    };
    arr.iter()
        .filter_map(|item| {
            let name = item.get("display_name").and_then(|v| v.as_str())?.to_string();
            let lat = item.get("lat").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())?;
            let lon = item.get("lon").and_then(|v| v.as_str()).and_then(|s| s.parse().ok())?;
            let osm_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let category = match osm_type {
                "city" | "town" | "village" | "hamlet" => "city",
                "residential" | "primary" | "secondary" | "tertiary" => "road",
                _ => "address",
            };
            let distance = near.map(|(la, lo)| haversine(la, lo, lat, lon)).unwrap_or(0.0);
            Some(SearchResult {
                name,
                category: category.to_string(),
                latitude: lat,
                longitude: lon,
                importance: 15,
                distance,
                source: Some("online".to_string()),
            })
        })
        .collect()
}

/// Online Nominatim fallback. Returns empty on any failure.
pub async fn nominatim_search(query: &str, near: Option<(f64, f64)>) -> Vec<SearchResult> {
    let client = reqwest::Client::new();
    let mut req = client
        .get(NOMINATIM_URL)
        .header("User-Agent", "SpeedDeck/2.0")
        .query(&[("q", query), ("format", "json"), ("limit", "5"), ("addressdetails", "1")]);
    if let Some((lat, lon)) = near {
        let viewbox = format!("{},{},{},{}", lon - 0.5, lat - 0.5, lon + 0.5, lat + 0.5);
        req = req.query(&[("viewbox", viewbox.as_str()), ("bounded", "0")]);
    }
    match req.timeout(std::time::Duration::from_secs(5)).send().await {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(v) => map_nominatim(&v, near),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    }
}

/// Three-tier search: offline FTS5 → Nominatim → street-name retry (port of v1).
pub async fn search(
    db_path: &Path,
    query: &str,
    near: Option<(f64, f64)>,
    limit: usize,
) -> Vec<SearchResult> {
    if query.trim().len() < 2 {
        return Vec::new();
    }
    let local = fts_search(db_path, query, near, limit);
    if !local.is_empty() {
        return local;
    }
    let online = nominatim_search(query, near).await;
    if !online.is_empty() {
        return online.into_iter().take(limit).collect();
    }
    // Street-name fallback: strip a leading house number and retry offline.
    let trimmed = query.trim();
    if trimmed.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        if let Some((_, rest)) = trimmed.split_once(char::is_whitespace) {
            let retry = fts_search(db_path, rest.trim(), near, limit);
            if !retry.is_empty() {
                return retry;
            }
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_nominatim_categories_and_distance() {
        let data = json!([
            {"display_name":"Seattle, WA","lat":"47.6062","lon":"-122.3321","type":"city"},
            {"display_name":"Pike St","lat":"47.61","lon":"-122.34","type":"residential"},
            {"display_name":"123 Main","lat":"47.60","lon":"-122.33","type":"house"}
        ]);
        let near = Some((47.6062, -122.3321));
        let r = map_nominatim(&data, near);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0].category, "city");
        assert_eq!(r[1].category, "road");
        assert_eq!(r[2].category, "address");
        assert_eq!(r[0].source.as_deref(), Some("online"));
        assert!(r[1].distance > 0.0);
    }

    #[test]
    fn missing_db_returns_empty() {
        let r = fts_search(Path::new("/nonexistent/places.db"), "pike", None, 10);
        assert!(r.is_empty());
    }
}
