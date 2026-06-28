// Typed bridge between the React frontend and the Rust backend.
//
// This replaces v1's WebSocket client (v1/.../lib/ws-client.ts): instead of
// JSON messages over ws://127.0.0.1:8765, the frontend calls Rust via Tauri
// `invoke()` and subscribes to Rust-emitted events via `listen()`. Rust serde
// payloads use camelCase, so the shapes here match the Rust structs 1:1.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Skeleton command round-trip — proves frontend → Rust → frontend works. */
export function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}

/** Skeleton heartbeat event payload emitted by the Rust backend. */
export interface Tick {
  count: number;
  message: string;
}

/** Subscribe to the backend heartbeat. Returns an unlisten handle. */
export function onTick(cb: (tick: Tick) => void): Promise<UnlistenFn> {
  return listen<Tick>("tick", (event) => cb(event.payload));
}
