from __future__ import annotations

import math

EARTH_RADIUS_M = 6_371_000


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two lat/lon points."""
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return EARTH_RADIUS_M * 2 * math.asin(math.sqrt(a))


def distance_3d(
    lat1: float, lon1: float, alt1: float | None,
    lat2: float, lon2: float, alt2: float | None,
) -> float:
    """Distance in meters accounting for altitude when available.

    Uses Pythagorean theorem: sqrt(horizontal^2 + altitude_diff^2).
    Falls back to 2D haversine when either altitude is None.
    """
    horiz = haversine_distance(lat1, lon1, lat2, lon2)
    if alt1 is not None and alt2 is not None:
        dalt = alt2 - alt1
        return math.sqrt(horiz ** 2 + dalt ** 2)
    return horiz


def initial_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Bearing in degrees (0-360) from point 1 to point 2."""
    lat1, lon1, lat2, lon2 = map(math.radians, (lat1, lon1, lat2, lon2))
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def cardinal_direction(heading: float) -> str:
    """Convert heading degrees to 16-point cardinal abbreviation."""
    directions = [
        "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
        "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
    ]
    idx = round(heading / 22.5) % 16
    return directions[idx]
