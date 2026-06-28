#!/usr/bin/env bash
set -euo pipefail

# Download regional PMTiles for offline map support
# Usage: ./download-tiles.sh [--bbox "west,south,east,north"] [--zoom "0-14"]
#
# Examples:
#   ./download-tiles.sh                                    # Pacific NW default
#   ./download-tiles.sh --bbox "-122.5,47.0,-121.5,47.8"  # Custom region
#   ./download-tiles.sh --bbox "-124.0,45.0,-116.5,49.0"  # Entire PNW

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$ROOT_DIR/frontend/resources/map"
OUTPUT_FILE="$OUTPUT_DIR/basemap.pmtiles"

# Defaults: greater Seattle/Tacoma metro area
BBOX="-122.6,47.0,-122.0,47.8"
ZOOM="0-14"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --bbox) BBOX="$2"; shift 2 ;;
    --zoom) ZOOM="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# Check for pmtiles CLI
if ! command -v pmtiles &>/dev/null; then
  echo "pmtiles CLI not found. Install with:"
  echo "  brew install pmtiles"
  echo "  # or: go install github.com/protomaps/go-pmtiles/cmd/pmtiles@latest"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Protomaps provides a free worldwide PMTiles build updated daily
SOURCE_URL="https://build.protomaps.com/20250328.pmtiles"

echo "Extracting tiles for bbox: $BBOX, zoom: $ZOOM"
echo "Source: $SOURCE_URL"
echo "Output: $OUTPUT_FILE"
echo ""

pmtiles extract "$SOURCE_URL" "$OUTPUT_FILE" \
  --bbox="$BBOX" \
  --maxzoom="${ZOOM##*-}" \
  --minzoom="${ZOOM%%-*}"

SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo ""
echo "Done! Downloaded $SIZE to $OUTPUT_FILE"
