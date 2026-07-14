//! In-app tile downloader - ported from v1 `main/tile-downloader.ts`.
//!
//! Downloads Carto vector tiles for a bbox/zoom range into a slippy-map cache
//! under the app data dir, with a bounded worker pool, cancellation, staging,
//! and `tiles:download-progress` events.

use std::fs;
use std::io::{Error, ErrorKind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::tilemath::{enumerate_tiles, BBox};

const TILE_SERVERS: [&str; 4] = [
    "https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
];
const TILE_SOURCE: &str = "carto.streets/v1";
const CONCURRENCY: usize = 6;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
const MAX_TILE_BYTES: usize = 2 * 1024 * 1024;
const CACHE_MANIFEST: &str = "complete.json";
const CACHE_VERSION: u8 = 2;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadStatus {
    #[default]
    Idle,
    Downloading,
    Completed,
    Cancelled,
    Error,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    /// Kept for frontend compatibility; this is the number attempted.
    pub downloaded: u64,
    pub attempted: u64,
    pub saved: u64,
    pub failed: u64,
    pub total: u64,
    pub percent: u8,
    pub active: bool,
    pub status: DownloadStatus,
    pub error: Option<String>,
}

/// Shared, cloneable download state stored in Tauri managed state.
#[derive(Clone, Default)]
pub struct DownloadManager {
    progress: Arc<Mutex<DownloadProgress>>,
    cancel: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    last_emit: Arc<Mutex<Option<Instant>>>,
    // Commands hold this gate for their full lifecycle operation. Workers only
    // use `completion`, so cancellation can wait without admitting a new start.
    operation_gate: Arc<Mutex<()>>,
    completion: Arc<(Mutex<()>, Condvar)>,
}

#[derive(Debug, Deserialize, Serialize)]
struct CacheManifest {
    version: u8,
    source: String,
    bbox: BBox,
    min_zoom: u8,
    max_zoom: u8,
    tile_count: u64,
}

pub fn has_complete_cache(cache_dir: &Path) -> bool {
    let Some(manifest) = fs::read(cache_dir.join(CACHE_MANIFEST))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<CacheManifest>(&bytes).ok())
    else {
        return false;
    };
    if manifest.version != CACHE_VERSION || manifest.source != TILE_SOURCE {
        return false;
    }
    let Ok(tiles) = enumerate_tiles(&manifest.bbox, manifest.min_zoom, manifest.max_zoom) else {
        return false;
    };
    if tiles.is_empty() || tiles.len() as u64 != manifest.tile_count {
        return false;
    }
    tiles.into_iter().all(|(z, x, y)| {
        is_valid_tile_file(
            &cache_dir
                .join("tiles")
                .join(z.to_string())
                .join(x.to_string())
                .join(format!("{y}.mvt")),
        )
    })
}

impl DownloadManager {
    pub fn progress(&self) -> DownloadProgress {
        self.progress
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub async fn start(
        &self,
        app: AppHandle,
        cache_dir: PathBuf,
        bbox: BBox,
        min_zoom: u8,
        max_zoom: u8,
    ) -> Result<(), String> {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || {
            manager.start_locked(app, cache_dir, bbox, min_zoom, max_zoom)
        })
        .await
        .map_err(|error| format!("tile lifecycle task failed: {error}"))?
    }

    pub async fn cancel(&self, cache_dir: PathBuf) -> Result<(), String> {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || manager.cancel_locked(&cache_dir))
            .await
            .map_err(|error| format!("tile lifecycle task failed: {error}"))?
    }

    pub async fn delete(&self, cache_dir: PathBuf) -> Result<(), String> {
        let manager = self.clone();
        tauri::async_runtime::spawn_blocking(move || manager.delete_locked(&cache_dir))
            .await
            .map_err(|error| format!("tile lifecycle task failed: {error}"))?
    }

    fn start_locked(
        &self,
        app: AppHandle,
        cache_dir: PathBuf,
        bbox: BBox,
        min_zoom: u8,
        max_zoom: u8,
    ) -> Result<(), String> {
        let _operation = self
            .operation_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if self.active.load(Ordering::SeqCst) {
            return Err("a tile download is already in progress".into());
        }
        let tiles = Arc::new(enumerate_tiles(&bbox, min_zoom, max_zoom)?);
        let staging_dir = staging_dir(&cache_dir);
        recover_published_cache(&cache_dir)?;
        remove_dir_if_exists(&staging_dir).map_err(|error| error.to_string())?;

        self.cancel.store(false, Ordering::SeqCst);
        *self
            .last_emit
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
        *self
            .progress
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = DownloadProgress {
            total: tiles.len() as u64,
            active: true,
            status: DownloadStatus::Downloading,
            ..DownloadProgress::default()
        };
        let completion_guard = self
            .completion
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.active.store(true, Ordering::SeqCst);
        drop(completion_guard);

        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            manager
                .run(app, cache_dir, staging_dir, bbox, min_zoom, max_zoom, tiles)
                .await;
        });
        Ok(())
    }

    fn cancel_locked(&self, cache_dir: &Path) -> Result<(), String> {
        let _operation = self
            .operation_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.stop_and_wait();
        remove_dir_if_exists(&staging_dir(cache_dir)).map_err(|error| error.to_string())
    }

    fn delete_locked(&self, cache_dir: &Path) -> Result<(), String> {
        let _operation = self
            .operation_gate
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.stop_and_wait();
        for dir in [
            cache_dir.to_path_buf(),
            staging_dir(cache_dir),
            backup_dir(cache_dir),
        ] {
            remove_dir_if_exists(&dir).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn stop_and_wait(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        let (lock, finished) = &*self.completion;
        let mut guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        while self.active.load(Ordering::SeqCst) {
            guard = finished
                .wait(guard)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    async fn run(
        &self,
        app: AppHandle,
        cache_dir: PathBuf,
        staging_dir: PathBuf,
        bbox: BBox,
        min_zoom: u8,
        max_zoom: u8,
        tiles: Arc<Vec<(u8, i64, i64)>>,
    ) {
        let result = self
            .download_and_publish(
                &app,
                &cache_dir,
                &staging_dir,
                bbox,
                min_zoom,
                max_zoom,
                tiles,
            )
            .await;

        let cancelled = self.cancel.load(Ordering::SeqCst);
        let completed = !cancelled && result.is_ok();
        if cancelled || result.is_err() {
            let _ = remove_dir_if_exists(&staging_dir);
        }
        let final_progress = {
            let mut progress = self
                .progress
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            finalize_progress(&mut progress, cancelled, result.err());
            progress.clone()
        };
        let _ = app.emit("tiles:download-progress", final_progress);
        if completed {
            let _ = app.emit("maps:source-changed", ());
        }

        let (lock, finished) = &*self.completion;
        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.active.store(false, Ordering::SeqCst);
        finished.notify_all();
    }

    async fn download_and_publish(
        &self,
        app: &AppHandle,
        cache_dir: &Path,
        staging_dir: &Path,
        bbox: BBox,
        min_zoom: u8,
        max_zoom: u8,
        tiles: Arc<Vec<(u8, i64, i64)>>,
    ) -> Result<(), String> {
        let client = reqwest::Client::builder()
            .user_agent("SpeedDeck/2.0")
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|error| format!("could not create tile HTTP client: {error}"))?;
        let idx = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::with_capacity(CONCURRENCY);

        for _ in 0..CONCURRENCY {
            let client = client.clone();
            let idx = idx.clone();
            let tiles = tiles.clone();
            let staging_dir = staging_dir.to_path_buf();
            let app = app.clone();
            let manager = self.clone();
            handles.push(tauri::async_runtime::spawn(async move {
                loop {
                    if manager.cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let i = idx.fetch_add(1, Ordering::SeqCst);
                    if i >= tiles.len() {
                        break;
                    }
                    let (z, x, y) = tiles[i];
                    let out_file = staging_dir
                        .join("tiles")
                        .join(z.to_string())
                        .join(x.to_string())
                        .join(format!("{y}.mvt"));
                    let server = TILE_SERVERS[i % TILE_SERVERS.len()];
                    let url = format!("{server}/{z}/{x}/{y}.mvt");
                    let saved = download_tile(&client, &url, &out_file).await.is_ok();
                    manager.bump(&app, saved);
                }
            }));
        }

        let mut worker_failed = false;
        for handle in handles {
            if handle.await.is_err() {
                worker_failed = true;
            }
        }
        if self.cancel.load(Ordering::SeqCst) {
            return Err("tile download cancelled".into());
        }
        let progress = self.progress();
        if worker_failed {
            return Err("a tile download worker stopped unexpectedly".into());
        }
        if progress.failed > 0 || progress.saved != progress.total {
            return Err(format!(
                "{} of {} tile downloads failed",
                progress.failed, progress.total
            ));
        }

        let manifest = CacheManifest {
            version: CACHE_VERSION,
            source: TILE_SOURCE.into(),
            bbox,
            min_zoom,
            max_zoom,
            tile_count: tiles.len() as u64,
        };
        write_manifest_atomic(staging_dir, &manifest).map_err(|error| error.to_string())?;
        if !has_complete_cache(staging_dir) {
            return Err("staged tile cache failed completion validation".into());
        }
        publish_staging(cache_dir, staging_dir).map_err(|error| error.to_string())
    }

    fn bump(&self, app: &AppHandle, saved: bool) {
        let snapshot = {
            let mut progress = self
                .progress
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            record_attempt(&mut progress, saved);
            progress.clone()
        };
        let mut last_emit = self
            .last_emit
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let should_emit = snapshot.attempted == snapshot.total
            || last_emit
                .as_ref()
                .map(|last| last.elapsed() >= PROGRESS_INTERVAL)
                .unwrap_or(true);
        if should_emit {
            *last_emit = Some(Instant::now());
            let _ = app.emit("tiles:download-progress", snapshot);
        }
    }

    #[cfg(test)]
    fn mark_finished(&self) {
        let (lock, finished) = &*self.completion;
        let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        self.active.store(false, Ordering::SeqCst);
        finished.notify_all();
    }
}

fn record_attempt(progress: &mut DownloadProgress, saved: bool) {
    progress.attempted += 1;
    progress.downloaded = progress.attempted;
    if saved {
        progress.saved += 1;
    } else {
        progress.failed += 1;
    }
    progress.percent = if progress.total > 0 {
        ((progress.saved as f64 / progress.total as f64) * 100.0).round() as u8
    } else {
        0
    };
}

fn finalize_progress(progress: &mut DownloadProgress, cancelled: bool, error: Option<String>) {
    progress.active = false;
    if cancelled {
        progress.status = DownloadStatus::Cancelled;
        progress.error = None;
    } else if let Some(error) = error {
        progress.status = DownloadStatus::Error;
        progress.error = Some(error);
    } else {
        progress.status = DownloadStatus::Completed;
        progress.percent = 100;
    }
}

async fn download_tile(client: &reqwest::Client, url: &str, path: &Path) -> Result<(), String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let bytes = read_tile_body(response).await?;
    write_tile_atomic(path, &bytes).map_err(|error| error.to_string())
}

async fn read_tile_body(mut response: reqwest::Response) -> Result<Vec<u8>, String> {
    if !response.status().is_success() {
        return Err(format!("tile server returned HTTP {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_TILE_BYTES as u64)
    {
        return Err(format!("tile body exceeds {MAX_TILE_BYTES} bytes"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_TILE_BYTES {
            return Err(format!("tile body exceeds {MAX_TILE_BYTES} bytes"));
        }
        bytes.extend_from_slice(&chunk);
    }
    if !is_valid_tile_bytes(&bytes) {
        return Err("tile body is empty or is not Mapbox vector tile data".into());
    }
    Ok(bytes)
}

fn is_valid_tile_bytes(bytes: &[u8]) -> bool {
    if bytes.is_empty() || bytes.len() > MAX_TILE_BYTES {
        return false;
    }
    let mut offset = 0;
    let mut layers = 0;
    while offset < bytes.len() {
        let Some(key) = read_varint(bytes, &mut offset) else {
            return false;
        };
        let field = key >> 3;
        let wire = (key & 7) as u8;
        if field == 3 && wire == 2 {
            let Some(layer) = read_length_delimited(bytes, &mut offset) else {
                return false;
            };
            if !is_valid_mvt_layer(layer) {
                return false;
            }
            layers += 1;
        } else if !skip_protobuf_field(bytes, &mut offset, wire) {
            return false;
        }
    }
    layers > 0
}

fn is_valid_mvt_layer(bytes: &[u8]) -> bool {
    let mut offset = 0;
    let mut has_name = false;
    let mut has_version = false;
    while offset < bytes.len() {
        let Some(key) = read_varint(bytes, &mut offset) else {
            return false;
        };
        let field = key >> 3;
        let wire = (key & 7) as u8;
        match (field, wire) {
            (1, 2) => {
                let Some(name) = read_length_delimited(bytes, &mut offset) else {
                    return false;
                };
                has_name = !name.is_empty() && std::str::from_utf8(name).is_ok();
            }
            (15, 0) => {
                let Some(version) = read_varint(bytes, &mut offset) else {
                    return false;
                };
                has_version = version > 0;
            }
            _ if skip_protobuf_field(bytes, &mut offset, wire) => {}
            _ => return false,
        }
    }
    has_name && has_version
}

fn read_varint(bytes: &[u8], offset: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for index in 0..10 {
        let byte = *bytes.get(*offset)?;
        *offset += 1;
        if index == 9 && byte > 1 {
            return None;
        }
        value |= ((byte & 0x7f) as u64) << (index * 7);
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

fn read_length_delimited<'a>(bytes: &'a [u8], offset: &mut usize) -> Option<&'a [u8]> {
    let length = usize::try_from(read_varint(bytes, offset)?).ok()?;
    let end = offset.checked_add(length)?;
    let value = bytes.get(*offset..end)?;
    *offset = end;
    Some(value)
}

fn skip_protobuf_field(bytes: &[u8], offset: &mut usize, wire: u8) -> bool {
    match wire {
        0 => read_varint(bytes, offset).is_some(),
        1 => advance(bytes, offset, 8),
        2 => read_length_delimited(bytes, offset).is_some(),
        5 => advance(bytes, offset, 4),
        _ => false,
    }
}

fn advance(bytes: &[u8], offset: &mut usize, length: usize) -> bool {
    let Some(end) = offset.checked_add(length) else {
        return false;
    };
    if end > bytes.len() {
        return false;
    }
    *offset = end;
    true
}

fn is_valid_tile_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_TILE_BYTES as u64 {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    is_valid_tile_bytes(&bytes)
}

fn write_tile_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if !is_valid_tile_bytes(bytes) {
        return Err(Error::new(
            ErrorKind::InvalidData,
            "invalid vector tile body",
        ));
    }
    let Some(parent) = path.parent() else {
        return Err(Error::new(ErrorKind::InvalidInput, "tile has no parent"));
    };
    fs::create_dir_all(parent)?;
    let temporary = path.with_extension("mvt.part");
    fs::write(&temporary, bytes)?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn write_manifest_atomic(cache_dir: &Path, manifest: &CacheManifest) -> std::io::Result<()> {
    fs::create_dir_all(cache_dir)?;
    let temporary = cache_dir.join("complete.json.part");
    let bytes =
        serde_json::to_vec(manifest).map_err(|error| Error::new(ErrorKind::InvalidData, error))?;
    fs::write(&temporary, bytes)?;
    if let Err(error) = fs::rename(&temporary, cache_dir.join(CACHE_MANIFEST)) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

fn publish_staging(cache_dir: &Path, staging_dir: &Path) -> std::io::Result<()> {
    let backup = backup_dir(cache_dir);
    remove_dir_if_exists(&backup)?;
    let had_published = cache_dir.exists();
    if had_published {
        fs::rename(cache_dir, &backup)?;
    }
    if let Err(error) = fs::rename(staging_dir, cache_dir) {
        if had_published {
            let _ = fs::rename(&backup, cache_dir);
        }
        return Err(error);
    }
    let _ = remove_dir_if_exists(&backup);
    Ok(())
}

fn recover_published_cache(cache_dir: &Path) -> Result<(), String> {
    let backup = backup_dir(cache_dir);
    if !cache_dir.exists() && backup.exists() {
        fs::rename(&backup, cache_dir).map_err(|error| error.to_string())?;
    } else if cache_dir.exists() {
        remove_dir_if_exists(&backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn staging_dir(cache_dir: &Path) -> PathBuf {
    sibling_dir(cache_dir, "staging")
}

fn backup_dir(cache_dir: &Path) -> PathBuf {
    sibling_dir(cache_dir, "backup")
}

fn sibling_dir(cache_dir: &Path, suffix: &str) -> PathBuf {
    let name = cache_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("map-cache");
    cache_dir.with_file_name(format!("{name}.{suffix}"))
}

fn remove_dir_if_exists(path: &Path) -> std::io::Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::thread;

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "speeddeck-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn one_tile_manifest() -> CacheManifest {
        CacheManifest {
            version: CACHE_VERSION,
            source: TILE_SOURCE.into(),
            bbox: BBox {
                min_lon: 0.0,
                min_lat: 0.0,
                max_lon: 0.0,
                max_lat: 0.0,
            },
            min_zoom: 0,
            max_zoom: 0,
            tile_count: 1,
        }
    }

    fn valid_tile() -> [u8; 7] {
        // Tile.layers = Layer { name: "x", version: 2 }.
        [0x1a, 0x05, 0x0a, 0x01, b'x', 0x78, 0x02]
    }

    #[test]
    fn failed_tile_is_counted_without_false_full_progress() {
        let mut progress = DownloadProgress {
            total: 2,
            active: true,
            status: DownloadStatus::Downloading,
            ..DownloadProgress::default()
        };
        record_attempt(&mut progress, true);
        record_attempt(&mut progress, false);
        assert_eq!(progress.downloaded, 2);
        assert_eq!(progress.attempted, 2);
        assert_eq!(progress.saved, 1);
        assert_eq!(progress.failed, 1);
        assert_eq!(progress.percent, 50);
        finalize_progress(&mut progress, false, Some("one tile failed".into()));
        assert_eq!(progress.status, DownloadStatus::Error);
        assert_eq!(progress.percent, 50);
        assert!(!progress.active);
        assert!(!is_valid_tile_bytes(b"<html>upstream error</html>"));
        assert!(!is_valid_tile_bytes(&[]));
    }

    #[test]
    fn cache_manifest_rejects_missing_empty_and_corrupt_tiles() {
        let root = temp_root("incomplete-map-cache-test");
        let tile = root.join("tiles/0/0/0.mvt");
        write_manifest_atomic(&root, &one_tile_manifest()).unwrap();
        assert!(!has_complete_cache(&root));

        fs::create_dir_all(tile.parent().unwrap()).unwrap();
        fs::write(&tile, []).unwrap();
        assert!(!has_complete_cache(&root));
        fs::write(&tile, b"not protobuf").unwrap();
        assert!(!has_complete_cache(&root));
        fs::write(&tile, valid_tile()).unwrap();
        assert!(has_complete_cache(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_coverage_must_match_all_requested_tiles() {
        let root = temp_root("map-cache-coverage-test");
        let mut manifest = one_tile_manifest();
        manifest.max_zoom = 1;
        manifest.tile_count = 2;
        write_manifest_atomic(&root, &manifest).unwrap();
        fs::create_dir_all(root.join("tiles/0/0")).unwrap();
        fs::write(root.join("tiles/0/0/0.mvt"), valid_tile()).unwrap();
        assert!(!has_complete_cache(&root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn delete_waits_for_cancelled_worker_before_removing_cache() {
        let root = temp_root("map-cache-delete-race-test");
        let staging = staging_dir(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("published"), b"old cache").unwrap();
        fs::create_dir_all(&staging).unwrap();

        let manager = DownloadManager::default();
        manager.active.store(true, Ordering::SeqCst);
        let worker_manager = manager.clone();
        let worker_staging = staging.clone();
        let (worker_started_tx, worker_started_rx) = mpsc::channel();
        let (finish_tx, finish_rx) = mpsc::channel();
        let worker = thread::spawn(move || {
            worker_started_tx.send(()).unwrap();
            finish_rx.recv().unwrap();
            fs::write(worker_staging.join("late-write"), b"in flight").unwrap();
            worker_manager.mark_finished();
        });
        worker_started_rx.recv().unwrap();

        let delete_manager = manager.clone();
        let delete_root = root.clone();
        let delete = thread::spawn(move || delete_manager.delete_locked(&delete_root));
        for _ in 0..100 {
            if manager.cancel.load(Ordering::SeqCst) {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        assert!(manager.cancel.load(Ordering::SeqCst));
        assert!(
            root.exists(),
            "published cache was removed before worker exit"
        );
        finish_tx.send(()).unwrap();
        worker.join().unwrap();
        delete.join().unwrap().unwrap();
        assert!(!root.exists());
        assert!(!staging.exists());
    }
}
