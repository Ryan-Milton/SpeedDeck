"""Route calculation via local OSRM HTTP API."""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)


def _bearing_range(speed_mps: float | None) -> int:
    """Compute allowed bearing deviation based on speed.

    Narrower range at higher speed (less turning ability).
    """
    if speed_mps is None or speed_mps < 2.0:
        return 180  # unconstrained below ~4.5 mph
    if speed_mps > 25.0:
        return 30  # highway: tight constraint
    # Linear interpolation: 2 m/s -> 90°, 25 m/s -> 30°
    return round(90 - (speed_mps - 2.0) * (60.0 / 23.0))


async def calculate_route(
    from_lon: float, from_lat: float,
    to_lon: float, to_lat: float,
    heading: float | None = None,
    speed: float | None = None,
    port: int = 5001,
) -> dict[str, Any]:
    """Calculate a route via local OSRM and return parsed RouteData."""
    import aiohttp

    # Build bearing parameter if heading and speed are available
    bearing_param = ""
    if heading is not None and speed is not None and speed >= 2.0:
        br = _bearing_range(speed)
        bearing_int = round(heading) % 360
        # First waypoint constrained; second (destination) unconstrained
        bearing_param = f"&bearings={bearing_int},{br};"

    base_params = "?steps=true&geometries=geojson&overview=full"
    coords = f"{from_lon},{from_lat};{to_lon},{to_lat}"
    base_prefix = f"http://127.0.0.1:{port}/route/v1/driving/{coords}"

    log.info("Calculating route: (%f,%f) -> (%f,%f)%s",
             from_lat, from_lon, to_lat, to_lon,
             f" bearing={round(heading) % 360}±{_bearing_range(speed)}" if bearing_param else "")

    async with aiohttp.ClientSession() as session:
        # Try with maxspeed annotations first, fall back to without if OSRM doesn't support it
        for annotations in ("duration,distance,maxspeed", "duration,distance"):
            base_url = f"{base_prefix}{base_params}&annotations={annotations}"
            url = base_url + bearing_param

            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 400 and "maxspeed" in annotations:
                    log.warning("OSRM does not support maxspeed annotations; retrying without")
                    continue
                if resp.status != 200:
                    raise RuntimeError(f"OSRM request failed: HTTP {resp.status}")
                data = await resp.json()
            break

        # Fallback: retry without bearing constraint if OSRM found no route
        if (data.get("code") != "Ok" or not data.get("routes")) and bearing_param:
            log.warning("No route with bearing constraint; retrying unconstrained")
            async with session.get(base_url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    raise RuntimeError(f"OSRM fallback request failed: HTTP {resp.status}")
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

    # Extract per-segment maxspeed annotations (one per coordinate pair)
    # Each entry is either {"speed": N, "unit": "km/h"|"mph"}, {"unknown": true}, or {"none": true}
    # Normalize all values to km/h for the frontend
    maxspeed: list[float | None] = []
    for leg in osrm_route.get("legs", []):
        for entry in leg.get("annotation", {}).get("maxspeed", []):
            if "speed" in entry:
                speed_val = entry["speed"]
                if entry.get("unit") == "mph":
                    speed_val = speed_val * 1.60934
                maxspeed.append(round(speed_val, 1))
            else:
                maxspeed.append(None)

    return {
        "type": "routeData",
        "route": {
            "geometry": osrm_route.get("geometry", {"type": "LineString", "coordinates": []}),
            "distance": osrm_route.get("distance", 0),
            "duration": osrm_route.get("duration", 0),
            "steps": steps,
            "maxspeeds": maxspeed,
        },
    }
