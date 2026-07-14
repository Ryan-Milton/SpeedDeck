#!/usr/bin/env bash
set -euo pipefail

# Build an OSRM MLD routing graph for a region (off-device) using the
# osrm/osrm-backend Docker image, then package it into a downloadable pack.
#
# Usage:
#   ./build-osrm-graph.sh <region-id> <geofabrik-pbf-url> [places.db]
# Example:
#   ./build-osrm-graph.sh western-washington \
#     https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf \
#     dist/nav/western-washington/places.db
#
# Output: dist/nav/<region-id>/region.osrm*  and  dist/nav/<region-id>.zip
# The .zip (region.osrm* + places.db) is what you host and reference from
# regions.json `navPackUrl`, or sideload by extracting into the app data dir's
# nav/<region-id>/ directory.

ID="${1:?region id, e.g. western-washington}"
PBF_URL="${2:?geofabrik .osm.pbf url}"
PLACES_DB="${3:-}"

IMG="${OSRM_IMAGE:-${SPEEDDECK_OSRM_IMAGE:-osrm/osrm-backend:v5.25.0}}"
PROFILE="${OSRM_PROFILE:-/opt/car.lua}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$SCRIPT_DIR/../dist/nav/$ID"
mkdir -p "$OUT"

echo "==> Downloading PBF for $ID"
curl -L --fail "$PBF_URL" -o "$OUT/region.osm.pbf"

run() { docker run --rm -v "$OUT:/data" "$IMG" "$@"; }

echo "==> osrm-extract"
run osrm-extract -p "$PROFILE" /data/region.osm.pbf
echo "==> osrm-partition"
run osrm-partition /data/region.osrm
echo "==> osrm-customize"
run osrm-customize /data/region.osrm
rm -f "$OUT/region.osm.pbf"

if [[ -n "$PLACES_DB" && -f "$PLACES_DB" ]]; then
  cp "$PLACES_DB" "$OUT/places.db"
fi

echo "==> Packaging dist/nav/$ID.zip"
( cd "$OUT" && zip -j "../$ID.zip" region.osrm* $( [[ -f places.db ]] && echo places.db ) )

echo "Done:"
echo "  graph dir : $OUT"
echo "  pack      : $SCRIPT_DIR/../dist/nav/$ID.zip"
echo "Host the .zip and set its URL as regions.json navPackUrl, or sideload by"
echo "extracting it into <app-data>/nav/$ID/."
