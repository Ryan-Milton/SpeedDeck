mod geo;
mod maps;
mod media;
mod nav;
mod trips;
mod vehicle;

use tauri::{Emitter, Manager};

use maps::downloader::DownloadManager;
use media::{LibraryStore, MediaController};
use nav::OsrmManager;
use trips::{TripRecorder, TripStore};

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

// --- Trip control: the processor tracks live stats, the recorder persists
//     trackpoints + the trip row (stats are read from the processor on stop). ---

#[tauri::command]
fn trip_start(
    app: tauri::AppHandle,
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<i64, String> {
    let trip_gate = hub.trip_gate();
    let _transition = trip_gate.lock().unwrap();
    let id = recorder.start()?;
    hub.processor().lock().unwrap().start_trip();
    let _ = app.emit("trip:status", "recording");
    Ok(id)
}

#[tauri::command]
fn trip_stop(
    app: tauri::AppHandle,
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<(), String> {
    let trip_gate = hub.trip_gate();
    let _transition = trip_gate.lock().unwrap();
    let (distance, max_speed, avg_speed) = {
        let p = hub.processor();
        let p = p.lock().unwrap();
        (p.trip_distance, p.trip_max_speed, p.trip_avg_speed)
    };
    recorder.stop(distance, max_speed, avg_speed)?;
    hub.processor().lock().unwrap().stop_trip();
    let _ = app.emit("trip:status", "idle");
    Ok(())
}

#[tauri::command]
fn trip_pause(
    app: tauri::AppHandle,
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<(), String> {
    let trip_gate = hub.trip_gate();
    let _transition = trip_gate.lock().unwrap();
    recorder.pause()?;
    hub.processor().lock().unwrap().pause_trip();
    let _ = app.emit("trip:status", "paused");
    Ok(())
}

#[tauri::command]
fn trip_resume(
    app: tauri::AppHandle,
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<(), String> {
    let trip_gate = hub.trip_gate();
    let _transition = trip_gate.lock().unwrap();
    recorder.resume()?;
    hub.processor().lock().unwrap().resume_trip();
    let _ = app.emit("trip:status", "recording");
    Ok(())
}

/// Pick the telemetry providers. Production always starts the live GPS provider
/// so it can report disconnected/no-fix health and discover receivers later.
/// Simulation is available only through the explicit development override.
fn build_providers() -> Vec<Box<dyn VehicleProvider>> {
    let force_sim = std::env::var("SPEEDDECK_SIMULATOR")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if force_sim {
        return vec![Box::new(SimulatorProvider::new())];
    }

    let port_override = std::env::var("SPEEDDECK_GPS_PORT")
        .ok()
        .filter(|port| !port.trim().is_empty());
    let baud = std::env::var("SPEEDDECK_GPS_BAUD")
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|baud| *baud > 0)
        .unwrap_or(DEFAULT_BAUD);
    vec![Box::new(GpsProvider {
        port: port_override.clone().or_else(detect_port),
        port_is_override: port_override.is_some(),
        baud,
        update_hz: DEFAULT_UPDATE_HZ,
    })]
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        // Range-capable asset protocols (replace v1 Electron handlers).
        .register_uri_scheme_protocol("tiles", |ctx, request| {
            maps::protocol::handle_tiles(ctx.app_handle(), &request)
        })
        .register_uri_scheme_protocol("tile-cache", |ctx, request| {
            maps::protocol::handle_tile_cache(ctx.app_handle(), &request)
        })
        .register_uri_scheme_protocol("music-art", |ctx, request| {
            media::protocol::handle_album_art(ctx.app_handle(), &request)
        })
        .manage(DownloadManager::default())
        .manage(OsrmManager::default())
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
            maps::list_regions,
            trips::trip_list,
            trips::trip_trackpoints,
            trips::trip_delete,
            trips::trip_rename,
            trips::trip_export_gpx,
            nav::nav_status,
            nav::calculate_route,
            nav::nav_note_activity,
            nav::geocode_search,
            nav::nav_list_regions,
            nav::nav_download_region,
            nav::nav_delete_region,
            media::music_scan,
            media::music_folders,
            media::music_add_folder,
            media::music_remove_folder,
            media::music_albums,
            media::music_artists,
            media::music_tracks,
            media::music_tracks_by_album,
            media::music_search,
            media::music_track_count,
            media::music_play_track,
            media::music_play_album,
            media::music_pause,
            media::music_resume,
            media::music_next,
            media::music_prev,
            media::music_seek,
            media::music_set_volume,
            media::music_set_shuffle,
            media::music_set_repeat,
            media::music_state
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("app data dir");
            let store = TripStore::open(&data_dir.join("trips.db")).expect("open trip database");
            let recorder = TripRecorder::new(store);

            let hub = VehicleHub::start(app.handle().clone(), build_providers(), recorder.clone());
            app.manage(recorder);
            app.manage(hub);

            // Music: reopen the persisted library. Only the initial population
            // scans recursively; later updates are user-triggered from Settings.
            let library = LibraryStore::open(&data_dir.join("music.db")).expect("open music db");
            media::ensure_default_folder(app.handle(), &library);
            let controller = MediaController::new(app.handle().clone(), library.clone());
            app.manage(controller);
            app.manage(library.clone());
            if library.needs_initial_scan() {
                let scan_app = app.handle().clone();
                let scan_lib = library;
                tauri::async_runtime::spawn_blocking(move || {
                    let art = scan_app
                        .path()
                        .app_data_dir()
                        .map(|d| d.join("music-cache/art"))
                        .unwrap_or_default();
                    let _ = media::scanner::scan(&scan_app, &scan_lib, &art);
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building SpeedDeck");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let (Some(hub), Some(recorder)) = (
                app_handle.try_state::<VehicleHub>(),
                app_handle.try_state::<TripRecorder>(),
            ) {
                let trip_gate = hub.trip_gate();
                let _transition = trip_gate.lock().unwrap();
                let (distance, max_speed, avg_speed) = {
                    let processor = hub.processor();
                    let mut processor = processor.lock().unwrap();
                    processor.stop_trip();
                    (
                        processor.trip_distance,
                        processor.trip_max_speed,
                        processor.trip_avg_speed,
                    )
                };
                if let Err(error) = recorder.stop(distance, max_speed, avg_speed) {
                    eprintln!("failed to finalize trip during shutdown: {error}");
                }
                hub.stop();
            }
            if let Some(osrm) = app_handle.try_state::<OsrmManager>() {
                tauri::async_runtime::block_on(osrm.stop());
            }
        }
    });
}
