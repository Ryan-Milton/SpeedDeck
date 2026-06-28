#!/usr/bin/env bash
set -euo pipefail

# Build offline PMTiles basemaps for v2 from the Protomaps daily build.
# Ported from v1/scripts/download-tiles.sh; supports the region presets defined
# in src-tauri/resources/map/regions.json plus an arbitrary --bbox/--zoom.
#
# Usage:
#   ./download-tiles.sh                      # build all presets (seattle, western-washington)
#   ./download-tiles.sh seattle              # build a single preset by id
#   ./download-tiles.sh --bbox "-122.6,47.0,-122.0,47.8" --zoom 0-15 --out seattle.pmtiles
#
# Requires the `pmtiles` CLI:
#   brew install pmtiles
#   # or: go install github.com/protomaps/go-pmtiles/cmd/pmtiles@latest

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
V2_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$V2_DIR/src-tauri/resources/map"

# Protomaps free worldwide daily build. Bump this date as needed.
SOURCE_URL="${SPEEDDECK_PMTILES_SOURCE:-https://build.protomaps.com/20250328.pmtiles}"

if ! command -v pmtiles >/dev/null 2>&1; then
  echo "Error: 'pmtiles' CLI not found." >&2
  echo "  brew install pmtiles   # or: go install github.com/protomaps/go-pmtiles/cmd/pmtiles@latest" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

extract() {
  local bbox="$1" zoom="$2" out="$3"
  local min="${zoom%%-*}" max="${zoom##*-}"
  echo "==> $out  bbox=$bbox  zoom=$zoom"
  pmtiles extract "$SOURCE_URL" "$OUT_DIR/$out" \
    --bbox="$bbox" --minzoom="$min" --maxzoom="$max"
  echo "    $(du -h "$OUT_DIR/$out" | cut -f1)  ->  $OUT_DIR/$out"
}

# Region presets (id : bbox : zoom : outfile) — keep in sync with regions.json.
preset_seattle()            { extract "-122.6,47.0,-122.0,47.8" "0-15" "seattle.pmtiles"; }
preset_western_washington() { extract "-124.8,46.0,-120.5,49.0" "0-13" "western-washington.pmtiles"; }

# --- arg parsing ---
if [[ "${1:-}" == "--bbox" || "${1:-}" == "--zoom" || "${1:-}" == "--out" ]]; then
  BBOX=""; ZOOM="0-14"; OUT="custom.pmtiles"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --bbox) BBOX="$2"; shift 2 ;;
      --zoom) ZOOM="$2"; shift 2 ;;
      --out)  OUT="$2";  shift 2 ;;
      *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
  done
  [[ -z "$BBOX" ]] && { echo "--bbox is required" >&2; exit 1; }
  extract "$BBOX" "$ZOOM" "$OUT"
  exit 0
fi

case "${1:-all}" in
  seattle)            preset_seattle ;;
  western-washington) preset_western_washington ;;
  all)                preset_seattle; preset_western_washington ;;
  *) echo "Unknown preset '$1' (use: seattle | western-washington | all, or --bbox ...)" >&2; exit 1 ;;
esac

echo "Done. PMTiles written to $OUT_DIR (gitignored; bundled at build time)."
