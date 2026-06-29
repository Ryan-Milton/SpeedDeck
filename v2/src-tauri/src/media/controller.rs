//! Playback controller: queue, shuffle/repeat, transport. Drives the player
//! thread and broadcasts `media:state`. The queue-advance logic is pure and
//! unit-tested; the rest coordinates the player + library.

use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use super::library::{LibraryStore, TrackInfo};
use super::player::{spawn_player, PlaybackState, PlayerCmd};

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
        let (tx, state) = spawn_player(1.0);
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
            })),
            app,
        };
        // Ticker: emit state ~3 Hz and auto-advance when a track ends.
        let ticker = controller.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(300));
            let ended = {
                let mut s = ticker.state.lock().unwrap();
                let e = s.ended;
                s.ended = false;
                e
            };
            if ended {
                ticker.step(true);
            }
            ticker.emit_state();
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
        self.emit_state();
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
        let _ = self.tx.send(PlayerCmd::Pause);
    }
    pub fn resume(&self) {
        let _ = self.tx.send(PlayerCmd::Resume);
    }
    pub fn next(&self) {
        self.step(true);
        self.emit_state();
    }
    pub fn prev(&self) {
        self.step(false);
        self.emit_state();
    }
    pub fn seek(&self, ms: u64) {
        let _ = self.tx.send(PlayerCmd::Seek(ms));
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
            let _ = self.tx.send(PlayerCmd::Stop);
        }
    }

    fn load_current(&self) {
        if let Some(path) = self.current_path() {
            let _ = self.tx.send(PlayerCmd::Load(path));
        }
    }

    fn current_path(&self) -> Option<PathBuf> {
        let inner = self.inner.lock().unwrap();
        let track_idx = *inner.order.get(inner.pos)?;
        inner.queue.get(track_idx).map(PathBuf::from)
    }

    fn current_track(&self) -> Option<TrackInfo> {
        let path = {
            let inner = self.inner.lock().unwrap();
            let track_idx = *inner.order.get(inner.pos)?;
            inner.queue.get(track_idx)?.clone()
        };
        self.store.track_by_path(&path).ok().flatten()
    }

    fn build_state(&self) -> MediaState {
        let pb = self.state.lock().unwrap().clone();
        let inner = self.inner.lock().unwrap();
        MediaState {
            is_playing: pb.is_playing,
            position_ms: pb.position_ms,
            duration_ms: pb.duration_ms,
            volume: inner.volume,
            shuffle: inner.shuffle,
            repeat: inner.repeat,
            queue_len: inner.queue.len(),
            index: inner.pos,
            now_playing: None, // filled below (avoid holding the lock across store call)
        }
    }

    fn emit_state(&self) {
        let mut state = self.build_state();
        state.now_playing = self.current_track();
        let _ = self.app.emit("media:state", state);
    }
}

/// In-place Fisher–Yates that moves the current track to position 0, then
/// shuffles the rest. Uses a time-seeded xorshift (no extra crate).
fn shuffle_keeping_current(inner: &mut Inner) {
    let n = inner.order.len();
    if n <= 1 {
        return;
    }
    let current = inner.order[inner.pos.min(n - 1)];
    let mut rest: Vec<usize> = inner.order.iter().copied().filter(|&x| x != current).collect();

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
}
