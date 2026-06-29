//! Map data: offline PMTiles serving, in-app tile downloader, region catalog.

pub mod downloader;
pub mod protocol;
pub mod tilemath;

use std::fs;
use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use downloader::{DownloadManager, DownloadProgress};
use tilemath::{estimate, BBox, TileEstimate};

/// Bundled region PMTiles, searched under `resources/map/` then app-data `map/`.
/// Order = preference for the default offline basemap.
const BUNDLED_PMTILES: [&str; 2] = ["map/western-washington.pmtiles", "map/seattle.pmtiles"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionInfo {
    pub id: String,
    pub name: String,
    pub file: String,
    pub installed: bool,
}

fn exists_resource_or_data(app: &AppHandle, rel: &str) -> bool {
    if let Ok(res) = app.path().resource_dir() {
        if res.join(rel).is_file() {
            return true;
        }
    }
    if let Ok(data) = app.path().app_data_dir() {
        if data.join(rel).is_file() {
            return true;
        }
    }
    false
}

/// URL for the default offline PMTiles basemap (first installed region), or null.
#[tauri::command]
pub fn default_pmtiles_url(app: AppHandle) -> Option<String> {
    BUNDLED_PMTILES
        .iter()
        .find(|rel| exists_resource_or_data(&app, rel))
        .map(|rel| format!("tiles://localhost/{rel}"))
}

#[tauri::command]
pub fn estimate_tile_download(bbox: BBox, min_zoom: u8, max_zoom: u8) -> TileEstimate {
    estimate(&bbox, min_zoom, max_zoom)
}

#[tauri::command]
pub fn start_tile_download(
    app: AppHandle,
    mgr: State<'_, DownloadManager>,
    bbox: BBox,
    min_zoom: u8,
    max_zoom: u8,
) -> Result<(), String> {
    let cache_dir = protocol::cache_root(&app).ok_or("no app data dir")?;
    mgr.start(app.clone(), cache_dir, bbox, min_zoom, max_zoom)
}

#[tauri::command]
pub fn cancel_tile_download(mgr: State<'_, DownloadManager>) {
    mgr.cancel();
}

#[tauri::command]
pub fn download_progress(mgr: State<'_, DownloadManager>) -> DownloadProgress {
    mgr.progress()
}

#[tauri::command]
pub fn tiles_exist(app: AppHandle) -> bool {
    protocol::cache_root(&app)
        .map(|root| {
            let tiles = root.join("tiles");
            tiles.is_dir() && dir_has_files(&tiles)
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn cache_size(app: AppHandle) -> u64 {
    protocol::cache_root(&app).map(|r| dir_size(&r)).unwrap_or(0)
}

#[tauri::command]
pub fn delete_cached_tiles(app: AppHandle) -> Result<(), String> {
    if let Some(root) = protocol::cache_root(&app) {
        if root.exists() {
            fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_regions(app: AppHandle) -> Vec<RegionInfo> {
    BUNDLED_PMTILES
        .iter()
        .map(|rel| {
            let id = rel
                .trim_start_matches("map/")
                .trim_end_matches(".pmtiles")
                .to_string();
            RegionInfo {
                name: pretty_name(&id),
                installed: exists_resource_or_data(&app, rel),
                file: (*rel).to_string(),
                id,
            }
        })
        .collect()
}

fn pretty_name(id: &str) -> String {
    id.split('-')
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn dir_has_files(p: &Path) -> bool {
    if let Ok(rd) = fs::read_dir(p) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_file() {
                return true;
            }
            if path.is_dir() && dir_has_files(&path) {
                return true;
            }
        }
    }
    false
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
