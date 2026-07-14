#!/usr/bin/env bash
set -euo pipefail

# Extract the Steam Deck-compatible osrm-routed binary from the same pinned
# container image used to build routing graphs.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE="${SPEEDDECK_OSRM_IMAGE:-osrm/osrm-backend:v5.25.0}"
DEST="$V2_DIR/src-tauri/binaries/osrm-routed-x86_64-unknown-linux-gnu"

command -v docker >/dev/null 2>&1 || {
  echo "Error: Docker is required to fetch the Linux OSRM sidecar." >&2
  exit 1
}

mkdir -p "$(dirname "$DEST")"
container="$(docker create --platform linux/amd64 "$IMAGE")"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

docker cp "$container:/usr/local/bin/osrm-routed" "$DEST"
chmod 0755 "$DEST"

if command -v file >/dev/null 2>&1; then
  file "$DEST"
fi
echo "OSRM sidecar: $DEST"
