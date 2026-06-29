#!/usr/bin/env bash
set -euo pipefail

# Build the SpeedDeck AppImage for Linux x86_64 using Docker.
# Works from macOS (Apple Silicon or Intel) via Docker Desktop.
#
# Usage: ./scripts/build-linux.sh
# Output: dist/SpeedDeck-*.AppImage

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$ROOT_DIR/dist"

cd "$ROOT_DIR"

echo "=== Building SpeedDeck for Linux x86_64 ==="
echo ""

# Check Docker is available
if ! command -v docker &>/dev/null; then
  echo "Error: Docker is required for cross-platform builds."
  echo "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  exit 1
fi

# Ensure Docker is running
if ! docker info &>/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker Desktop first."
  exit 1
fi

mkdir -p "$DIST_DIR"

echo "Step 1/3: Building Python backend (PyInstaller, linux/amd64)..."
echo "Step 2/3: Building Electron frontend (electron-builder, AppImage)..."
echo ""

# Build using multi-stage Dockerfile, extract the AppImage
docker build \
  --platform linux/amd64 \
  -f Dockerfile.build \
  --output "type=local,dest=$DIST_DIR" \
  . 2>&1

echo ""
echo "Step 3/3: Done!"
echo ""

# Show output
APPIMAGE=$(ls "$DIST_DIR"/*.AppImage 2>/dev/null | head -1)
if [[ -n "$APPIMAGE" ]]; then
  SIZE=$(du -h "$APPIMAGE" | cut -f1)
  echo "=== Build complete ==="
  echo "Output: $APPIMAGE ($SIZE)"
  echo ""
  echo "To install on Steam Deck:"
  echo "  1. Copy the AppImage to your Steam Deck"
  echo "  2. Run: chmod +x *.AppImage"
  echo "  3. Run: bash scripts/setup-steamos.sh"
  echo "  4. Add as a non-Steam game in Steam"
else
  echo "Error: No AppImage found in $DIST_DIR"
  exit 1
fi
