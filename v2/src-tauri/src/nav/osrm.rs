//! OSRM engine lifecycle — ported from v1 `osrm_manager.py` (run/stop + readiness
//! poll only; graph building stays off-device). Runs the bundled `osrm-routed`
//! sidecar against an installed region graph.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

pub const OSRM_PORT: u16 = 5001;

#[derive(Clone)]
pub struct OsrmManager {
    running: Arc<AtomicBool>,
    region: Arc<Mutex<Option<String>>>,
    child: Arc<Mutex<Option<CommandChild>>>,
    pub port: u16,
}

impl Default for OsrmManager {
    fn default() -> Self {
        OsrmManager {
            running: Arc::new(AtomicBool::new(false)),
            region: Arc::new(Mutex::new(None)),
            child: Arc::new(Mutex::new(None)),
            port: OSRM_PORT,
        }
    }
}

impl OsrmManager {
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub fn region(&self) -> Option<String> {
        self.region.lock().unwrap().clone()
    }

    /// Spawn `osrm-routed --algorithm=MLD` for the given region's `.osrm` file and
    /// poll until the HTTP endpoint responds. Replaces any running instance.
    pub async fn start(
        &self,
        app: &AppHandle,
        region_id: &str,
        osrm_file: &std::path::Path,
    ) -> Result<(), String> {
        if !osrm_file.is_file() {
            return Err(format!("OSRM graph not found: {}", osrm_file.display()));
        }
        self.stop();

        let sidecar = app
            .shell()
            .sidecar("osrm-routed")
            .map_err(|e| format!("sidecar not available: {e}"))?;
        let (mut rx, child) = sidecar
            .args([
                "--algorithm=MLD".to_string(),
                format!("--port={}", self.port),
                osrm_file.to_string_lossy().to_string(),
            ])
            .spawn()
            .map_err(|e| format!("failed to start osrm-routed: {e}"))?;

        *self.child.lock().unwrap() = Some(child);
        // Drain the event stream so the pipe never blocks the child.
        tauri::async_runtime::spawn(async move { while rx.recv().await.is_some() {} });

        // Readiness: any HTTP response means the engine is up (root returns 400).
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:{}/", self.port);
        for _ in 0..30 {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if client.get(&url).timeout(Duration::from_secs(2)).send().await.is_ok() {
                self.running.store(true, Ordering::SeqCst);
                *self.region.lock().unwrap() = Some(region_id.to_string());
                return Ok(());
            }
        }
        self.stop();
        Err("osrm-routed did not become ready in 15s".into())
    }

    pub fn stop(&self) {
        if let Some(child) = self.child.lock().unwrap().take() {
            let _ = child.kill();
        }
        self.running.store(false, Ordering::SeqCst);
        *self.region.lock().unwrap() = None;
    }
}
