use serde::Serialize;
use tauri::{Emitter, Manager};

/// Skeleton heartbeat payload. camelCase to match the frontend (`ipc.ts`),
/// the same convention every backend->frontend event will follow (mirrors
/// v1's `_to_camel` in `server/protocol.py`).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Tick {
    count: u64,
    message: String,
}

/// Skeleton command — proves the frontend -> Rust -> frontend round-trip.
/// Real commands (trip control, calculate_route, geocode_search, media
/// transport, ...) get registered the same way in later phases.
#[tauri::command]
async fn ping(name: String) -> Result<String, String> {
    Ok(format!("pong: hello {name}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping])
        .setup(|app| {
            // Emit a 1 Hz heartbeat so the frontend can prove its event
            // subscription works. Phase 2 replaces this with the VehicleHub
            // emitting `vehicle:state` from real GPS samples.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut count: u64 = 0;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    count += 1;
                    let _ = handle.emit(
                        "tick",
                        Tick {
                            count,
                            message: "skeleton backend alive".into(),
                        },
                    );
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SpeedDeck");
}
