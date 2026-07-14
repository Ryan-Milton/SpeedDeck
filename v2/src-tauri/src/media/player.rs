//! Audio player thread. Owns the `rodio` OutputStream + Sink (both `!Send`) and
//! takes commands over a channel; publishes applied commands and active-playback
//! updates to the controller.

use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rodio::Source;
use serde::Serialize;

pub enum PlayerCmd {
    Load { path: PathBuf, generation: u64 },
    Pause,
    Resume,
    Stop { generation: u64 },
    Seek(u64), // ms
    Volume(f32),
}

const STATE_REFRESH_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackState {
    pub is_playing: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
}

/// Each applied transport command produces an event. Unlike a bounded waiter,
/// this channel still reports commands that take unusually long to complete.
pub enum PlayerEvent {
    LoadApplied {
        path: PathBuf,
        generation: u64,
        result: Result<(), String>,
    },
    StopApplied {
        generation: u64,
    },
    ControlApplied,
    Progress {
        generation: u64,
        ended: bool,
    },
}

/// Spawn the player thread. Returns its command sender, shared state, and the
/// applied-state event receiver consumed by the controller.
pub fn spawn_player(
    initial_volume: f32,
) -> (
    Sender<PlayerCmd>,
    Arc<Mutex<PlaybackState>>,
    Receiver<PlayerEvent>,
) {
    let (tx, rx) = channel::<PlayerCmd>();
    let (event_tx, event_rx) = channel::<PlayerEvent>();
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
        let mut generation = None;

        loop {
            let received = if st.lock().unwrap().is_playing {
                rx.recv_timeout(STATE_REFRESH_INTERVAL)
            } else {
                match rx.recv() {
                    Ok(command) => Ok(command),
                    Err(_) => break,
                }
            };

            let mut ended = false;
            match received {
                Ok(PlayerCmd::Load {
                    path,
                    generation: command_generation,
                }) => {
                    sink.stop();
                    was_playing = false;
                    generation = None;
                    *st.lock().unwrap() = PlaybackState::default();
                    let result = (|| {
                        let file = File::open(&path).map_err(|e| e.to_string())?;
                        let decoder =
                            rodio::Decoder::new(BufReader::new(file)).map_err(|e| e.to_string())?;
                        let duration_ms = decoder
                            .total_duration()
                            .map(|d| d.as_millis() as u64)
                            .unwrap_or(0);
                        sink.append(decoder);
                        sink.play();
                        let mut state = st.lock().unwrap();
                        state.duration_ms = duration_ms;
                        state.is_playing = true;
                        was_playing = true;
                        generation = Some(command_generation);
                        Ok(())
                    })();
                    ended = refresh_state(&sink, &st, &mut was_playing);
                    if event_tx
                        .send(PlayerEvent::LoadApplied {
                            path,
                            generation: command_generation,
                            result,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(PlayerCmd::Pause) => {
                    sink.pause();
                    ended = refresh_state(&sink, &st, &mut was_playing);
                    if event_tx.send(PlayerEvent::ControlApplied).is_err() {
                        break;
                    }
                }
                Ok(PlayerCmd::Resume) => {
                    sink.play();
                    ended = refresh_state(&sink, &st, &mut was_playing);
                    if event_tx.send(PlayerEvent::ControlApplied).is_err() {
                        break;
                    }
                }
                Ok(PlayerCmd::Stop {
                    generation: command_generation,
                }) => {
                    sink.stop();
                    was_playing = false;
                    generation = None;
                    *st.lock().unwrap() = PlaybackState::default();
                    if event_tx
                        .send(PlayerEvent::StopApplied {
                            generation: command_generation,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
                Ok(PlayerCmd::Seek(ms)) => {
                    let _ = sink.try_seek(Duration::from_millis(ms));
                    ended = refresh_state(&sink, &st, &mut was_playing);
                    if event_tx.send(PlayerEvent::ControlApplied).is_err() {
                        break;
                    }
                }
                Ok(PlayerCmd::Volume(v)) => sink.set_volume(v),
                Err(RecvTimeoutError::Timeout) => {
                    ended = refresh_state(&sink, &st, &mut was_playing);
                    if let Some(generation) = generation {
                        if event_tx
                            .send(PlayerEvent::Progress { generation, ended })
                            .is_err()
                        {
                            break;
                        }
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }

            if ended {
                if let Some(generation) = generation {
                    if event_tx
                        .send(PlayerEvent::Progress {
                            generation,
                            ended: true,
                        })
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    });

    (tx, state, event_rx)
}

fn refresh_state(
    sink: &rodio::Sink,
    state: &Arc<Mutex<PlaybackState>>,
    was_playing: &mut bool,
) -> bool {
    let mut state = state.lock().unwrap();
    state.position_ms = sink.get_pos().as_millis() as u64;
    let empty = sink.empty();
    state.is_playing = !sink.is_paused() && !empty;
    let ended = *was_playing && empty;
    if ended {
        *was_playing = false;
    }
    ended
}
