//! Route calculation via local OSRM HTTP API — ported from v1 `router.py`.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteManeuver {
    #[serde(rename = "type")]
    pub kind: String,
    pub modifier: Option<String>,
    pub location: [f64; 2],
    pub bearing_before: f64,
    pub bearing_after: f64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteStep {
    pub maneuver: RouteManeuver,
    pub name: String,
    pub distance: f64,
    pub duration: f64,
    pub geometry: Value,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteData {
    pub geometry: Value,
    pub distance: f64,
    pub duration: f64,
    pub steps: Vec<RouteStep>,
    pub maxspeeds: Vec<Option<f64>>,
}

/// Allowed bearing deviation (degrees) by speed; narrower when faster.
pub fn bearing_range(speed_mps: Option<f64>) -> i64 {
    match speed_mps {
        Some(s) if s >= 2.0 => {
            if s > 25.0 {
                30
            } else {
                (90.0 - (s - 2.0) * (60.0 / 23.0)).round() as i64
            }
        }
        _ => 180,
    }
}

/// Calculate a route via local OSRM and return parsed RouteData.
pub async fn calculate_route(
    from_lon: f64,
    from_lat: f64,
    to_lon: f64,
    to_lat: f64,
    heading: Option<f64>,
    speed: Option<f64>,
    port: u16,
) -> Result<RouteData, String> {
    let bearing_param = match (heading, speed) {
        (Some(h), Some(s)) if s >= 2.0 => {
            format!(
                "&bearings={},{};",
                (h.round() as i64).rem_euclid(360),
                bearing_range(Some(s))
            )
        }
        _ => String::new(),
    };

    let coords = format!("{from_lon},{from_lat};{to_lon},{to_lat}");
    let prefix = format!("http://127.0.0.1:{port}/route/v1/driving/{coords}");
    let base_params = "?steps=true&geometries=geojson&overview=full";
    let client = reqwest::Client::new();

    let mut data: Value = Value::Null;
    let mut base_url = String::new();

    // Try with maxspeed annotations first; drop them if OSRM 400s on it.
    for ann in ["duration,distance,maxspeed", "duration,distance"] {
        base_url = format!("{prefix}{base_params}&annotations={ann}");
        let url = format!("{base_url}{bearing_param}");
        let resp = client
            .get(&url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = resp.status();
        if status == 400 && ann.contains("maxspeed") {
            let body: Value = resp.json().await.unwrap_or(Value::Null);
            let msg = body.get("message").and_then(|m| m.as_str()).unwrap_or("");
            if msg.to_lowercase().contains("maxspeed") {
                continue; // retry without maxspeed
            }
            return Err(format!("OSRM returned 400: {msg}"));
        }
        if !status.is_success() {
            return Err(format!("OSRM request failed: HTTP {status}"));
        }
        data = resp.json().await.map_err(|e| e.to_string())?;
        break;
    }

    // Fallback: retry without the bearing constraint if no route was found.
    let no_route = data.get("code").and_then(|c| c.as_str()) != Some("Ok")
        || data
            .get("routes")
            .and_then(|r| r.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
    if no_route && !bearing_param.is_empty() {
        let resp = client
            .get(&base_url)
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("OSRM fallback failed: HTTP {}", resp.status()));
        }
        data = resp.json().await.map_err(|e| e.to_string())?;
    }

    parse_osrm(&data)
}

/// Parse an OSRM `/route` JSON response into RouteData (pure; unit-tested).
pub fn parse_osrm(data: &Value) -> Result<RouteData, String> {
    if data.get("code").and_then(|c| c.as_str()) != Some("Ok") {
        let code = data
            .get("code")
            .and_then(|c| c.as_str())
            .unwrap_or("unknown");
        return Err(format!("OSRM returned no route: {code}"));
    }
    let route = data
        .get("routes")
        .and_then(|r| r.as_array())
        .and_then(|a| a.first())
        .ok_or("OSRM response has no routes")?;

    let mut steps = Vec::new();
    let mut maxspeeds = Vec::new();

    if let Some(legs) = route.get("legs").and_then(|l| l.as_array()) {
        for leg in legs {
            if let Some(step_list) = leg.get("steps").and_then(|s| s.as_array()) {
                for step in step_list {
                    let m = step.get("maneuver").cloned().unwrap_or(Value::Null);
                    let loc = m.get("location").and_then(|v| v.as_array());
                    steps.push(RouteStep {
                        maneuver: RouteManeuver {
                            kind: m
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            modifier: m.get("modifier").and_then(|v| v.as_str()).map(String::from),
                            location: [
                                loc.and_then(|a| a.first())
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.0),
                                loc.and_then(|a| a.get(1))
                                    .and_then(|v| v.as_f64())
                                    .unwrap_or(0.0),
                            ],
                            bearing_before: m
                                .get("bearing_before")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0),
                            bearing_after: m
                                .get("bearing_after")
                                .and_then(|v| v.as_f64())
                                .unwrap_or(0.0),
                        },
                        name: step
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        distance: step.get("distance").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        duration: step.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        geometry: step
                            .get("geometry")
                            .cloned()
                            .unwrap_or_else(|| json!({"type":"LineString","coordinates":[]})),
                    });
                }
            }
            if let Some(ms) = leg
                .get("annotation")
                .and_then(|a| a.get("maxspeed"))
                .and_then(|m| m.as_array())
            {
                for e in ms {
                    if let Some(sp) = e.get("speed").and_then(|v| v.as_f64()) {
                        let kmh = if e.get("unit").and_then(|u| u.as_str()) == Some("mph") {
                            sp * 1.60934
                        } else {
                            sp
                        };
                        maxspeeds.push(Some((kmh * 10.0).round() / 10.0));
                    } else {
                        maxspeeds.push(None);
                    }
                }
            }
        }
    }

    Ok(RouteData {
        geometry: route
            .get("geometry")
            .cloned()
            .unwrap_or_else(|| json!({"type":"LineString","coordinates":[]})),
        distance: route
            .get("distance")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        duration: route
            .get("duration")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.0),
        steps,
        maxspeeds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearing_range_by_speed() {
        assert_eq!(bearing_range(None), 180);
        assert_eq!(bearing_range(Some(1.0)), 180);
        assert_eq!(bearing_range(Some(2.0)), 90);
        assert_eq!(bearing_range(Some(25.0)), 30);
        assert_eq!(bearing_range(Some(40.0)), 30);
        let mid = bearing_range(Some(13.5)); // halfway → ~60
        assert!((mid - 60).abs() <= 1);
    }

    #[test]
    fn parse_osrm_maps_steps_and_maxspeed() {
        let data = json!({
            "code": "Ok",
            "routes": [{
                "geometry": {"type":"LineString","coordinates":[[-122.34,47.6],[-122.33,47.6]]},
                "distance": 1234.5,
                "duration": 120.0,
                "legs": [{
                    "steps": [
                        {"name":"Pine St","distance":100.0,"duration":12.0,
                         "geometry":{"type":"LineString","coordinates":[]},
                         "maneuver":{"type":"depart","location":[-122.34,47.6],"bearing_before":0,"bearing_after":90}},
                        {"name":"5th Ave","distance":200.0,"duration":24.0,
                         "geometry":{"type":"LineString","coordinates":[]},
                         "maneuver":{"type":"turn","modifier":"left","location":[-122.33,47.6],"bearing_before":90,"bearing_after":0}}
                    ],
                    "annotation": {"maxspeed":[{"speed":30,"unit":"mph"},{"none":true},{"unknown":true}]}
                }]
            }]
        });
        let r = parse_osrm(&data).unwrap();
        assert_eq!(r.steps.len(), 2);
        assert_eq!(r.steps[1].maneuver.kind, "turn");
        assert_eq!(r.steps[1].maneuver.modifier.as_deref(), Some("left"));
        assert!((r.distance - 1234.5).abs() < 1e-6);
        // 30 mph → 48.3 km/h
        assert_eq!(r.maxspeeds.len(), 3);
        assert!((r.maxspeeds[0].unwrap() - 48.3).abs() < 0.05);
        assert!(r.maxspeeds[1].is_none());
        assert!(r.maxspeeds[2].is_none());
    }

    #[test]
    fn parse_osrm_errors_on_no_route() {
        assert!(parse_osrm(&json!({"code":"NoRoute"})).is_err());
    }
}
