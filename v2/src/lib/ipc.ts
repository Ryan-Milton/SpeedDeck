// Typed bridge between the React frontend and the Rust backend.
//
// Replaces v1's WebSocket client (v1/.../lib/ws-client.ts): the frontend calls
// Rust via Tauri `invoke()` and subscribes to Rust-emitted events via `listen()`.
// Rust serde payloads are camelCase, so the shapes here match the structs 1:1.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type { UnlistenFn };

/** Single fix as broadcast by the backend (altitude is smoothed). */
export interface FixSnapshot {
  timestamp: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number; // m/s (raw, unsmoothed)
  heading: number; // degrees true
  satellites: number;
  fixQuality: number; // 0=none, 1=GPS, 2=DGPS
  hdop: number | null;
}

export type TripStatus = "idle" | "recording" | "paused";
export type SampleSource = "gps" | "simulator" | "obd2";
export type ReceiverStatus = "connected" | "fix" | "nofix" | "stale" | "disconnected";

/** Receiver connection/fix health, emitted independently of valid positions. */
export interface ReceiverHealth {
  sequence: number;
  source: SampleSource;
  status: ReceiverStatus;
}

/** Full telemetry snapshot emitted on the `vehicle:state` event (~10 Hz). */
export interface VehicleState {
  sequence: number;
  receiverStatus: "fix";
  fix: FixSnapshot;
  smoothedSpeed: number; // m/s
  maxSpeed: number; // m/s
  avgSpeed: number; // m/s
  tripStatus: TripStatus;
  tripDistance: number; // meters
  tripDuration: number; // seconds
  tripMaxSpeed: number; // m/s
  tripAvgSpeed: number; // m/s
  source: SampleSource;
}

/** Subscribe to live vehicle telemetry. Returns an unlisten handle. */
export function onVehicleState(cb: (state: VehicleState) => void): Promise<UnlistenFn> {
  return listen<VehicleState>("vehicle:state", (event) => cb(event.payload));
}

/** Subscribe to receiver health changes, including no-fix and disconnects. */
export function onVehicleHealth(cb: (health: ReceiverHealth) => void): Promise<UnlistenFn> {
  return listen<ReceiverHealth>("vehicle:health", (event) => cb(event.payload));
}

export function onTripStatus(cb: (status: TripStatus) => void): Promise<UnlistenFn> {
  return listen<TripStatus>("trip:status", (event) => cb(event.payload));
}

export function onTripRecordingError(cb: (message: string) => void): Promise<UnlistenFn> {
  return listen<string>("trip:recording-error", (event) => cb(event.payload));
}

/** Trip recording control. `start` returns the new trip id. */
export const trip = {
  start: () => invoke<number>("trip_start"),
  stop: () => invoke<void>("trip_stop"),
  pause: () => invoke<void>("trip_pause"),
  resume: () => invoke<void>("trip_resume"),
};

/** Liveness probe for the IPC bridge. */
export function ping(name: string): Promise<string> {
  return invoke<string>("ping", { name });
}
