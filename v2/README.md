# SpeedDeck v2 — CarPlay-style infotainment (Tauri 2 + React)

A self-contained, pixel-faithful Apple CarPlay-style UI for the Steam Deck, built as a single
Tauri 2 (Rust) + React binary. GPS is the only vehicle sensor for now (no OBD2, no paired
phone); maps are offline-first. See the repo root `README.md` for how this relates to `v1/`.

## Status

Steam Deck packaging + kiosk (Phase 9). The app bundles as an **AppImage** (real icons, kiosk
fullscreen window) and ships a `setup-steamos.sh` installer that adds a udev rule for the USB GPS
receiver (broadened vendor IDs, non-root `uaccess`), a **systemd user service**, and a
udev-triggered **auto-launch on GPS connect** — with the "Add as Non-Steam Game" path as the
Gaming-Mode fallback. (Spotify is deferred to a later phase.)

Earlier phases: Phase 2 GPS spine, Phase 3 CarPlay shell, Phase 4 offline maps, Phase 5 trip
recording, Phase 6 turn-by-turn navigation (see
[`docs/phase-6-navigation.md`](docs/phase-6-navigation.md)), Phase 7 local music, Phase 8 dashboard
split view. The CarPlay surface set (Home, Maps, Music/Now Playing, Dashboard, Trips, Settings) is
complete.

## Build & install on the Steam Deck

```bash
cd v2
# 1. Place the navigation sidecar (see docs/phase-6-navigation.md):
#    src-tauri/binaries/osrm-routed-x86_64-unknown-linux-gnu
# 2. Build the AppImage (needs webkit2gtk — run on the Deck / a Linux box / CI):
./scripts/build-appimage.sh
#    or, reproducibly via Docker:
#    DOCKER_BUILDKIT=1 docker build -f Dockerfile.build --output type=local,dest=dist .
# 3. Install on the Deck (Desktop Mode):
./scripts/setup-steamos.sh   # finds the AppImage, installs udev + systemd-user + desktop entry
```

Auto-boot path is **Desktop Mode** (a udev rule starts the systemd user service when the GPS
receiver is plugged in); Gaming Mode is the manual "non-Steam game" fallback. The build can't run
in headless containers (no WebKitGTK).

### Navigation data (off-device build)

Routing needs the `osrm-routed` sidecar binary and a per-region pack (graph + geocoder DB):

```bash
# 1. OSRM sidecar binary for the Steam Deck (x86_64) — from the Docker image:
#    place it at src-tauri/binaries/osrm-routed-x86_64-unknown-linux-gnu
# 2. Build a region pack (graph + places.db):
cd v2
./scripts/build-places-db.sh path/to/western-washington.osm.pbf dist/nav/western-washington/places.db
./scripts/build-osrm-graph.sh western-washington \
  https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf \
  dist/nav/western-washington/places.db
# -> dist/nav/western-washington.zip
```

Host the `.zip` and set its URL as `navPackUrl` in `src-tauri/resources/map/regions.json` (then it
downloads in-app from Settings/Maps), or **sideload** by extracting it into the app data dir's
`nav/<region>/`. Search works offline from the pack's `places.db` and falls back to Nominatim
online.

The shell + map can be previewed in a plain browser with `npm run dev` (Tauri IPC is inert there,
so it shows the "no GPS"/blank-map state — useful for UI work without the full webview build).

### Offline map data

Build the bundled PMTiles packs (needs the `pmtiles` CLI) into `src-tauri/resources/map/`:

```bash
cd v2 && ./scripts/download-tiles.sh            # seattle + western-washington
./scripts/download-tiles.sh --bbox "..." --zoom 0-14 --out custom.pmtiles
```

Regions are described in `src-tauri/resources/map/regions.json`. Bundled `.pmtiles` are gitignored
(produced at build time); the Rust `default_pmtiles_url` picks the first installed region.

### Vehicle data layer

`src-tauri/src/vehicle/` is built around a `VehicleProvider` trait + `VehicleHub`. GPS is
provider #1; OBD2 will be a second provider adding fields to `VehicleSample` with no downstream
changes. By default the app uses the **live GPS** provider when a receiver is detected, else the
**simulator**. Force the simulator with `SPEEDDECK_SIMULATOR=1`.

The core logic (`geo`, `nmea`, `processor`, `simulator`) is ported from v1 and unit-tested:

```bash
cd v2/src-tauri && cargo test    # needs the system libs above to build the full crate
```

## Prerequisites

- **Node 18+** and **npm**
- **Rust** (stable) + Cargo
- **Tauri CLI**: `cargo install tauri-cli --version "^2"` (or use the bundled `npm run tauri`)
- **Linux system libs** for the WebKitGTK webview, e.g. on Arch/SteamOS:
  `webkit2gtk-4.1`, `gtk3`, `libappindicator-gtk3`, `librsvg` (see the Tauri Linux setup docs).
  *(These are not present in CI sandboxes, so the Rust/webview build runs on your dev machine or
  the Deck, not in headless containers.)*

## Develop

```bash
cd v2
npm install
npm run dev          # frontend only (Vite on :1420) — useful in headless/CI
npm run tauri:dev    # full app (Rust + webview) — needs the system libs above
```

## Build

```bash
cd v2
npm run tauri:build  # produces an AppImage (after icons are added; see below)
```

## Project layout

```
v2/
├── index.html, vite.config.ts, tsconfig*.json, package.json
├── src/                     # React frontend
│   ├── App.tsx, main.tsx, styles.css
│   ├── lib/ipc.ts           # invoke()/listen() bridge (replaces v1 ws-client.ts)
│   └── stores/              # zustand stores (vehicle, ... )
└── src-tauri/               # Rust backend
    ├── Cargo.toml, build.rs, tauri.conf.json
    ├── capabilities/        # Tauri 2 permission capabilities
    └── src/{main.rs,lib.rs}
```

## Assets / notes

- App icons are generated and `bundle.active = true` (Phase 9). To re-brand:
  `npm run tauri icon path/to/icon.png` regenerates `src-tauri/icons/`.
- Supply SF Pro font / CarPlay-style icon assets for full pixel fidelity (personal use only; not
  committed).
