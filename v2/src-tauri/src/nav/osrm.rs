//! OSRM engine lifecycle. The sidecar is started only for route requests and
//! stopped after navigation has been inactive for a short period.

use std::future::Future;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

pub const OSRM_PORT: u16 = 5001;
const READY_ATTEMPTS: usize = 30;
const IDLE_STOP_DELAY: Duration = Duration::from_secs(120);
const TERMINATION_ATTEMPTS: usize = 50;
const LEASE_DRAIN_ATTEMPTS: usize = 300;

pub(crate) struct PreparedInstall {
    pub content_dir: PathBuf,
    pub staging_root: PathBuf,
}

pub struct RoutingLease {
    active: Arc<AtomicUsize>,
}

impl Drop for RoutingLease {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
    }
}

struct OsrmState {
    child: Option<CommandChild>,
    child_run_id: Option<u64>,
    region_id: Option<String>,
    next_run_id: u64,
    activity_id: u64,
    stopping_run_id: Option<u64>,
}

#[derive(Clone)]
pub struct OsrmManager {
    // This gate spans spawning, readiness polling, and stopping so two callers
    // cannot race each other through a port or child-process transition.
    state: Arc<tauri::async_runtime::Mutex<OsrmState>>,
    running: Arc<AtomicBool>,
    region: Arc<Mutex<Option<String>>>,
    failure: Arc<Mutex<Option<String>>>,
    exited_run_id: Arc<AtomicU64>,
    active_routes: Arc<AtomicUsize>,
    region_gate: Arc<tauri::async_runtime::Mutex<()>>,
    pub port: u16,
}

impl Default for OsrmManager {
    fn default() -> Self {
        Self {
            state: Arc::new(tauri::async_runtime::Mutex::new(OsrmState {
                child: None,
                child_run_id: None,
                region_id: None,
                next_run_id: 0,
                activity_id: 0,
                stopping_run_id: None,
            })),
            running: Arc::new(AtomicBool::new(false)),
            region: Arc::new(Mutex::new(None)),
            failure: Arc::new(Mutex::new(None)),
            exited_run_id: Arc::new(AtomicU64::new(0)),
            active_routes: Arc::new(AtomicUsize::new(0)),
            region_gate: Arc::new(tauri::async_runtime::Mutex::new(())),
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

    pub fn failure(&self) -> Option<String> {
        self.failure.lock().unwrap().clone()
    }

    /// Start a region if it is not already active. The port availability check
    /// happens before spawning so a response from an unrelated local process is
    /// never accepted as this sidecar's readiness signal.
    pub async fn start(
        &self,
        app: &AppHandle,
        region_id: &str,
        osrm_file: &std::path::Path,
    ) -> Result<RoutingLease, String> {
        let mut state = self.state.lock().await;
        self.reconcile_exit_locked(&mut state);
        if !osrm_file.is_file() {
            let error = format!("OSRM graph not found: {}", osrm_file.display());
            self.set_failure(&error);
            drop(state);
            self.emit_status(app);
            return Err(error);
        }
        if self.can_reuse_locked(&state, region_id) {
            let lease = self.acquire_lease();
            if !self.can_reuse_locked(&state, region_id) {
                drop(lease);
                self.reconcile_exit_locked(&mut state);
            } else {
                let activity_id = Self::touch_locked(&mut state);
                drop(state);
                self.schedule_idle_stop(app.clone(), activity_id);
                return Ok(lease);
            }
        }

        self.wait_for_routes_locked().await?;
        self.stop_locked(&mut state).await?;
        if let Err(error) = self.wait_for_port().await {
            self.set_failure(&error);
            drop(state);
            self.emit_status(app);
            return Err(error);
        }

        let sidecar = match app.shell().sidecar("osrm-routed") {
            Ok(sidecar) => sidecar,
            Err(error) => {
                let error = format!("sidecar not available: {error}");
                self.set_failure(&error);
                drop(state);
                self.emit_status(app);
                return Err(error);
            }
        };
        let (mut events, child) = match sidecar
            .args([
                "--algorithm=MLD".to_string(),
                "--ip=127.0.0.1".to_string(),
                format!("--port={}", self.port),
                osrm_file.to_string_lossy().to_string(),
            ])
            .spawn()
        {
            Ok(process) => process,
            Err(error) => {
                let error = format!("failed to start osrm-routed: {error}");
                self.set_failure(&error);
                drop(state);
                self.emit_status(app);
                return Err(error);
            }
        };

        state.next_run_id += 1;
        let run_id = state.next_run_id;
        state.child_run_id = Some(run_id);
        state.region_id = Some(region_id.to_string());
        state.stopping_run_id = None;
        state.child = Some(child);
        self.exited_run_id.store(0, Ordering::SeqCst);
        let watcher = self.clone();
        let watcher_app = app.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Some(CommandEvent::Terminated(status)) => {
                        watcher.exited_run_id.store(run_id, Ordering::SeqCst);
                        watcher
                            .record_exit(
                                &watcher_app,
                                run_id,
                                format!("osrm-routed exited: {status:?}",),
                            )
                            .await;
                        break;
                    }
                    Some(CommandEvent::Error(error)) => {
                        watcher.set_failure(&format!(
                            "osrm-routed event stream error for run {run_id}: {error}"
                        ));
                        watcher.emit_status(&watcher_app);
                    }
                    Some(_) => {}
                    None => {
                        watcher.set_failure(&format!(
                            "osrm-routed event stream closed without termination confirmation for run {run_id}; process remains tracked"
                        ));
                        watcher.emit_status(&watcher_app);
                        break;
                    }
                }
            }
        });

        for _ in 0..READY_ATTEMPTS {
            tokio::time::sleep(Duration::from_millis(500)).await;
            if self.exited_run_id.load(Ordering::SeqCst) == run_id {
                let error = "osrm-routed exited before becoming ready".to_string();
                self.clear_run_locked(&mut state);
                self.set_failure(&error);
                drop(state);
                self.emit_status(app);
                return Err(error);
            }
            if self.is_osrm_ready().await {
                if self.exited_run_id.load(Ordering::SeqCst) == run_id {
                    let error = "osrm-routed exited before becoming ready".to_string();
                    self.clear_run_locked(&mut state);
                    self.set_failure(&error);
                    drop(state);
                    self.emit_status(app);
                    return Err(error);
                }
                self.running.store(true, Ordering::SeqCst);
                *self.region.lock().unwrap() = Some(region_id.to_string());
                *self.failure.lock().unwrap() = None;
                let lease = self.acquire_lease();
                let activity_id = Self::touch_locked(&mut state);
                drop(state);
                self.schedule_idle_stop(app.clone(), activity_id);
                self.emit_status(app);
                return Ok(lease);
            }
        }

        let error = "osrm-routed did not become ready in 15s".to_string();
        let stop_error = self.stop_locked(&mut state).await.err();
        let error = match stop_error {
            Some(stop_error) => format!("{error}; {stop_error}"),
            None => error,
        };
        self.set_failure(&error);
        drop(state);
        self.emit_status(app);
        Err(error)
    }

    pub async fn stop(&self) {
        let mut state = self.state.lock().await;
        let result = match self.wait_for_routes_locked().await {
            Ok(()) => self.stop_locked(&mut state).await,
            Err(error) => Err(error),
        };
        if let Err(error) = result {
            self.set_failure(&error);
            eprintln!("failed to stop osrm-routed: {error}");
        }
    }

    /// Prepare and replace a pack while holding the same gate as start/delete.
    pub(crate) async fn install_region<F, Fut>(
        &self,
        region_id: &str,
        target: &Path,
        prepare: F,
    ) -> Result<(), String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<PreparedInstall, String>>,
    {
        // Preparing a pack can take many minutes. Serialize pack operations, but
        // keep the router lifecycle available until the atomic replacement step.
        let _region_operation = self.region_gate.lock().await;
        let prepared = prepare().await?;
        let mut state = self.state.lock().await;
        self.reconcile_exit_locked(&mut state);
        let result = async {
            self.wait_for_routes_locked().await?;
            if state.region_id.as_deref() == Some(region_id) {
                self.stop_locked(&mut state).await?;
            }
            super::replace_directory_atomically(&prepared.content_dir, target)
        }
        .await;
        let cleanup = std::fs::remove_dir_all(&prepared.staging_root);
        match (result, cleanup) {
            (Err(error), _) => Err(error),
            (Ok(()), Err(error)) if error.kind() != std::io::ErrorKind::NotFound => Err(format!(
                "failed to remove navigation staging directory: {error}"
            )),
            (Ok(()), _) => Ok(()),
        }
    }

    /// Keep graph deletion inside the lifecycle gate so a pending lazy start
    /// cannot open files from a region while it is being removed.
    pub async fn stop_and_delete_region(
        &self,
        region_id: &str,
        directory: &std::path::Path,
    ) -> Result<(), String> {
        let _region_operation = self.region_gate.lock().await;
        let mut state = self.state.lock().await;
        self.reconcile_exit_locked(&mut state);
        self.wait_for_routes_locked().await?;
        if state.region_id.as_deref() == Some(region_id) {
            self.stop_locked(&mut state).await?;
        }
        if directory.exists() {
            std::fs::remove_dir_all(directory).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Reset the inactivity timer after a route request or navigation heartbeat.
    pub async fn note_activity(&self, app: &AppHandle) {
        let mut state = self.state.lock().await;
        if !self.is_running() {
            return;
        }
        let activity_id = Self::touch_locked(&mut state);
        drop(state);
        self.schedule_idle_stop(app.clone(), activity_id);
    }

    fn touch_locked(state: &mut OsrmState) -> u64 {
        state.activity_id += 1;
        state.activity_id
    }

    fn schedule_idle_stop(&self, app: AppHandle, activity_id: u64) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(IDLE_STOP_DELAY).await;
            let mut state = manager.state.lock().await;
            if state.activity_id != activity_id || !manager.is_running() {
                return;
            }
            if manager.active_routes.load(Ordering::SeqCst) != 0 {
                return;
            }
            if let Err(error) = manager.stop_locked(&mut state).await {
                manager.set_failure(&error);
            }
            drop(state);
            manager.emit_status(&app);
        });
    }

    async fn record_exit(&self, app: &AppHandle, run_id: u64, error: String) {
        let mut state = self.state.lock().await;
        if state.child_run_id != Some(run_id) {
            return;
        }
        let intentional = state.stopping_run_id == Some(run_id);
        self.clear_run_locked(&mut state);
        if !intentional {
            *self.failure.lock().unwrap() = Some(error);
        }
        drop(state);
        self.emit_status(app);
    }

    async fn stop_locked(&self, state: &mut OsrmState) -> Result<(), String> {
        self.reconcile_exit_locked(state);
        let Some(run_id) = state.child_run_id else {
            self.clear_run_locked(state);
            return Ok(());
        };
        state.stopping_run_id = Some(run_id);
        if let Some(child) = state.child.take() {
            if let Err(error) = child.kill() {
                let error = format!(
                    "failed to kill osrm-routed (run {run_id}); process remains tracked until an exit event: {error}"
                );
                self.set_failure(&error);
                return Err(error);
            }
        } else if self.exited_run_id.load(Ordering::SeqCst) != run_id {
            let error =
                format!("cannot stop osrm-routed run {run_id}: CommandChild handle is unavailable");
            self.set_failure(&error);
            return Err(error);
        }

        for _ in 0..TERMINATION_ATTEMPTS {
            if self.exited_run_id.load(Ordering::SeqCst) == run_id {
                self.clear_run_locked(state);
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let error = format!(
            "osrm-routed run {run_id} termination was not confirmed within 5s; process remains tracked"
        );
        self.set_failure(&error);
        Err(error)
    }

    fn acquire_lease(&self) -> RoutingLease {
        self.active_routes.fetch_add(1, Ordering::SeqCst);
        RoutingLease {
            active: Arc::clone(&self.active_routes),
        }
    }

    async fn wait_for_routes_locked(&self) -> Result<(), String> {
        for _ in 0..LEASE_DRAIN_ATTEMPTS {
            if self.active_routes.load(Ordering::SeqCst) == 0 {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err("navigation lifecycle operation blocked by an active route request".to_string())
    }

    fn reconcile_exit_locked(&self, state: &mut OsrmState) {
        if state.child_run_id.is_some()
            && state.child_run_id == Some(self.exited_run_id.load(Ordering::SeqCst))
        {
            self.clear_run_locked(state);
        }
    }

    fn can_reuse_locked(&self, state: &OsrmState, region_id: &str) -> bool {
        let Some(run_id) = state.child_run_id else {
            return false;
        };
        self.is_running()
            && state.stopping_run_id.is_none()
            && state.region_id.as_deref() == Some(region_id)
            && self.exited_run_id.load(Ordering::SeqCst) != run_id
    }

    fn clear_run_locked(&self, state: &mut OsrmState) {
        state.child.take();
        state.child_run_id = None;
        state.region_id = None;
        state.stopping_run_id = None;
        Self::touch_locked(state);
        self.running.store(false, Ordering::SeqCst);
        *self.region.lock().unwrap() = None;
    }

    fn set_failure(&self, error: &str) {
        *self.failure.lock().unwrap() = Some(error.to_string());
    }

    async fn wait_for_port(&self) -> Result<(), String> {
        for _ in 0..10 {
            if TcpListener::bind(("127.0.0.1", self.port)).is_ok() {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        Err(format!(
            "cannot start osrm-routed: 127.0.0.1:{} is already in use",
            self.port
        ))
    }

    async fn is_osrm_ready(&self) -> bool {
        let url = format!(
            "http://127.0.0.1:{}/route/v1/driving/0,0;0,0?overview=false",
            self.port
        );
        let Ok(response) = reqwest::Client::new()
            .get(url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
        else {
            return false;
        };
        response
            .json::<Value>()
            .await
            .ok()
            .and_then(|body| body.get("code").and_then(Value::as_str).map(str::to_string))
            .is_some()
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit(
            "nav:status",
            super::NavStatus {
                router_running: self.is_running(),
                installed_region: self.region(),
                router_error: self.failure(),
                port: self.port,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state_for_run(run_id: u64, region_id: &str) -> OsrmState {
        OsrmState {
            child: None,
            child_run_id: Some(run_id),
            region_id: Some(region_id.to_string()),
            next_run_id: run_id,
            activity_id: 0,
            stopping_run_id: None,
        }
    }

    #[test]
    fn routing_lease_reference_count_is_released_on_drop() {
        let manager = OsrmManager::default();
        let first = manager.acquire_lease();
        let second = manager.acquire_lease();
        assert_eq!(manager.active_routes.load(Ordering::SeqCst), 2);
        drop(first);
        assert_eq!(manager.active_routes.load(Ordering::SeqCst), 1);
        drop(second);
        assert_eq!(manager.active_routes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn exited_or_stopping_run_cannot_take_same_region_fast_path() {
        let manager = OsrmManager::default();
        manager.running.store(true, Ordering::SeqCst);
        let mut state = state_for_run(7, "seattle");
        assert!(manager.can_reuse_locked(&state, "seattle"));

        manager.exited_run_id.store(7, Ordering::SeqCst);
        assert!(!manager.can_reuse_locked(&state, "seattle"));
        manager.exited_run_id.store(0, Ordering::SeqCst);
        state.stopping_run_id = Some(7);
        assert!(!manager.can_reuse_locked(&state, "seattle"));
    }

    #[test]
    fn confirmed_exit_clears_tracked_run_state() {
        let manager = OsrmManager::default();
        manager.running.store(true, Ordering::SeqCst);
        *manager.region.lock().unwrap() = Some("seattle".to_string());
        manager.exited_run_id.store(9, Ordering::SeqCst);
        let mut state = state_for_run(9, "seattle");

        manager.reconcile_exit_locked(&mut state);

        assert!(state.child_run_id.is_none());
        assert!(state.region_id.is_none());
        assert!(!manager.is_running());
        assert!(manager.region().is_none());
    }
}
