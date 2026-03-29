# SpeedDeck

A real-time GPS speedometer HUD designed for the Steam Deck. Reads NMEA data from a USB GNSS receiver, displays a full dashboard with speed, heading, altitude, coordinates, and satellite info, and records trips with speed heatmap visualization and elevation profiles.

## Features

- **Large speed display** with 270-degree arc gauge, color-coded speed warnings
- **Live telemetry**: heading, altitude, coordinates, satellite count, fix quality
- **Trip recording** with start/stop controls and session statistics
- **Trip viewer** with speed heatmap overlay (green-yellow-red by velocity), start/end markers, elevation profile chart, and trip stats
- **Online/offline maps**: Carto Dark Matter tiles when online, bundled PMTiles when offline, plain dark fallback when neither is available
- **Unit switching**: MPH, KM/H, and knots with tap-to-cycle
- **10Hz GPS updates** via automatic receiver configuration (Airoha AG3335 PAIR commands)
- **Auto-detect serial port** on macOS and Linux
- **Satellite acquisition countdown** on startup (~30s cold start estimate)
- **Speed warning** with configurable threshold and full-screen red flash
- **Speed history graph** (10-minute rolling window at 1Hz)
- **GPX export** for recorded trips
- **Screen wake lock** to prevent display sleep while driving
- **Touch-friendly** controls with 56px minimum touch targets

## Supported Hardware

### GPS Receivers

Primary target:

- **Navisys GR-M02U** — Industrial grade L1+L5 dual-band USB GNSS receiver (Airoha AG3335 chipset, 10Hz, 1.5m accuracy, IPX7 waterproof)

Any USB GPS receiver that outputs standard NMEA 0183 sentences (GGA, RMC, VTG) over a serial interface should work. The app auto-detects:

| Platform | Serial patterns checked |
|----------|----------------------|
| macOS    | `/dev/tty.PL2303*`, `/dev/tty.usbserial-*`, `/dev/tty.usbmodem*`, `/dev/cu.*` variants |
| Linux    | `/dev/ttyUSB*`, `/dev/ttyACM*` |

Default baud rate is 115200. Override with `--serial-port` and `--baud` flags if needed.

### Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| **Steam Deck (SteamOS)** | Primary target | Runs as a non-Steam game in Gaming Mode. AppImage packaging, udev rules for USB serial, Gamescope fullscreen. |
| **Linux (x86_64)** | Supported | Any distro with USB serial support. Run the AppImage directly. |
| **macOS** | Supported (dev) | Requires Prolific PL2303 driver for the GR-M02U. Runs via `dev.sh`. |
| **Windows** | Not tested | Electron should work but serial port detection would need `COM*` patterns added. |

## Architecture

SpeedDeck is a two-process application:

```
USB GPS Receiver
    |
    | NMEA 0183 (serial, 115200 baud, up to 10Hz)
    v
Python Backend (pyserial + pynmea2 + websockets)
    |-- Serial reader thread (auto-reconnect with backoff)
    |-- NMEA parser (merges GGA + RMC + VTG into fix snapshots)
    |-- Data processor (EMA speed smoothing, trip stats, distance)
    |-- Trip recorder (SQLite, buffered writes, GPX export)
    |-- WebSocket server (broadcasts GPS state at update rate)
    |
    | WebSocket (localhost:8765, JSON)
    v
Electron Frontend (React 19 + Zustand + Tailwind CSS 4 + MapLibre GL JS)
    |-- HUD dashboard (speed, compass, altitude, coords, satellites)
    |-- Trip controls (start/stop recording)
    |-- Trip viewer (map with speed heatmap, elevation chart, stats)
    |-- Settings (units, speed warning, trip list)
```

### Backend

3 Python dependencies: `pyserial`, `pynmea2`, `websockets`. Data stored in SQLite. All values in SI internally (m/s, meters), converted at the display layer.

### Frontend

React 19 with Zustand for state management, Tailwind CSS 4 for styling, Recharts for graphs, MapLibre GL JS for trip map visualization, and Lucide React for icons. Built with electron-vite.

## Quick Start

### Prerequisites

- Python 3.9+
- Node.js 20+
- A USB GPS receiver (or use `--simulator` mode)

### Development

```bash
# Clone the repo
git clone https://github.com/yourusername/speeddeck.git
cd speeddeck

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies
pip install pyserial pynmea2 websockets

# Run with simulated GPS data
bash scripts/dev.sh --simulator

# Run with real GPS receiver (auto-detects serial port)
bash scripts/dev.sh
```

The dev script starts the Python backend and launches Electron with hot reload.

### Building for Steam Deck

Builds a self-contained Linux x86_64 AppImage using Docker (works from macOS):

```bash
# Build the AppImage
bash scripts/build-linux.sh

# Output: dist/SpeedDeck-*.AppImage
```

This uses a multi-stage Docker build:
1. Compiles the Python backend into a standalone binary with PyInstaller
2. Builds the Electron app and packages everything into an AppImage

### Installing on Steam Deck

```bash
# Copy the AppImage to your Steam Deck, then run:
bash scripts/setup-steamos.sh ~/Downloads/SpeedDeck.AppImage
```

The setup script:
1. Installs the AppImage to `~/Applications/`
2. Adds a udev rule for USB serial GPS access (Prolific PL2303)
3. Creates a `.desktop` entry for adding as a non-Steam game
4. Prints instructions for Gaming Mode touchscreen configuration

### Offline Map Tiles

The trip viewer uses online Carto Dark Matter tiles by default. For offline use, download regional tiles:

```bash
# Install the pmtiles CLI
brew install pmtiles

# Download tiles for your region (defaults to Seattle/Tacoma metro)
bash scripts/download-tiles.sh

# Custom region
bash scripts/download-tiles.sh --bbox "-122.5,47.0,-121.5,47.8"
```

Tiles are stored in `frontend/resources/map/basemap.pmtiles` and bundled into the AppImage.

## Project Structure

```
speeddeck/
├── backend/
│   └── gps_speedometer/
│       ├── __main__.py          # Entry point, wires everything together
│       ├── config.py            # Config + serial port auto-detection
│       ├── gps/
│       │   ├── serial_reader.py # Threaded serial reader with reconnect
│       │   ├── nmea_parser.py   # NMEA sentence parser (GGA/RMC/VTG)
│       │   ├── data_processor.py# Speed smoothing, trip stats
│       │   └── simulator.py     # Fake GPS for development
│       ├── trip/
│       │   ├── database.py      # SQLite schema and queries
│       │   ├── recorder.py      # Trip state machine
│       │   └── gpx_export.py    # GPX 1.1 XML generation
│       └── server/
│           ├── ws_server.py     # Async WebSocket server
│           └── protocol.py      # Message types + JSON serialization
├── frontend/
│   └── src/
│       ├── main/                # Electron main process
│       ├── preload/             # Context bridge
│       └── renderer/src/
│           ├── components/
│           │   ├── hud/         # SpeedDisplay, CompassWidget, etc.
│           │   ├── trip/        # TripMap, TripDetailView, charts
│           │   ├── settings/    # SettingsPanel, TripListSection
│           │   └── shared/      # StatusBar, ControlBar
│           ├── stores/          # Zustand stores
│           ├── hooks/           # useGpsConnection
│           └── lib/             # Utils, WebSocket client
├── scripts/
│   ├── dev.sh                   # Start backend + frontend for development
│   ├── build-linux.sh           # Docker-based Linux AppImage build
│   ├── setup-steamos.sh         # Steam Deck installation
│   └── download-tiles.sh        # Download offline map tiles
├── Dockerfile.build             # Multi-stage build for cross-compilation
└── data/                        # Runtime data (gitignored)
```

## Configuration

The backend accepts command-line flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir` | `./data` | Directory for SQLite database and config |
| `--simulator` | off | Use simulated GPS data instead of real hardware |
| `--serial-port` | auto-detect | Override serial port path |
| `--port` | `8765` | WebSocket server port |

## License

[MIT](LICENSE)
