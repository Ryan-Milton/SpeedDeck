# SpeedDeck v2 — CarPlay-style infotainment (Tauri 2 + React)

A self-contained, pixel-faithful Apple CarPlay-style UI for the Steam Deck, built as a single
Tauri 2 (Rust) + React binary. GPS is the only vehicle sensor for now (no OBD2, no paired
phone); maps are offline-first. See the repo root `README.md` for how this relates to `v1/`.

## Status

Turn-by-turn navigation (Phase 6). A Rust `nav/` module runs the bundled `osrm-routed` engine as a
Tauri sidecar, calculates routes (`reqwest` → OSRM, with the speed-adaptive bearing constraint and
v1's fallbacks), and geocodes via offline FTS5 (`places.db`) with a Nominatim online fallback.
The frontend ports v1's guidance math/store/components: destination search, route preview, turn
banner, ETA/speed-limit status bar, and automatic rerouting driven by the GPS feed; the route is
drawn on the live map. Routing data is delivered as **in-app downloaded region packs**.

Earlier phases: Phase 2 GPS spine, Phase 3 CarPlay shell, Phase 4 offline maps, Phase 5 trip
recording. Next: local music, dashboard split-view, Spotify + Steam Deck kiosk packaging.
Phase 6 is specified in [`docs/phase-6-navigation.md`](docs/phase-6-navigation.md).

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

## TODO before first bundle

- Add app icons: `npm run tauri icon path/to/icon.png` (generates `src-tauri/icons/`), then set
  `bundle.active = true` in `tauri.conf.json`.
- Supply SF Pro font / CarPlay-style icon assets (personal use only; not committed).
