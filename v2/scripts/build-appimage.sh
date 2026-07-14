#!/usr/bin/env bash
set -euo pipefail

# Build the SpeedDeck AppImage (Linux x86_64).
#
# Run this on a Linux machine that has the WebKitGTK development libraries.
# Dockerfile.build installs these dependencies and can bundle headlessly.
#
# System prerequisites:
#   Arch / SteamOS : webkit2gtk-4.1 gtk3 libappindicator-gtk3 librsvg base-devel \
#                    pkgconf alsa-lib systemd-libs xdotool
#   Debian/Ubuntu  : libwebkit2gtk-4.1-dev build-essential libssl-dev \
#                    libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
#                    pkg-config libasound2-dev libudev-dev libxdo-dev
#   Plus: Rust 1.89.0 (rust-toolchain.toml) + Node 22.14.x / npm 10.9.x
#
# The map PMTiles assets and navigation sidecar must be present for bundling.
# `check-release-assets.sh` verifies the manifest, every declared PMTiles pack,
# and the target-specific sidecar before spending time on the build.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

[[ "$(uname -s)" == Linux ]] || {
  echo "Error: native AppImage builds require Linux x86_64; use Docker from other hosts" >&2
  exit 1
}
[[ "$(uname -m)" == x86_64 ]] || {
  echo "Error: native AppImage builds support only x86_64, not $(uname -m)" >&2
  exit 1
}

TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
[[ "$TRIPLE" == x86_64-unknown-linux-gnu ]] || {
  echo "Error: Rust host must be x86_64-unknown-linux-gnu, got: ${TRIPLE:-unknown}" >&2
  exit 1
}
bash ./scripts/check-release-assets.sh "$TRIPLE"

npm ci
npm run tauri:build

shopt -s nullglob
artifacts=(src-tauri/target/release/bundle/appimage/*.AppImage)
(( ${#artifacts[@]} == 1 )) || {
  echo "Error: expected exactly one AppImage, found ${#artifacts[@]}" >&2
  exit 1
}
[[ -s "${artifacts[0]}" && -x "${artifacts[0]}" ]] || {
  echo "Error: AppImage is missing, empty, or not executable: ${artifacts[0]}" >&2
  exit 1
}
echo "AppImage output: ${artifacts[0]}"
