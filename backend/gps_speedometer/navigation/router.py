"""Route calculation via local OSRM HTTP API."""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


async def calculate_route(
    from_lon: float, from_lat: float,
    to_lon: float, to_lat: float,
    port: int = 5001,
) -> dict[str, Any]:
    """Calculate a route via local OSRM and return parsed RouteData."""
    import aiohttp

    url = (
        f"http://127.0.0.1:{port}/route/v1/driving/"
        f"{from_lon},{from_lat};{to_lon},{to_lat}"
        f"?steps=true&geometries=geojson&overview=full&annotations=duration,distance"
    )

    log.info("Calculating route: (%f,%f) -> (%f,%f)", from_lat, from_lon, to_lat, to_lon)

    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                raise RuntimeError(f"OSRM request failed: HTTP {resp.status}")
            data = await resp.json()

    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM returned no route: {data.get('code', 'unknown')}")

    osrm_route = data["routes"][0]

    # Parse steps
    steps = []
    for leg in osrm_route.get("legs", []):
        for step in leg.get("steps", []):
            maneuver = step.get("maneuver", {})
            steps.append({
                "maneuver": {
                    "type": maneuver.get("type", ""),
                    "modifier": maneuver.get("modifier"),
                    "location": maneuver.get("location", [0, 0]),
                    "bearingBefore": maneuver.get("bearing_before", 0),
                    "bearingAfter": maneuver.get("bearing_after", 0),
                },
                "name": step.get("name", ""),
                "distance": step.get("distance", 0),
                "duration": step.get("duration", 0),
                "geometry": step.get("geometry", {"type": "LineString", "coordinates": []}),
            })

    return {
        "type": "routeData",
        "route": {
            "geometry": osrm_route.get("geometry", {"type": "LineString", "coordinates": []}),
            "distance": osrm_route.get("distance", 0),
            "duration": osrm_route.get("duration", 0),
            "steps": steps,
        },
    }
