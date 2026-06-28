"""Unit conversions. All internal values are SI (m/s, meters)."""

MPS_TO_MPH = 2.23694
MPS_TO_KMH = 3.6
MPS_TO_KNOTS = 1.94384
METERS_TO_FEET = 3.28084
METERS_TO_NM = 0.000539957
METERS_TO_MI = 0.000621371
METERS_TO_KM = 0.001
KNOTS_TO_MPS = 0.514444


def speed_convert(mps: float, unit: str) -> float:
    """Convert m/s to the requested unit."""
    if unit == "mph":
        return mps * MPS_TO_MPH
    elif unit == "kmh":
        return mps * MPS_TO_KMH
    elif unit == "knots":
        return mps * MPS_TO_KNOTS
    return mps


def distance_convert(meters: float, unit: str) -> float:
    """Convert meters to the distance unit matching the speed unit."""
    if unit == "mph":
        return meters * METERS_TO_MI
    elif unit == "kmh":
        return meters * METERS_TO_KM
    elif unit == "knots":
        return meters * METERS_TO_NM
    return meters


def altitude_convert(meters: float, unit: str) -> float:
    """Convert meters to feet or keep as meters."""
    if unit == "ft":
        return meters * METERS_TO_FEET
    return meters
