"""Static list of downloadable OSRM routing regions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Region:
    id: str
    name: str
    pbf_url: str
    estimated_size_mb: int
    group: str  # continent/country grouping
    openaddresses_url: str = ""  # optional OpenAddresses CSV ZIP URL


# Geofabrik download mirrors — US states + select international
# OpenAddresses URLs resolved dynamically via batch API

REGIONS: list[Region] = [
    # US West — openaddresses_url is the source name used to resolve via batch API
    Region("us-washington", "Washington", "https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf", 280, "United States", "us/wa/statewide"),
    Region("us-oregon", "Oregon", "https://download.geofabrik.de/north-america/us/oregon-latest.osm.pbf", 200, "United States", "us/or/statewide"),
    Region("us-california", "California", "https://download.geofabrik.de/north-america/us/california-latest.osm.pbf", 900, "United States", "us/ca/statewide"),
    Region("us-nevada", "Nevada", "https://download.geofabrik.de/north-america/us/nevada-latest.osm.pbf", 100, "United States", "us/nv/statewide"),
    Region("us-arizona", "Arizona", "https://download.geofabrik.de/north-america/us/arizona-latest.osm.pbf", 180, "United States", "us/az/statewide"),
    Region("us-colorado", "Colorado", "https://download.geofabrik.de/north-america/us/colorado-latest.osm.pbf", 240, "United States", "us/co/statewide"),
    Region("us-utah", "Utah", "https://download.geofabrik.de/north-america/us/utah-latest.osm.pbf", 120, "United States", "us/ut/statewide"),
    Region("us-idaho", "Idaho", "https://download.geofabrik.de/north-america/us/idaho-latest.osm.pbf", 100, "United States", "us/id/statewide"),
    Region("us-montana", "Montana", "https://download.geofabrik.de/north-america/us/montana-latest.osm.pbf", 90, "United States", "us/mt/statewide"),
    # US Central
    Region("us-texas", "Texas", "https://download.geofabrik.de/north-america/us/texas-latest.osm.pbf", 650, "United States", "us/tx/statewide"),
    Region("us-illinois", "Illinois", "https://download.geofabrik.de/north-america/us/illinois-latest.osm.pbf", 310, "United States", "us/il/statewide"),
    Region("us-michigan", "Michigan", "https://download.geofabrik.de/north-america/us/michigan-latest.osm.pbf", 260, "United States", "us/mi/statewide"),
    Region("us-ohio", "Ohio", "https://download.geofabrik.de/north-america/us/ohio-latest.osm.pbf", 280, "United States", "us/oh/statewide"),
    # US East
    Region("us-new-york", "New York", "https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf", 400, "United States", "us/ny/statewide"),
    Region("us-pennsylvania", "Pennsylvania", "https://download.geofabrik.de/north-america/us/pennsylvania-latest.osm.pbf", 360, "United States", "us/pa/statewide"),
    Region("us-florida", "Florida", "https://download.geofabrik.de/north-america/us/florida-latest.osm.pbf", 380, "United States", "us/fl/statewide"),
    Region("us-georgia", "Georgia", "https://download.geofabrik.de/north-america/us/georgia-latest.osm.pbf", 240, "United States", "us/ga/statewide"),
    Region("us-virginia", "Virginia", "https://download.geofabrik.de/north-america/us/virginia-latest.osm.pbf", 260, "United States", "us/va/statewide"),
    Region("us-north-carolina", "North Carolina", "https://download.geofabrik.de/north-america/us/north-carolina-latest.osm.pbf", 280, "United States", "us/nc/statewide"),
    Region("us-massachusetts", "Massachusetts", "https://download.geofabrik.de/north-america/us/massachusetts-latest.osm.pbf", 200, "United States", "us/ma/statewide"),
    # Canada
    Region("ca-british-columbia", "British Columbia", "https://download.geofabrik.de/north-america/canada/british-columbia-latest.osm.pbf", 250, "Canada"),
    Region("ca-ontario", "Ontario", "https://download.geofabrik.de/north-america/canada/ontario-latest.osm.pbf", 350, "Canada"),
    Region("ca-alberta", "Alberta", "https://download.geofabrik.de/north-america/canada/alberta-latest.osm.pbf", 150, "Canada"),
    # Europe
    Region("gb-england", "England", "https://download.geofabrik.de/europe/great-britain/england-latest.osm.pbf", 900, "Europe"),
    Region("de-germany", "Germany", "https://download.geofabrik.de/europe/germany-latest.osm.pbf", 3800, "Europe"),
    Region("fr-france", "France", "https://download.geofabrik.de/europe/france-latest.osm.pbf", 4200, "Europe"),
]


def get_region(region_id: str) -> Region | None:
    for r in REGIONS:
        if r.id == region_id:
            return r
    return None


def resolve_openaddresses_url(source_name: str) -> str | None:
    """Resolve an OpenAddresses source name to a download URL via the batch API.

    Args:
        source_name: e.g. "us/wa/statewide"

    Returns:
        Direct download URL for the GeoJSON.gz file, or None if not found.
    """
    import json
    import urllib.request
    import logging

    log = logging.getLogger(__name__)

    try:
        # Query batch API for the source
        api_url = "https://batch.openaddresses.io/api/data"
        req = urllib.request.Request(api_url, headers={"User-Agent": "SpeedDeck/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())

        # Find the matching address source
        for entry in data:
            if entry.get("source") == source_name and entry.get("layer") == "addresses":
                job_id = entry.get("job")
                if job_id:
                    url = f"https://v2.openaddresses.io/batch-prod/job/{job_id}/source.geojson.gz"
                    log.info("Resolved OpenAddresses URL for %s: %s (%.1f MB)",
                             source_name, url, entry.get("size", 0) / 1024 / 1024)
                    return url

        log.warning("No OpenAddresses data found for source: %s", source_name)
        return None

    except Exception as e:
        log.warning("Failed to resolve OpenAddresses URL for %s: %s", source_name, e)
        return None


def get_regions_grouped() -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for r in REGIONS:
        if r.group not in groups:
            groups[r.group] = []
        groups[r.group].append({
            "id": r.id,
            "name": r.name,
            "estimatedSizeMb": r.estimated_size_mb,
            "group": r.group,
        })
    return groups
