//! `music-art://` scheme — serves cached album art from the app data dir.
//! Reuses the range-capable file server from `maps::protocol`.

use std::path::PathBuf;

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

pub fn art_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("music-cache/art"))
}

pub fn handle_album_art(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let rel = req.uri().path().trim_start_matches('/');
    if rel.is_empty() || rel.contains("..") {
        return crate::maps::protocol::status(StatusCode::FORBIDDEN);
    }
    match art_root(app) {
        Some(dir) => crate::maps::protocol::serve_file(&dir.join(rel), req),
        None => crate::maps::protocol::status(StatusCode::NOT_FOUND),
    }
}
