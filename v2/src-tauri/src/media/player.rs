//! Audio player thread. Owns the `rodio` OutputStream + Sink (both `!Send`) and
//! takes commands over a channel; publishes playback position/state to a shared
//! struct that the controller polls and broadcasts.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::Source;
use serde::Serialize;

pub enum PlayerCmd {
    Load(PathBuf),
    Pause,
    Resume,
    Stop,
    Seek(u64), // ms
    Volume(f32),
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    /// True for one tick when the current track finished naturally.
    #[serde(skip)]
    pub ended: bool,
}

/// Spawn the player thread. Returns a command sender + shared playback state.
pub fn spawn_player(initial_volume: f32) -> (Sender<PlayerCmd>, Arc<Mutex<PlaybackState>>) {
    let (tx, rx) = channel::<PlayerCmd>();
    let state = Arc::new(Mutex::new(PlaybackState::default()));
    let st = state.clone();

    thread::spawn(move || {
        // OutputStream must stay alive for audio to play; keep it on this thread.
        let (_stream, handle) = match rodio::OutputStream::try_default() {
            Ok(s) => s,
            Err(_) => return, // no audio device (e.g. headless) — thread exits
        };
        let sink = match rodio::Sink::try_new(&handle) {
            Ok(s) => s,
            Err(_) => return,
        };
        sink.set_volume(initial_volume);
        let mut was_playing = false;

        loop {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(PlayerCmd::Load(path)) => {
                    sink.stop();
                    if let Ok(file) = File::open(&path) {
                        if let Ok(decoder) = rodio::Decoder::new(BufReader::new(file)) {
                            let dur = decoder.total_duration().map(|d| d.as_millis() as u64).unwrap_or(0);
                            sink.append(decoder);
                            sink.play();
                            let mut s = st.lock().unwrap();
                            s.ended = false;
                            s.duration_ms = dur;
                            s.position_ms = 0;
                            s.is_playing = true;
                            was_playing = true;
                        }
                    }
                }
                Ok(PlayerCmd::Pause) => sink.pause(),
                Ok(PlayerCmd::Resume) => sink.play(),
                Ok(PlayerCmd::Stop) => {
                    sink.stop();
                    was_playing = false;
                    *st.lock().unwrap() = PlaybackState::default();
                }
                Ok(PlayerCmd::Seek(ms)) => {
                    let _ = sink.try_seek(Duration::from_millis(ms));
                }
                Ok(PlayerCmd::Volume(v)) => sink.set_volume(v),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }

            // Refresh shared state.
            let mut s = st.lock().unwrap();
            s.position_ms = sink.get_pos().as_millis() as u64;
            let empty = sink.empty();
            s.is_playing = !sink.is_paused() && !empty;
            if was_playing && empty {
                s.ended = true;
                s.is_playing = false;
                was_playing = false;
            }
        }
    });

    (tx, state)
}
