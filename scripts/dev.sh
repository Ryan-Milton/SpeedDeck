#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$ROOT_DIR/data"

mkdir -p "$DATA_DIR"

# Parse flags
MODE=""
if [[ "${1:-}" == "--simulator" ]]; then
  MODE="--simulator"
  echo "[dev] Starting GPS backend (simulator mode)..."
elif [[ "${1:-}" == "--live" || -z "${1:-}" ]]; then
  echo "[dev] Starting GPS backend (live GPS mode — auto-detecting receiver)..."
else
  echo "Usage: dev.sh [--simulator | --live]"
  exit 1
fi

cd "$ROOT_DIR/backend"
python3 -m gps_speedometer --data-dir "$DATA_DIR" $MODE &
BACKEND_PID=$!

cleanup() {
  echo "[dev] Shutting down..."
  kill "$BACKEND_PID" 2>/dev/null || true
  wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for backend to be ready
for i in $(seq 1 20); do
  if python3 -c "import socket; s=socket.socket(); s.settimeout(0.1); s.connect(('127.0.0.1', 8765)); s.close()" 2>/dev/null; then
    echo "[dev] Backend ready."
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[dev] Backend exited unexpectedly." >&2
    exit 1
  fi
  sleep 0.25
done

# Launch Electron + Vite dev server
echo "[dev] Starting Electron frontend..."
cd "$ROOT_DIR/frontend"
exec npx electron-vite dev
