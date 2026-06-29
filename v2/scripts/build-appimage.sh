#!/usr/bin/env bash
set -euo pipefail

# Build the SpeedDeck AppImage (Linux x86_64).
#
# Run this on a machine that has a WebKitGTK webview (the Steam Deck itself, a
# Linux dev box, or CI) — it CANNOT run in a headless container without the
# webview/dev libraries.
#
# System prerequisites:
#   Arch / SteamOS : webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg base-devel
#   Debian/Ubuntu  : libwebkit2gtk-4.1-dev build-essential libssl-dev \
#                    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
#   Plus: Rust (stable) + Node 18+
#
# The navigation sidecar must be present for bundling:
#   src-tauri/binaries/osrm-routed-<target-triple>
# (build/obtain it per docs/phase-6-navigation.md). For a nav-disabled build,
# temporarily remove "externalBin" from src-tauri/tauri.conf.json.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
SIDECAR="src-tauri/binaries/osrm-routed-${TRIPLE}"
if [[ ! -x "$SIDECAR" ]]; then
  echo "WARNING: sidecar '$SIDECAR' missing — navigation needs the osrm-routed binary." >&2
  echo "         Build/obtain it (docs/phase-6-navigation.md), or drop bundle.externalBin" >&2
  echo "         from src-tauri/tauri.conf.json for a nav-disabled build." >&2
fi

npm ci
npm run tauri:build

echo ""
echo "AppImage output:"
ls -1 src-tauri/target/release/bundle/appimage/*.AppImage 2>/dev/null \
  || echo "  (no AppImage found — check the build log above)"
