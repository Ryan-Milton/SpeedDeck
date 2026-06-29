//! Custom URI scheme handlers that serve map assets to the webview with HTTP
//! Range support — the PMTiles client relies on range reads. Replaces v1's
//! Electron `local-resource://` and `tile-cache://` protocol handlers.
//!
//! - `tiles://localhost/<rel>`      → bundled (resource dir) or downloaded
//!   (app data dir) files, e.g. `map/western-washington.pmtiles`.
//! - `tile-cache://localhost/<rel>` → cached vector tiles under the app data
//!   dir's `map-cache/` (path-traversal guarded).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

pub fn handle_tiles(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let rel = req.uri().path().trim_start_matches('/');
    match resolve_resource_or_data(app, rel) {
        Some(path) => serve_file(&path, req),
        None => status(StatusCode::NOT_FOUND),
    }
}

pub fn handle_tile_cache(app: &AppHandle, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let rel = req.uri().path().trim_start_matches('/');
    let Some(base) = cache_root(app) else {
        return status(StatusCode::NOT_FOUND);
    };
    let path = base.join(rel);
    // Path-traversal guard: the resolved file must live under the cache root.
    match (base.canonicalize(), path.canonicalize()) {
        (Ok(canon_base), Ok(canon_path)) if canon_path.starts_with(&canon_base) => {
            serve_file(&canon_path, req)
        }
        _ => status(StatusCode::NOT_FOUND),
    }
}

/// App data dir `map-cache/` — where the in-app downloader writes tiles.
pub fn cache_root(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("map-cache"))
}

/// First existing copy of `rel`, preferring bundled resources then app data.
/// Path-traversal guarded: the canonicalized target must stay under the root it
/// was resolved against (mirrors `handle_tile_cache`; defeats `..`/symlink/
/// percent-encoded escapes out of the resource or app-data dirs).
fn resolve_resource_or_data(app: &AppHandle, rel: &str) -> Option<PathBuf> {
    for root in [app.path().resource_dir(), app.path().app_data_dir()].into_iter().flatten() {
        let p = root.join(rel);
        if let (Ok(canon_root), Ok(canon_p)) = (root.canonicalize(), p.canonicalize()) {
            if canon_p.starts_with(&canon_root) && canon_p.is_file() {
                return Some(canon_p);
            }
        }
    }
    None
}

pub fn serve_file(path: &Path, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Ok(mut file) = File::open(path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(meta) = file.metadata() else {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    };
    let len = meta.len();
    let ctype = content_type(path);

    // Range request → 206 Partial Content.
    if let Some(range) = req.headers().get("range").and_then(|v| v.to_str().ok()) {
        if let Some((start, end)) = parse_range(range, len) {
            let mut buf = vec![0u8; (end - start + 1) as usize];
            if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buf).is_err() {
                return status(StatusCode::INTERNAL_SERVER_ERROR);
            }
            return Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header("Content-Type", ctype)
                .header("Accept-Ranges", "bytes")
                .header("Content-Range", format!("bytes {start}-{end}/{len}"))
                .header("Content-Length", (end - start + 1).to_string())
                .header("Access-Control-Allow-Origin", "*")
                .body(buf)
                .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR));
        }
    }

    // Full body.
    let mut buf = Vec::with_capacity(len as usize);
    if file.read_to_end(&mut buf).is_err() {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", ctype)
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", len.to_string())
        .header("Access-Control-Allow-Origin", "*")
        .body(buf)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

/// Parse an HTTP `Range` header (`bytes=start-end`, `bytes=start-`, `bytes=-suffix`).
fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    if len == 0 {
        return None;
    }
    let spec = header.strip_prefix("bytes=")?;
    let (s, e) = spec.split_once('-')?;
    let (start, end) = if s.trim().is_empty() {
        let n: u64 = e.trim().parse().ok()?;
        if n == 0 {
            return None;
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = s.trim().parse().ok()?;
        let end: u64 = if e.trim().is_empty() {
            len - 1
        } else {
            e.trim().parse::<u64>().ok()?.min(len - 1)
        };
        (start, end)
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("mvt") | Some("pbf") => "application/x-protobuf",
        Some("json") => "application/json",
        _ => "application/octet-stream", // .pmtiles and friends
    }
}

pub fn status(code: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(code)
        .header("Access-Control-Allow-Origin", "*")
        .body(Vec::new())
        .expect("static response")
}
