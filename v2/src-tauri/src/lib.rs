mod geo;
mod maps;
mod media;
mod nav;
mod trips;
mod vehicle;

use tauri::Manager;

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
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<i64, String> {
    let id = recorder.start()?;
    hub.processor().lock().unwrap().start_trip();
    Ok(id)
}

#[tauri::command]
fn trip_stop(
    hub: tauri::State<'_, VehicleHub>,
    recorder: tauri::State<'_, TripRecorder>,
) -> Result<(), String> {
    let (distance, max_speed, avg_speed) = {
        let p = hub.processor();
        let p = p.lock().unwrap();
        (p.trip_distance, p.trip_max_speed, p.trip_avg_speed)
    };
    hub.processor().lock().unwrap().stop_trip();
    recorder.stop(distance, max_speed, avg_speed)
}

#[tauri::command]
fn trip_pause(hub: tauri::State<'_, VehicleHub>, recorder: tauri::State<'_, TripRecorder>) {
    hub.processor().lock().unwrap().pause_trip();
    recorder.pause();
}

#[tauri::command]
fn trip_resume(hub: tauri::State<'_, VehicleHub>, recorder: tauri::State<'_, TripRecorder>) {
    hub.processor().lock().unwrap().resume_trip();
    recorder.resume();
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

            let hub = VehicleHub::start(
                app.handle().clone(),
                build_providers(),
                recorder.clone(),
            );
            app.manage(recorder);
            app.manage(hub);

            // Auto-start routing for an already-installed region.
            let nav_app = app.handle().clone();
            let osrm = app.state::<OsrmManager>().inner().clone();
            tauri::async_runtime::spawn(nav::autostart(nav_app, osrm));

            // Music: open the library, seed ~/Music, start the controller, and
            // kick a background scan.
            let library = LibraryStore::open(&data_dir.join("music.db")).expect("open music db");
            media::ensure_default_folder(app.handle(), &library);
            let controller = MediaController::new(app.handle().clone(), library.clone());
            app.manage(controller);
            app.manage(library.clone());
            {
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
        .run(tauri::generate_context!())
        .expect("error while running SpeedDeck");
}
