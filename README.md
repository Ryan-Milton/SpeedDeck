# SpeedDeck

In-car GPS apps for the Steam Deck. This repository hosts two generations of the project:

## [`v1/`](./v1) — GPS Speedometer HUD (current, stable)

The original SpeedDeck: a Python backend (NMEA/serial GPS parsing, trip recording, OSRM
navigation) talking to an Electron + React frontend over WebSocket. Mature and production-ready.
See [`v1/README.md`](./v1/README.md) for setup, build, and Steam Deck install instructions.

## [`v2/`](./v2) — CarPlay-style infotainment (in development)

A greenfield rewrite as a single self-contained **Tauri 2 (Rust) + React** binary: a
pixel-faithful Apple CarPlay-style UI (home grid, dock, status bar) running fully standalone on
the Steam Deck. v1's proven GPS, navigation, and trip logic is ported into Rust behind a
vehicle-data abstraction so OBD2 can be added later.

**v1 surfaces:** Home launcher + dock · Maps (offline turn-by-turn) · Now Playing / Music
(local + Spotify) · Dashboard split view. (Phone/Messages deferred.)

The GPS receiver is the only vehicle sensor for now — no OBD2, no paired phone. Maps are
offline-first; the app is designed to kiosk auto-boot when the receiver is connected.
