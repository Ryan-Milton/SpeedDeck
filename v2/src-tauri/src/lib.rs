mod geo;
mod maps;
mod vehicle;

use tauri::Manager;

use maps::downloader::DownloadManager;

use vehicle::gps_provider::GpsProvider;
use vehicle::serial::detect_port;
use vehicle::simulator::SimulatorProvider;
use vehicle::{VehicleHub, VehicleProvider};

const DEFAULT_BAUD: u32 = 115_200;
const DEFAULT_UPDATE_HZ: u32 = 10;

/// Skeleton command kept as a liveness probe for the IPC bridge.
#[tauri::command]
async fn ping(name: String) -> Result<String, String> {
    Ok(format!("pong: hello {name}"))
}

// --- Trip control (ported from v1 recorder/processor; DB persistence is Phase 5) ---

#[tauri::command]
fn trip_start(hub: tauri::State<'_, VehicleHub>) {
    hub.processor().lock().unwrap().start_trip();
}

#[tauri::command]
fn trip_stop(hub: tauri::State<'_, VehicleHub>) {
    hub.processor().lock().unwrap().stop_trip();
}

#[tauri::command]
fn trip_pause(hub: tauri::State<'_, VehicleHub>) {
    hub.processor().lock().unwrap().pause_trip();
}

#[tauri::command]
fn trip_resume(hub: tauri::State<'_, VehicleHub>) {
    hub.processor().lock().unwrap().resume_trip();
}

/// Pick the telemetry providers. Live GPS when a receiver is detected (unless
/// `SPEEDDECK_SIMULATOR=1` forces the simulator); otherwise the simulator so the
/// app is useful without hardware.
fn build_providers() -> Vec<Box<dyn VehicleProvider>> {
    let force_sim = std::env::var("SPEEDDECK_SIMULATOR")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if !force_sim {
        if let Some(port) = detect_port() {
            return vec![Box::new(GpsProvider {
                port,
                baud: DEFAULT_BAUD,
                update_hz: DEFAULT_UPDATE_HZ,
            })];
        }
    }
    vec![Box::new(SimulatorProvider::new())]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Range-capable map asset protocols (replace v1 Electron handlers).
        .register_uri_scheme_protocol("tiles", |ctx, request| {
            maps::protocol::handle_tiles(ctx.app_handle(), &request)
        })
        .register_uri_scheme_protocol("tile-cache", |ctx, request| {
            maps::protocol::handle_tile_cache(ctx.app_handle(), &request)
        })
        .manage(DownloadManager::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            trip_start,
            trip_stop,
            trip_pause,
            trip_resume,
            maps::default_pmtiles_url,
            maps::estimate_tile_download,
            maps::start_tile_download,
            maps::cancel_tile_download,
            maps::download_progress,
            maps::tiles_exist,
            maps::cache_size,
            maps::delete_cached_tiles,
            maps::list_regions
        ])
        .setup(|app| {
            let hub = VehicleHub::start(app.handle().clone(), build_providers());
            app.manage(hub);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SpeedDeck");
}
