# SpeedDeck

In-car GPS apps for the Steam Deck. This repository hosts two generations of the project:

## [`v1/`](./v1) — GPS Speedometer HUD (legacy, stable)

The original SpeedDeck: a Python backend (NMEA/serial GPS parsing, trip recording, OSRM
navigation) talking to an Electron + React frontend over WebSocket. Mature and production-ready.
See [`v1/README.md`](./v1/README.md) for setup, build, and Steam Deck install instructions.

## [`v2/`](./v2) — Steam Deck automotive HUD

A self-contained **Tauri 2 (Rust) + React** application optimized for an LCD Steam Deck. It
includes live USB GNSS, offline PMTiles maps, offline OSRM turn-by-turn navigation, trip recording,
local music, a shared low-wakeup map renderer, and explicit disconnected/no-fix/stale-fix states.
The vehicle-data abstraction leaves room for OBD2 later.

Run the full development app with simulated GNSS:

```bash
cd v2
npm ci
npm run dev:sim
```

After installing the `pmtiles` CLI and Docker, prepare the offline assets and build a Linux x86_64
AppImage for SteamOS:

```bash
cd v2
npm ci
npm run release:maps
npm run release:sidecar
npm run bundle:appimage
# dist/appimage/*.AppImage
```

See [`v2/README.md`](./v2/README.md) for prerequisites, live-GPS development, native Linux builds,
SteamOS installation, receiver permissions, and offline navigation data. SteamOS launch is manual
by design; the installer does not auto-start a graphical process from udev or enable it at login.
