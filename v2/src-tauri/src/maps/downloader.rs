//! In-app tile downloader — ported from v1 `main/tile-downloader.ts`.
//!
//! Downloads Carto vector tiles for a bbox/zoom range into a slippy-map cache
//! under the app data dir, with a bounded worker pool, dedup-skip, cancellation,
//! and `tiles:download-progress` events.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::tilemath::{enumerate_tiles, BBox};

const TILE_SERVERS: [&str; 4] = [
    "https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-b.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-c.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
    "https://tiles-d.basemaps.cartocdn.com/vectortiles/carto.streets/v1",
];
const CONCURRENCY: usize = 6;

#[derive(Clone, Copy, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
    pub active: bool,
}

/// Shared, cloneable download state stored in Tauri managed state.
#[derive(Clone, Default)]
pub struct DownloadManager {
    progress: Arc<Mutex<DownloadProgress>>,
    cancel: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
}

impl DownloadManager {
    pub fn progress(&self) -> DownloadProgress {
        *self.progress.lock().unwrap()
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn is_active(&self) -> bool {
        self.active.load(Ordering::SeqCst)
    }

    /// Kick off a download. Returns Err if one is already running.
    pub fn start(
        &self,
        app: AppHandle,
        cache_dir: PathBuf,
        bbox: BBox,
        min_zoom: u8,
        max_zoom: u8,
    ) -> Result<(), String> {
        if self.active.swap(true, Ordering::SeqCst) {
            return Err("a tile download is already in progress".into());
        }
        self.cancel.store(false, Ordering::SeqCst);

        let tiles = Arc::new(enumerate_tiles(&bbox, min_zoom, max_zoom));
        *self.progress.lock().unwrap() = DownloadProgress {
            downloaded: 0,
            total: tiles.len() as u64,
            percent: 0,
            active: true,
        };

        let mgr = self.clone();
        tauri::async_runtime::spawn(async move {
            mgr.run(app, cache_dir, tiles).await;
        });
        Ok(())
    }

    async fn run(&self, app: AppHandle, cache_dir: PathBuf, tiles: Arc<Vec<(u8, i64, i64)>>) {
        let client = reqwest::Client::builder()
            .user_agent("SpeedDeck/2.0")
            .build()
            .unwrap_or_default();
        let idx = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::with_capacity(CONCURRENCY);
        for _ in 0..CONCURRENCY {
            let client = client.clone();
            let idx = idx.clone();
            let tiles = tiles.clone();
            let cache_dir = cache_dir.clone();
            let app = app.clone();
            let mgr = self.clone();
            handles.push(tauri::async_runtime::spawn(async move {
                loop {
                    if mgr.cancel.load(Ordering::SeqCst) {
                        break;
                    }
                    let i = idx.fetch_add(1, Ordering::SeqCst);
                    if i >= tiles.len() {
                        break;
                    }
                    let (z, x, y) = tiles[i];
                    let out_dir = cache_dir.join("tiles").join(z.to_string()).join(x.to_string());
                    let out_file = out_dir.join(format!("{y}.mvt"));

                    if !out_file.exists() {
                        let server = TILE_SERVERS[i % TILE_SERVERS.len()];
                        let url = format!("{server}/{z}/{x}/{y}.mvt");
                        if let Ok(resp) = client.get(&url).send().await {
                            if resp.status().is_success() {
                                if let Ok(bytes) = resp.bytes().await {
                                    let _ = std::fs::create_dir_all(&out_dir);
                                    let _ = std::fs::write(&out_file, &bytes);
                                }
                            }
                        }
                    }
                    mgr.bump(&app);
                }
            }));
        }
        for h in handles {
            let _ = h.await;
        }

        self.active.store(false, Ordering::SeqCst);
        let mut p = self.progress.lock().unwrap();
        p.active = false;
        let final_progress = *p;
        drop(p);
        let _ = app.emit("tiles:download-progress", final_progress);
    }

    fn bump(&self, app: &AppHandle) {
        let snapshot = {
            let mut p = self.progress.lock().unwrap();
            p.downloaded += 1;
            p.percent = if p.total > 0 {
                ((p.downloaded as f64 / p.total as f64) * 100.0).round() as u8
            } else {
                0
            };
            *p
        };
        let _ = app.emit("tiles:download-progress", snapshot);
    }
}
