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
    if rel.is_empty() {
        return crate::maps::protocol::status(StatusCode::NOT_FOUND);
    }
    let Some(root) = art_root(app) else {
        return crate::maps::protocol::status(StatusCode::NOT_FOUND);
    };
    // Path-traversal guard: the canonicalized target must stay under the art
    // root (mirrors handle_tile_cache; defeats symlink/`..` escapes).
    let path = root.join(rel);
    match (root.canonicalize(), path.canonicalize()) {
        (Ok(croot), Ok(cpath)) if cpath.starts_with(&croot) => {
            crate::maps::protocol::serve_file(&cpath, req)
        }
        _ => crate::maps::protocol::status(StatusCode::NOT_FOUND),
    }
}
