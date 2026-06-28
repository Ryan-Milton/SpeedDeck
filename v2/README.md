# SpeedDeck v2 — CarPlay-style infotainment (Tauri 2 + React)

A self-contained, pixel-faithful Apple CarPlay-style UI for the Steam Deck, built as a single
Tauri 2 (Rust) + React binary. GPS is the only vehicle sensor for now (no OBD2, no paired
phone); maps are offline-first. See the repo root `README.md` for how this relates to `v1/`.

## Status

Offline maps (Phase 4). The Maps surface is a live MapLibre moving map (heading-up camera with a
north-up toggle, vehicle marker, speed/heading overlays) driven by the `vehicle:state` feed. Tiles
resolve online → in-app cached → bundled PMTiles → blank. A Rust `maps/` module serves PMTiles and
cached tiles over range-capable custom protocols (`tiles://`, `tile-cache://`) and runs an in-app
tile downloader (Tauri commands + `tiles:download-progress` events); Settings → Offline Maps lists
regions, shows cache usage, and clears the cache.

Earlier phases: Phase 2 GPS spine (Rust vehicle layer), Phase 3 CarPlay shell (status bar, dock,
home grid, app switching; Dashboard shows live telemetry). Next: trips, turn-by-turn nav, music.

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

## TODO before first bundle

- Add app icons: `npm run tauri icon path/to/icon.png` (generates `src-tauri/icons/`), then set
  `bundle.active = true` in `tauri.conf.json`.
- Supply SF Pro font / CarPlay-style icon assets (personal use only; not committed).
