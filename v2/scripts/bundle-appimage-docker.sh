#!/usr/bin/env bash
set -euo pipefail

# Build a Linux x86_64 AppImage from any host with Docker BuildKit.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${SPEEDDECK_APPIMAGE_OUTPUT:-$V2_DIR/dist/appimage}"

command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is required to bundle the AppImage." >&2
  exit 1
}

mkdir -p "$OUTPUT_DIR"
DOCKER_BUILDKIT=1 docker build \
  --platform linux/amd64 \
  -f "$V2_DIR/Dockerfile.build" \
  --output "type=local,dest=$OUTPUT_DIR" \
  "$V2_DIR"

shopt -s nullglob
artifacts=("$OUTPUT_DIR"/*.AppImage)
(( ${#artifacts[@]} > 0 )) || {
  echo "Error: Docker build completed without exporting an AppImage." >&2
  exit 1
}
echo "AppImage output: ${artifacts[0]}"
