//! Playback controller: queue, shuffle/repeat, transport. Drives the player
//! thread and broadcasts `media:state`. The queue-advance logic is pure and
//! unit-tested; the rest coordinates the player + library.

use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::library::{LibraryStore, TrackInfo};
use super::player::{spawn_player, PlaybackState, PlayerCmd, PlayerEvent};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

/// Pure next/prev position within the play order. `None` => stop (ran off the end).
pub fn advance(order_len: usize, pos: usize, repeat: RepeatMode, forward: bool) -> Option<usize> {
    if order_len == 0 {
        return None;
    }
    if repeat == RepeatMode::One {
        return Some(pos.min(order_len - 1));
    }
    if forward {
        if pos + 1 < order_len {
            Some(pos + 1)
        } else if repeat == RepeatMode::All {
            Some(0)
        } else {
            None
        }
    } else if pos > 0 {
        Some(pos - 1)
    } else if repeat == RepeatMode::All {
        Some(order_len - 1)
    } else {
        None
    }
}

struct Inner {
    queue: Vec<String>, // track file paths (stable across library rescans)
    order: Vec<usize>,  // play order over `queue`
    pos: usize,         // index into `order`
    shuffle: bool,
    repeat: RepeatMode,
    volume: f32,
    player_generation: u64,
    track_loaded: bool,
    now_playing: Option<TrackInfo>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f32,
    pub shuffle: bool,
    pub repeat: RepeatMode,
    pub queue_len: usize,
    pub index: usize,
    pub now_playing: Option<TrackInfo>,
}

#[derive(Clone)]
pub struct MediaController {
    store: LibraryStore,
    tx: Sender<PlayerCmd>,
    state: Arc<Mutex<PlaybackState>>,
    inner: Arc<Mutex<Inner>>,
    app: AppHandle,
}

impl MediaController {
    pub fn new(app: AppHandle, store: LibraryStore) -> Self {
        let (tx, state, events) = spawn_player(1.0);
        let controller = MediaController {
            store,
            tx,
            state,
            inner: Arc::new(Mutex::new(Inner {
                queue: Vec::new(),
                order: Vec::new(),
                pos: 0,
                shuffle: false,
                repeat: RepeatMode::Off,
                volume: 1.0,
                player_generation: 0,
                track_loaded: false,
                now_playing: None,
            })),
            app,
        };
        let listener = controller.clone();
        thread::spawn(move || {
            while let Ok(event) = events.recv() {
                listener.handle_player_event(event);
            }
            listener.player_disconnected();
        });
        controller
    }

    // --- playback entry points ---

    pub fn play_queue(&self, paths: Vec<String>, start: usize) {
        {
            let mut inner = self.inner.lock().unwrap();
            let n = paths.len();
            inner.queue = paths;
            inner.order = (0..n).collect();
            inner.pos = start.min(n.saturating_sub(1));
            if inner.shuffle {
                shuffle_keeping_current(&mut inner);
            }
        }
        self.load_current();
    }

    pub fn play_album(&self, album: &str, artist: &str, start: usize) -> Result<(), String> {
        let paths = self
            .store
            .tracks_by_album(album, artist)?
            .into_iter()
            .map(|t| t.path)
            .collect::<Vec<_>>();
        self.play_queue(paths, start);
        Ok(())
    }

    pub fn play_track(&self, id: i64) {
        // Resolve the id to its path now (it's valid at enqueue time); the queue
        // keys on path so a later rescan can't orphan it.
        if let Ok(Some(track)) = self.store.track(id) {
            self.play_queue(vec![track.path], 0);
        }
    }

    pub fn pause(&self) {
        self.send_control(PlayerCmd::Pause);
    }
    pub fn resume(&self) {
        self.send_control(PlayerCmd::Resume);
    }
    pub fn next(&self) {
        self.step(true);
    }
    pub fn prev(&self) {
        self.step(false);
    }
    pub fn seek(&self, ms: u64) {
        self.send_control(PlayerCmd::Seek(ms));
    }

    pub fn set_volume(&self, v: f32) {
        self.inner.lock().unwrap().volume = v;
        let _ = self.tx.send(PlayerCmd::Volume(v));
        self.emit_state();
    }

    pub fn set_repeat(&self, mode: RepeatMode) {
        self.inner.lock().unwrap().repeat = mode;
        self.emit_state();
    }

    pub fn set_shuffle(&self, on: bool) {
        let mut inner = self.inner.lock().unwrap();
        inner.shuffle = on;
        let n = inner.queue.len();
        if n == 0 {
            return;
        }
        if on {
            shuffle_keeping_current(&mut inner);
        } else {
            // Restore natural order; keep the current track selected.
            let current = inner.order.get(inner.pos).copied().unwrap_or(0);
            inner.order = (0..n).collect();
            inner.pos = current;
        }
        drop(inner);
        self.emit_state();
    }

    pub fn snapshot(&self) -> MediaState {
        self.build_state()
    }

    // --- internals ---

    fn step(&self, forward: bool) {
        let next = {
            let mut inner = self.inner.lock().unwrap();
            match advance(inner.order.len(), inner.pos, inner.repeat, forward) {
                Some(p) => {
                    inner.pos = p;
                    true
                }
                None => false,
            }
        };
        if next {
            self.load_current();
        } else {
            self.stop_player();
        }
    }

    fn load_current(&self) {
        let (path, generation) = {
            let mut inner = self.inner.lock().unwrap();
            let path = inner
                .order
                .get(inner.pos)
                .and_then(|track_idx| inner.queue.get(*track_idx))
                .map(PathBuf::from);
            let generation = next_generation(&mut inner);
            (path, generation)
        };

        if let Some(path) = path {
            if self.tx.send(PlayerCmd::Load { path, generation }).is_err() {
                self.player_command_failed(generation);
            }
        } else {
            self.send_stop(generation);
        }
    }

    fn stop_player(&self) {
        let generation = {
            let mut inner = self.inner.lock().unwrap();
            next_generation(&mut inner)
        };
        self.send_stop(generation);
    }

    fn send_stop(&self, generation: u64) {
        if self.tx.send(PlayerCmd::Stop { generation }).is_err() {
            self.player_command_failed(generation);
        }
    }

    fn build_state(&self) -> MediaState {
        let pb = self.state.lock().unwrap().clone();
        let inner = self.inner.lock().unwrap();
        let (is_playing, position_ms, duration_ms) = if inner.track_loaded {
            (pb.is_playing, pb.position_ms, pb.duration_ms)
        } else {
            (false, 0, 0)
        };
        MediaState {
            is_playing,
            position_ms,
            duration_ms,
            volume: inner.volume,
            shuffle: inner.shuffle,
            repeat: inner.repeat,
            queue_len: inner.queue.len(),
            index: inner.pos,
            now_playing: inner.now_playing.clone(),
        }
    }

    fn emit_state(&self) {
        let _ = self.app.emit("media:state", self.build_state());
    }

    fn handle_player_event(&self, event: PlayerEvent) {
        match event {
            PlayerEvent::LoadApplied {
                path,
                generation,
                result,
            } => {
                let now_playing = if result.is_ok() {
                    self.store
                        .track_by_path(&path.to_string_lossy())
                        .ok()
                        .flatten()
                } else {
                    None
                };
                let mut inner = self.inner.lock().unwrap();
                if !apply_load_result(&mut inner, generation, result.is_ok(), now_playing) {
                    return;
                }
                drop(inner);
                self.emit_state();
            }
            PlayerEvent::StopApplied { generation } => {
                let mut inner = self.inner.lock().unwrap();
                if !apply_stop_result(&mut inner, generation) {
                    return;
                }
                drop(inner);
                self.emit_state();
            }
            PlayerEvent::ControlApplied => self.emit_state(),
            PlayerEvent::Progress { generation, ended } => {
                if self.inner.lock().unwrap().player_generation != generation {
                    return;
                }
                if ended {
                    self.step(true);
                } else {
                    self.emit_state();
                }
            }
        }
    }

    fn send_control(&self, command: PlayerCmd) {
        if self.tx.send(command).is_err() {
            self.player_disconnected();
        }
    }

    fn player_command_failed(&self, generation: u64) {
        *self.state.lock().unwrap() = PlaybackState::default();
        let mut inner = self.inner.lock().unwrap();
        if inner.player_generation != generation {
            return;
        }
        inner.track_loaded = false;
        inner.now_playing = None;
        drop(inner);
        self.emit_state();
    }

    fn player_disconnected(&self) {
        *self.state.lock().unwrap() = PlaybackState::default();
        let mut inner = self.inner.lock().unwrap();
        inner.track_loaded = false;
        inner.now_playing = None;
        drop(inner);
        self.emit_state();
    }
}

fn next_generation(inner: &mut Inner) -> u64 {
    inner.player_generation = inner.player_generation.wrapping_add(1);
    inner.track_loaded = false;
    inner.now_playing = None;
    inner.player_generation
}

fn apply_load_result(
    inner: &mut Inner,
    generation: u64,
    loaded: bool,
    now_playing: Option<TrackInfo>,
) -> bool {
    if inner.player_generation != generation {
        return false;
    }
    inner.track_loaded = loaded;
    inner.now_playing = if loaded { now_playing } else { None };
    true
}

fn apply_stop_result(inner: &mut Inner, generation: u64) -> bool {
    if inner.player_generation != generation {
        return false;
    }
    inner.track_loaded = false;
    inner.now_playing = None;
    true
}

/// In-place Fisher–Yates that moves the current track to position 0, then
/// shuffles the rest. Uses a time-seeded xorshift (no extra crate).
fn shuffle_keeping_current(inner: &mut Inner) {
    let n = inner.order.len();
    if n <= 1 {
        return;
    }
    let current = inner.order[inner.pos.min(n - 1)];
    let mut rest: Vec<usize> = inner
        .order
        .iter()
        .copied()
        .filter(|&x| x != current)
        .collect();

    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E3779B9)
        | 1;
    let mut rng = || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for i in (1..rest.len()).rev() {
        let j = (rng() % (i as u64 + 1)) as usize;
        rest.swap(i, j);
    }

    inner.order = std::iter::once(current).chain(rest).collect();
    inner.pos = 0;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inner() -> Inner {
        Inner {
            queue: Vec::new(),
            order: Vec::new(),
            pos: 0,
            shuffle: false,
            repeat: RepeatMode::Off,
            volume: 1.0,
            player_generation: 1,
            track_loaded: false,
            now_playing: None,
        }
    }

    #[test]
    fn advance_forward_stops_at_end_when_off() {
        assert_eq!(advance(3, 0, RepeatMode::Off, true), Some(1));
        assert_eq!(advance(3, 2, RepeatMode::Off, true), None);
    }

    #[test]
    fn advance_forward_wraps_when_all() {
        assert_eq!(advance(3, 2, RepeatMode::All, true), Some(0));
    }

    #[test]
    fn advance_backward() {
        assert_eq!(advance(3, 1, RepeatMode::Off, false), Some(0));
        assert_eq!(advance(3, 0, RepeatMode::Off, false), None);
        assert_eq!(advance(3, 0, RepeatMode::All, false), Some(2));
    }

    #[test]
    fn advance_repeat_one_replays() {
        assert_eq!(advance(3, 1, RepeatMode::One, true), Some(1));
        assert_eq!(advance(3, 1, RepeatMode::One, false), Some(1));
    }

    #[test]
    fn advance_empty_is_none() {
        assert_eq!(advance(0, 0, RepeatMode::All, true), None);
    }

    #[test]
    fn load_metadata_changes_only_for_current_successful_load() {
        let mut inner = inner();
        let track = TrackInfo {
            path: "/m/current.mp3".into(),
            title: Some("Current".into()),
            ..Default::default()
        };

        assert!(!apply_load_result(&mut inner, 0, true, Some(track.clone())));
        assert!(!inner.track_loaded);
        assert!(inner.now_playing.is_none());

        assert!(apply_load_result(&mut inner, 1, false, Some(track.clone())));
        assert!(!inner.track_loaded);
        assert!(inner.now_playing.is_none());

        assert!(apply_load_result(&mut inner, 1, true, Some(track)));
        assert!(inner.track_loaded);
        assert_eq!(
            inner.now_playing.as_ref().and_then(|t| t.title.as_deref()),
            Some("Current")
        );
    }

    #[test]
    fn newer_generation_rejects_late_load_and_stop_results() {
        let mut inner = inner();
        assert!(apply_load_result(
            &mut inner,
            1,
            true,
            Some(TrackInfo::default())
        ));
        let current = next_generation(&mut inner);

        assert_eq!(current, 2);
        assert!(!apply_load_result(
            &mut inner,
            1,
            true,
            Some(TrackInfo::default())
        ));
        assert!(!apply_stop_result(&mut inner, 1));
        assert!(!inner.track_loaded);
        assert!(inner.now_playing.is_none());
    }
}
