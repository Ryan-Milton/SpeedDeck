# SpeedDeck v2 — Steam Deck automotive HUD (Tauri 2 + React)

A self-contained automotive navigation and media HUD for the Steam Deck, built with Tauri 2
(Rust) and React. GPS is the only vehicle sensor for now (no OBD2 or paired phone), maps are
offline-first, and release builds target the LCD Steam Deck's x86_64 SteamOS environment. See the
repo root `README.md` for how this relates to `v1/`.

## Status

Steam Deck packaging is available as an **AppImage** with a fullscreen window. The SteamOS
installer grants the active Desktop-Mode session access to explicitly configured USB GPS receivers
and creates manual-launch entries. It does not run user-owned helpers from udev, auto-launch on USB
connect, or enable a service at login. (Spotify is deferred to a later phase.)

The app includes Maps, Music/Now Playing, Dashboard, Trips, Settings, local/offline navigation,
trip recording, and explicit live-GNSS health handling. See
[`docs/phase-6-navigation.md`](docs/phase-6-navigation.md) for navigation data details.

## Quick start

### Run the full development app

The simplest development path uses the built-in simulator and runs both the Rust backend and Tauri
webview:

```bash
cd v2
npm ci
npm run dev:sim
```

Simulation is explicit. A normal launch uses live GNSS and never invents movement when hardware is
absent:

```bash
cd v2
npm run tauri:dev

# Optional: force a specific receiver instead of USB auto-detection.
SPEEDDECK_GPS_PORT=/dev/serial/by-id/your-receiver npm run tauri:dev
```

For frontend-only work, run `npm run dev` and open `http://localhost:1420`. GPS, local maps,
routing, audio, and persistence require the full `tauri:dev` process. Linux development also
requires the packages listed under [Prerequisites](#prerequisites).

### Bundle an AppImage for SteamOS

The recommended path uses Docker and always builds Linux x86_64, even from an ARM or macOS host.
Install the [`pmtiles` CLI](https://github.com/protomaps/go-pmtiles) first, then run:

```bash
cd v2
npm ci
npm run release:maps       # generate every PMTiles pack in regions.json
npm run release:sidecar    # extract the matching x86_64 OSRM binary with Docker
npm run bundle:appimage    # output: dist/appimage/*.AppImage
```

The PMTiles download can be large. Map packs and the sidecar are intentionally ignored by Git and
validated before Docker starts the bundle build. The sidecar and graph builder use the same pinned
OSRM image; set `SPEEDDECK_OSRM_IMAGE=<image-or-digest>` to upgrade both deliberately.

On an x86_64 Linux workstation with all native dependencies installed, use the direct builder:

```bash
cd v2
./scripts/build-appimage.sh
# output: src-tauri/target/release/bundle/appimage/*.AppImage
```

## Install on SteamOS

Copy the AppImage to the Deck, enter Desktop Mode, and identify the receiver's exact USB ID:

```bash
lsusb
cd v2
./scripts/setup-steamos.sh --dry-run --receiver 067b:2303 /path/to/SpeedDeck.AppImage
./scripts/setup-steamos.sh --receiver 067b:2303 /path/to/SpeedDeck.AppImage
./scripts/setup-steamos.sh --check --receiver 067b:2303
```

`--receiver` accepts an exact four-digit hexadecimal `VID:PID` and may be repeated. Alternatively,
set `SPEEDDECK_RECEIVER_VID_PID=VID1:PID1,VID2:PID2`. The default is exactly `067b:2303`, retained
for the v1 PL2303 receiver; specify the ID from `lsusb` for every other receiver. The generated
udev rule has only `TAG+="uaccess"` for those exact devices and no `RUN` action, so it never executes
a user-writable file as root.

Launch manually after connecting the receiver: select **SpeedDeck** in Desktop Mode, run
`~/Applications/SpeedDeck.AppImage`, or run `systemctl --user start speeddeck.service`. The user
service is deliberately static, not enabled at login, and has no USB trigger. This preserves the
app's live disconnected/hotplug behavior without opening a graphical app in the wrong session.
Gaming Mode remains the manual "Add a Non-Steam Game" path. Do not add `--no-sandbox`; the AppImage
does not require a sandbox bypass.

Run `./scripts/setup-steamos.sh --check --receiver VID:PID` from Desktop Mode after reconnecting the
receiver. It checks the installed AppImage/rule/service, detects accidental service enablement, and
uses sysfs and udev to locate the configured receiver's tty, and fails when a connected configured
receiver has no matching readable and writable tty.
See [`docs/phase-8-steamos-validation.md`](docs/phase-8-steamos-validation.md) for the required
on-Deck USB, charging, suspend, and endurance validation matrix.

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

### Offline map data

Build the bundled PMTiles packs (needs the `pmtiles` CLI) into `src-tauri/resources/map/`:

```bash
cd v2 && ./scripts/download-tiles.sh            # seattle + western-washington
./scripts/download-tiles.sh --bbox "..." --zoom 0-14 --out custom.pmtiles
```

Regions are described in `src-tauri/resources/map/regions.json`. Bundled `.pmtiles` are gitignored
(produced at build time); the Rust `default_pmtiles_url` picks the first installed region.

### Vehicle data layer

`src-tauri/src/vehicle/` is built around a `VehicleProvider` trait + `VehicleHub`. GPS is the first
provider; OBD2 will be a second provider adding fields to `VehicleSample` with no downstream changes.
The app always starts the **live GPS** provider by default so late attachment, disconnects, no-fix,
and stale-fix states remain visible. The simulator runs only when `SPEEDDECK_SIMULATOR=1` is
explicitly set; `npm run dev:sim` sets it for you.

The core logic (`geo`, `nmea`, `processor`, `simulator`) is ported from v1 and unit-tested:

```bash
cd v2/src-tauri && cargo test    # needs the system libs above to build the full crate
```

## Prerequisites

- **Node 22.14.x** and **npm 10.9.x** (declared in `package.json`)
- **Rust 1.89.0** + Cargo (selected by `rust-toolchain.toml`)
- **Tauri CLI** is installed with the npm dependencies and exposed through `npm run tauri`
- **Linux system libs** for the WebKitGTK webview, e.g. on Arch/SteamOS:
  `webkit2gtk-4.1`, `gtk3`, `libappindicator-gtk3`, `librsvg`, `pkgconf`, `alsa-lib`, `systemd-libs`,
  and `xdotool`. Debian/Ubuntu builds need `pkg-config`, `libasound2-dev`, `libudev-dev`, and
  `libxdo-dev` in addition to the WebKitGTK packages (see `Dockerfile.build`).
   *(A Docker bundle build installs the Debian equivalents.)*
- **Release only:** a non-empty PMTiles file for every `regions.json` entry and an executable
  `src-tauri/binaries/osrm-routed-<target-triple>` sidecar. These are intentionally generated or
  obtained outside Git and are not required by normal frontend or Cargo tests.

## Common commands

| Command | Purpose |
|---|---|
| `npm run dev:sim` | Full Tauri development app with simulated GNSS |
| `npm run tauri:dev` | Full Tauri development app with live GNSS |
| `npm run dev` | Frontend-only Vite server |
| `npm test` | Frontend unit tests; no map assets required |
| `npm run build` | Type-check and build the frontend |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Rust tests |
| `npm run release:maps` | Generate all declared PMTiles packs |
| `npm run release:sidecar` | Fetch the pinned Linux x86_64 OSRM sidecar |
| `npm run release:preflight -- x86_64-unknown-linux-gnu` | Validate release inputs |
| `npm run bundle:appimage` | Build and export the SteamOS AppImage with Docker |

The release preflight checks the tracked lockfiles, Tauri resource mapping, every PMTiles v3
header, and the Linux x86_64 sidecar. It is deliberately not part of frontend development or
normal test commands.

## Runtime Performance Measurement

No target-device performance figures are claimed in this repository. Measure a release candidate
on the intended Steam Deck and record the artifact SHA-256, SteamOS build, Deck model, power/TDP
mode, display refresh rate/FPS cap, and test duration with the results. The commands below require
the Deck packages that provide `mangohud` and `pidstat` (`sysstat`).

```bash
# Build the candidate only after the release inputs have been supplied.
cd v2
npm run bundle:appimage
sha256sum dist/appimage/*.AppImage

# On the Deck, collect frame pacing with MangoHud for a fixed simulator scenario.
mkdir -p perf
MANGOHUD=1 MANGOHUD_CONFIG="output_folder=$PWD/perf,log_duration=60" \
  SPEEDDECK_SIMULATOR=1 dist/appimage/*.AppImage

# In a second terminal, sample CPU and RSS for the launched AppImage process.
pidstat -dur -p "$(pgrep -n SpeedDeck)" 1
```

Release gate: run the same scripted simulator route and manual interaction pass on the baseline and
candidate with the device settings above held constant. Archive the MangoHud and `pidstat` output;
do not release until the candidate meets the agreed frame-pacing, launch-time, CPU, memory, and
input-responsiveness budgets for that hardware. Any changed compiler profile or dependency requires
a fresh comparison rather than assuming an improvement.

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
