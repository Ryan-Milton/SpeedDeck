//! Local music: library cache, scanner, audio player, playback controller.

pub mod controller;
pub mod library;
pub mod player;
pub mod protocol;
pub mod scanner;

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

pub use controller::{MediaController, MediaState, RepeatMode};
pub use library::{AlbumInfo, LibraryStore, TrackInfo};

fn art_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .map(|d| d.join("music-cache/art"))
        .unwrap_or_else(|_| PathBuf::from("music-cache/art"))
}

fn home_music() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Music"))
}

/// Seed `~/Music` (XDG audio dir) as the default scan folder on first run.
pub fn ensure_default_folder(app: &AppHandle, store: &LibraryStore) {
    if store.folders().map(|f| f.is_empty()).unwrap_or(true) {
        if let Some(dir) = app.path().audio_dir().ok().or_else(home_music) {
            let _ = store.add_folder(&dir.to_string_lossy());
        }
    }
}

// --- library / folders ---

#[tauri::command]
pub async fn music_scan(app: AppHandle, store: State<'_, LibraryStore>) -> Result<usize, String> {
    let store = store.inner().clone();
    let art = art_dir(&app);
    tauri::async_runtime::spawn_blocking(move || scanner::scan(&app, &store, &art))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn music_folders(store: State<'_, LibraryStore>) -> Result<Vec<String>, String> {
    store.folders()
}

#[tauri::command]
pub fn music_add_folder(
    app: AppHandle,
    store: State<'_, LibraryStore>,
) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    if let Some(folder) = app.dialog().file().blocking_pick_folder() {
        let path = folder.into_path().map_err(|e| e.to_string())?;
        store.add_folder(&path.to_string_lossy())?;
    }
    store.folders()
}

#[tauri::command]
pub fn music_remove_folder(
    store: State<'_, LibraryStore>,
    path: String,
) -> Result<Vec<String>, String> {
    store.remove_folder(&path)?;
    store.folders()
}

#[tauri::command]
pub fn music_albums(store: State<'_, LibraryStore>) -> Result<Vec<AlbumInfo>, String> {
    store.albums()
}

#[tauri::command]
pub fn music_artists(store: State<'_, LibraryStore>) -> Result<Vec<String>, String> {
    store.artists()
}

#[tauri::command]
pub fn music_tracks(store: State<'_, LibraryStore>) -> Result<Vec<TrackInfo>, String> {
    store.all_tracks()
}

#[tauri::command]
pub fn music_tracks_by_album(
    store: State<'_, LibraryStore>,
    album: String,
    artist: String,
) -> Result<Vec<TrackInfo>, String> {
    store.tracks_by_album(&album, &artist)
}

#[tauri::command]
pub fn music_search(
    store: State<'_, LibraryStore>,
    query: String,
) -> Result<Vec<TrackInfo>, String> {
    store.search(&query, 100)
}

#[tauri::command]
pub fn music_track_count(store: State<'_, LibraryStore>) -> i64 {
    store.track_count()
}

// --- playback ---

#[tauri::command]
pub fn music_play_track(controller: State<'_, MediaController>, track_id: i64) {
    controller.play_track(track_id);
}

#[tauri::command]
pub fn music_play_album(
    controller: State<'_, MediaController>,
    album: String,
    artist: String,
    start: usize,
) -> Result<(), String> {
    controller.play_album(&album, &artist, start)
}

#[tauri::command]
pub fn music_pause(controller: State<'_, MediaController>) {
    controller.pause();
}

#[tauri::command]
pub fn music_resume(controller: State<'_, MediaController>) {
    controller.resume();
}

#[tauri::command]
pub fn music_next(controller: State<'_, MediaController>) {
    controller.next();
}

#[tauri::command]
pub fn music_prev(controller: State<'_, MediaController>) {
    controller.prev();
}

#[tauri::command]
pub fn music_seek(controller: State<'_, MediaController>, ms: u64) {
    controller.seek(ms);
}

#[tauri::command]
pub fn music_set_volume(controller: State<'_, MediaController>, volume: f32) {
    controller.set_volume(volume.clamp(0.0, 1.0));
}

#[tauri::command]
pub fn music_set_shuffle(controller: State<'_, MediaController>, on: bool) {
    controller.set_shuffle(on);
}

#[tauri::command]
pub fn music_set_repeat(controller: State<'_, MediaController>, mode: RepeatMode) {
    controller.set_repeat(mode);
}

#[tauri::command]
pub fn music_state(controller: State<'_, MediaController>) -> MediaState {
    controller.snapshot()
}
