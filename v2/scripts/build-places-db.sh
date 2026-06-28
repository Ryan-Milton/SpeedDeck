#!/usr/bin/env bash
set -euo pipefail

# Build the offline geocoder index (places.db) for a region by reusing v1's
# proven builder (osmium + OpenAddresses). Run off-device; the resulting
# places.db is packaged into the region's nav pack by build-osrm-graph.sh.
#
# Usage:
#   ./build-places-db.sh <region.osm.pbf> <out/places.db> [openaddresses.geojson.gz]
#
# Requires the v1 backend deps: pip install osmium (in v1/backend).

PBF="${1:?path to region .osm.pbf}"
OUT_DB="${2:?output places.db path}"
OA="${3:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)" # SpeedDeck repo root
mkdir -p "$(dirname "$OUT_DB")"

cd "$ROOT/v1/backend"
python3 - "$PBF" "$OUT_DB" "$OA" <<'PY'
import sys
from gps_speedometer.navigation.geocoder import build_geocoder_index
pbf, out_db, oa = sys.argv[1], sys.argv[2], (sys.argv[3] or None)
build_geocoder_index(pbf, out_db, oa)
print(f"places.db written to {out_db}")
PY
