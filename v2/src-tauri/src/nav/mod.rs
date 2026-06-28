//! Navigation: OSRM routing, geocoding, and downloadable region packs.

pub mod geocoder;
pub mod osrm;
pub mod router;

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

pub use geocoder::SearchResult;
pub use osrm::OsrmManager;
pub use router::RouteData;

// --- paths ---

fn nav_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("nav"))
}
fn region_dir(app: &AppHandle, id: &str) -> Option<PathBuf> {
    nav_root(app).map(|r| r.join(id))
}
fn osrm_file(app: &AppHandle, id: &str) -> Option<PathBuf> {
    region_dir(app, id).map(|d| d.join("region.osrm"))
}
fn is_installed(app: &AppHandle, id: &str) -> bool {
    osrm_file(app, id).map(|p| p.is_file()).unwrap_or(false)
}

/// The places.db of the first installed region (used by geocoding).
fn installed_places_db(app: &AppHandle) -> PathBuf {
    for r in load_manifest(app) {
        if is_installed(app, &r.id) {
            if let Some(dir) = region_dir(app, &r.id) {
                return dir.join("places.db");
            }
        }
    }
    PathBuf::from("/nonexistent/places.db")
}

fn first_installed_region(app: &AppHandle) -> Option<String> {
    load_manifest(app).into_iter().map(|r| r.id).find(|id| is_installed(app, id))
}

// --- region manifest (resources/map/regions.json) ---

#[derive(Deserialize)]
struct ManifestFile {
    regions: Vec<ManifestRegion>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ManifestRegion {
    id: String,
    name: String,
    #[serde(default)]
    nav_pack_url: Option<String>,
}

fn load_manifest(app: &AppHandle) -> Vec<ManifestRegion> {
    let Ok(res) = app.path().resource_dir() else {
        return Vec::new();
    };
    let path = res.join("map/regions.json");
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<ManifestFile>(&text)
        .map(|m| m.regions)
        .unwrap_or_default()
}

// --- DTOs ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavStatus {
    pub router_running: bool,
    pub installed_region: Option<String>,
    pub port: u16,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavRegion {
    pub id: String,
    pub name: String,
    pub installed: bool,
    pub size_mb: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    region_id: String,
    step: String, // "download" | "extract" | "done" | "error"
    percent: u8,
}

// --- commands ---

#[tauri::command]
pub fn nav_status(app: AppHandle, osrm: State<'_, OsrmManager>) -> NavStatus {
    NavStatus {
        router_running: osrm.is_running(),
        installed_region: osrm.region().or_else(|| first_installed_region(&app)),
        port: osrm.port,
    }
}

#[tauri::command]
pub async fn calculate_route(
    osrm: State<'_, OsrmManager>,
    from_lon: f64,
    from_lat: f64,
    to_lon: f64,
    to_lat: f64,
    heading: Option<f64>,
    speed: Option<f64>,
) -> Result<RouteData, String> {
    let port = osrm.port;
    router::calculate_route(from_lon, from_lat, to_lon, to_lat, heading, speed, port).await
}

#[tauri::command]
pub async fn geocode_search(
    app: AppHandle,
    query: String,
    near_lat: Option<f64>,
    near_lon: Option<f64>,
) -> Result<Vec<SearchResult>, String> {
    let db = installed_places_db(&app);
    let near = match (near_lat, near_lon) {
        (Some(a), Some(o)) => Some((a, o)),
        _ => None,
    };
    Ok(geocoder::search(&db, &query, near, 10).await)
}

#[tauri::command]
pub fn nav_list_regions(app: AppHandle) -> Vec<NavRegion> {
    load_manifest(&app)
        .into_iter()
        .map(|r| {
            let installed = is_installed(&app, &r.id);
            let size_mb = region_dir(&app, &r.id)
                .filter(|_| installed)
                .map(|d| dir_size(&d) / 1024 / 1024)
                .unwrap_or(0);
            NavRegion { id: r.id, name: r.name, installed, size_mb }
        })
        .collect()
}

#[tauri::command]
pub async fn nav_download_region(
    app: AppHandle,
    osrm: State<'_, OsrmManager>,
    region_id: String,
) -> Result<(), String> {
    let region = load_manifest(&app)
        .into_iter()
        .find(|r| r.id == region_id)
        .ok_or("unknown region")?;
    let url = region
        .nav_pack_url
        .filter(|u| !u.is_empty())
        .ok_or("region has no navPackUrl (host a pack or sideload it)")?;
    let dir = region_dir(&app, &region_id).ok_or("no app data dir")?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let emit = |step: &str, percent: u8| {
        let _ = app.emit(
            "nav:download-progress",
            DownloadProgress { region_id: region_id.clone(), step: step.to_string(), percent },
        );
    };

    // Download the pack archive (zip of region.osrm* + places.db).
    emit("download", 0);
    let bytes = reqwest::Client::new()
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;
    let zip_path = dir.join("pack.zip");
    fs::write(&zip_path, &bytes).map_err(|e| e.to_string())?;

    // Extract.
    emit("extract", 0);
    let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    archive.extract(&dir).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&zip_path);

    // Start routing on the freshly installed region.
    if let Some(osrm_path) = osrm_file(&app, &region_id) {
        osrm.start(&app, &region_id, &osrm_path).await?;
    }
    emit("done", 100);
    let _ = app.emit("nav:status", nav_status(app.clone(), osrm));
    Ok(())
}

#[tauri::command]
pub fn nav_delete_region(
    app: AppHandle,
    osrm: State<'_, OsrmManager>,
    region_id: String,
) -> Result<(), String> {
    if osrm.region().as_deref() == Some(region_id.as_str()) {
        osrm.stop();
    }
    if let Some(dir) = region_dir(&app, &region_id) {
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Start the router for the first installed region (called at app startup).
pub async fn autostart(app: AppHandle, osrm: OsrmManager) {
    if let Some(id) = first_installed_region(&app) {
        if let Some(path) = osrm_file(&app, &id) {
            let _ = osrm.start(&app, &id, &path).await;
            let _ = app.emit(
                "nav:status",
                NavStatus {
                    router_running: osrm.is_running(),
                    installed_region: osrm.region(),
                    port: osrm.port,
                },
            );
        }
    }
}

fn dir_size(p: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = fs::read_dir(p) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(m) = path.metadata() {
                    total += m.len();
                }
            } else if path.is_dir() {
                total += dir_size(&path);
            }
        }
    }
    total
}
