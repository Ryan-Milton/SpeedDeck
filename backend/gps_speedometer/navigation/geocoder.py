"""Offline geocoder using SQLite FTS5, built from OSM PBF + OpenAddresses data."""

from __future__ import annotations

import csv
import io
import json
import logging
import math
import sqlite3
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

log = logging.getLogger(__name__)

EARTH_RADIUS_M = 6_371_000
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.asin(math.sqrt(a))


def build_geocoder_index(pbf_path: str, db_path: str, openaddresses_zip: str | None = None) -> None:
    """Build geocoding index from OSM PBF + optional OpenAddresses data.

    Args:
        pbf_path: Path to the OSM PBF file
        db_path: Path to create the SQLite database
        openaddresses_zip: Optional path to OpenAddresses ZIP file
    """
    try:
        import osmium
    except ImportError:
        log.error("osmium package not installed. Run: pip install osmium")
        raise

    log.info("Building geocoder index from %s (this will take 15-20 minutes)", pbf_path)

    db = sqlite3.connect(db_path)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=OFF")

    db.executescript("""
        DROP TABLE IF EXISTS places;
        DROP TABLE IF EXISTS places_fts;

        CREATE TABLE places(
            rowid INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            importance INTEGER DEFAULT 0
        );
    """)

    count = 0
    batch: list[tuple] = []

    # --- Phase 1: Parse OSM PBF ---
    class PlaceHandler(osmium.SimpleHandler):
        def node(self, n):
            nonlocal count
            tags = dict(n.tags)
            name = tags.get("name", "")
            lat = n.location.lat
            lon = n.location.lon

            # Cities/towns/villages
            place_type = tags.get("place", "")
            if place_type in ("city", "town", "village", "hamlet", "suburb", "neighbourhood") and name:
                importance = {"city": 100, "town": 80, "village": 60, "hamlet": 40, "suburb": 50, "neighbourhood": 30}.get(place_type, 20)
                batch.append((name, "city", lat, lon, importance))
                count += 1

            # POIs
            elif any(tags.get(k) for k in ("amenity", "shop", "tourism", "leisure")) and name:
                batch.append((name, "poi", lat, lon, 20))
                count += 1

            # Addresses
            housenumber = tags.get("addr:housenumber", "")
            street = tags.get("addr:street", "")
            city = tags.get("addr:city", "")
            if housenumber and street:
                addr_name = f"{housenumber} {street}"
                if city:
                    addr_name += f", {city}"
                batch.append((addr_name, "address", lat, lon, 10))
                count += 1

            if len(batch) >= 5000:
                _flush(db, batch)
                if count % 50000 == 0:
                    log.info("  ... %d places indexed so far (OSM)", count)

        def way(self, w):
            nonlocal count
            tags = dict(w.tags)
            name = tags.get("name", "")
            highway = tags.get("highway", "")

            # Named roads
            if highway and name and highway in (
                "motorway", "trunk", "primary", "secondary", "tertiary",
                "residential", "living_street", "unclassified"
            ):
                nodes = list(w.nodes)
                if nodes:
                    mid = nodes[len(nodes) // 2]
                    try:
                        batch.append((name, "road", mid.lat, mid.lon, 30))
                        count += 1
                    except osmium.InvalidLocationError:
                        pass

                if len(batch) >= 5000:
                    _flush(db, batch)
                    if count % 50000 == 0:
                        log.info("  ... %d places indexed so far (OSM)", count)

    handler = PlaceHandler()
    handler.apply_file(pbf_path, locations=True)

    if batch:
        _flush(db, batch)

    osm_count = count
    log.info("OSM parsing complete: %d places from PBF", osm_count)

    # --- Phase 2: Import OpenAddresses ---
    # Look for either .geojson.gz or .zip format
    if openaddresses_zip and Path(openaddresses_zip).exists():
        oa_count = _import_openaddresses(db, openaddresses_zip)
        count += oa_count
        log.info("OpenAddresses import complete: %d addresses added", oa_count)

    # --- Phase 3: Build FTS5 index ---
    log.info("Building FTS5 search index for %d total places...", count)
    db.executescript("""
        CREATE VIRTUAL TABLE IF NOT EXISTS places_fts USING fts5(
            name,
            category,
            content='places',
            content_rowid='rowid'
        );

        INSERT INTO places_fts(rowid, name, category)
        SELECT rowid, name, category FROM places;
    """)

    db.execute("PRAGMA synchronous=NORMAL")
    db.commit()
    db.close()

    log.info("Geocoder index built: %d places total (%d OSM + %d OpenAddresses)",
             count, osm_count, count - osm_count)


def _import_openaddresses(db: sqlite3.Connection, file_path: str) -> int:
    """Import addresses from an OpenAddresses file (GeoJSON.gz or ZIP/CSV)."""
    log.info("Importing OpenAddresses from %s", file_path)
    count = 0
    batch: list[tuple] = []

    try:
        if file_path.endswith(".geojson.gz"):
            count = _import_geojson_gz(db, file_path, batch)
        elif file_path.endswith(".zip"):
            count = _import_csv_zip(db, file_path, batch)
        else:
            log.warning("Unknown OpenAddresses format: %s", file_path)

        if batch:
            _flush(db, batch)

    except Exception as e:
        log.warning("OpenAddresses import error: %s (continuing with OSM data only)", e)

    return count


def _import_geojson_gz(db: sqlite3.Connection, gz_path: str, batch: list[tuple]) -> int:
    """Import from GeoJSON.gz format (batch.openaddresses.io output)."""
    import gzip

    count = 0
    with gzip.open(gz_path, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                feature = json.loads(line)
            except json.JSONDecodeError:
                continue

            props = feature.get("properties", {})
            geom = feature.get("geometry", {})

            number = (props.get("number") or "").strip()
            street = (props.get("street") or "").strip()
            city = (props.get("city") or "").strip()
            coords = geom.get("coordinates", [])

            if not number or not street or len(coords) < 2:
                continue

            lon_f, lat_f = coords[0], coords[1]
            addr_name = f"{number} {street}"
            if city:
                addr_name += f", {city}"

            batch.append((addr_name, "address", lat_f, lon_f, 10))
            count += 1

            if len(batch) >= 10000:
                _flush(db, batch)
                if count % 100000 == 0:
                    log.info("  ... %d addresses imported (OpenAddresses)", count)

    return count


def _import_csv_zip(db: sqlite3.Connection, zip_path: str, batch: list[tuple]) -> int:
    """Import from ZIP/CSV format (legacy OpenAddresses)."""
    count = 0
    with zipfile.ZipFile(zip_path) as zf:
        csv_files = [f for f in zf.namelist() if f.endswith(".csv")]
        for csv_name in csv_files:
            with zf.open(csv_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="replace"))
                for row in reader:
                    number = (row.get("NUMBER") or "").strip()
                    street = (row.get("STREET") or "").strip()
                    city = (row.get("CITY") or "").strip()
                    lon = row.get("LON", "")
                    lat = row.get("LAT", "")

                    if not number or not street or not lat or not lon:
                        continue

                    try:
                        lat_f = float(lat)
                        lon_f = float(lon)
                    except (ValueError, TypeError):
                        continue

                    addr_name = f"{number} {street}"
                    if city:
                        addr_name += f", {city}"

                    batch.append((addr_name, "address", lat_f, lon_f, 10))
                    count += 1

                    if len(batch) >= 10000:
                        _flush(db, batch)
                        if count % 100000 == 0:
                            log.info("  ... %d addresses imported (OpenAddresses)", count)

    return count


def _flush(db: sqlite3.Connection, batch: list[tuple]) -> None:
    db.executemany(
        "INSERT INTO places (name, category, latitude, longitude, importance) VALUES (?, ?, ?, ?, ?)",
        batch,
    )
    db.commit()
    batch.clear()


def _nominatim_search(query: str, near_lat: float | None, near_lon: float | None) -> list[dict]:
    """Search Nominatim as an online fallback. Returns empty list on failure."""
    try:
        params = {
            "q": query,
            "format": "json",
            "limit": "5",
            "countrycodes": "us",
            "addressdetails": "1",
        }
        if near_lat is not None and near_lon is not None:
            params["viewbox"] = f"{near_lon - 0.5},{near_lat - 0.5},{near_lon + 0.5},{near_lat + 0.5}"
            params["bounded"] = "0"

        url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": "SpeedDeck/1.0"})

        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())

        results = []
        for item in data:
            name = item.get("display_name", "")
            lat = float(item.get("lat", 0))
            lon = float(item.get("lon", 0))
            osm_type = item.get("type", "")

            category = "address"
            if osm_type in ("city", "town", "village", "hamlet"):
                category = "city"
            elif osm_type in ("residential", "primary", "secondary", "tertiary"):
                category = "road"

            distance = 0.0
            if near_lat is not None and near_lon is not None:
                distance = _haversine(near_lat, near_lon, lat, lon)

            results.append({
                "name": name,
                "category": category,
                "latitude": lat,
                "longitude": lon,
                "importance": 15,
                "distance": distance,
                "source": "online",
            })

        return results

    except Exception:
        return []


class Geocoder:
    """Search the offline geocoding index with online Nominatim fallback."""

    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: sqlite3.Connection | None = None

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            if not Path(self._db_path).exists():
                raise FileNotFoundError(f"Geocoder database not found: {self._db_path}")
            self._conn = sqlite3.connect(self._db_path)
            self._conn.row_factory = sqlite3.Row
        return self._conn

    def _fts_search(self, query: str, near_lat: float | None, near_lon: float | None, limit: int) -> list[dict]:
        """Run an FTS5 prefix search against the local index."""
        conn = self._get_conn()
        safe_query = query.replace('"', '""').strip()
        fts_query = f'"{safe_query}"*'

        rows = conn.execute("""
            SELECT p.rowid, p.name, p.category, p.latitude, p.longitude, p.importance
            FROM places_fts
            JOIN places p ON places_fts.rowid = p.rowid
            WHERE places_fts MATCH ?
            LIMIT 50
        """, (fts_query,)).fetchall()

        results = []
        for row in rows:
            d = {
                "name": row["name"],
                "category": row["category"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "importance": row["importance"],
            }
            if near_lat is not None and near_lon is not None:
                d["distance"] = _haversine(near_lat, near_lon, row["latitude"], row["longitude"])
            else:
                d["distance"] = 0
            results.append(d)

        results.sort(key=lambda r: (-r["importance"], r["distance"]))
        return results[:limit]

    def search(
        self,
        query: str,
        limit: int = 10,
        near_lat: float | None = None,
        near_lon: float | None = None,
    ) -> list[dict]:
        """Search with three-tier fallback: local FTS5 → Nominatim → street name retry."""
        if not query or len(query.strip()) < 2:
            return []

        # 1. Local FTS5 search
        results = self._fts_search(query, near_lat, near_lon, limit)
        if results:
            return results

        # 2. Nominatim online fallback
        results = _nominatim_search(query, near_lat, near_lon)
        if results:
            return results[:limit]

        # 3. Street name fallback — strip house number and retry
        stripped = query.strip()
        if stripped and stripped[0].isdigit():
            parts = stripped.split(None, 1)
            if len(parts) > 1:
                street_query = parts[1]
                results = self._fts_search(street_query, near_lat, near_lon, limit)
                if results:
                    return results

        return []

    def close(self) -> None:
        if self._conn:
            self._conn.close()
            self._conn = None
