"""WebSocket message protocol definitions."""

from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any
import json


@dataclass
class GPSFix:
    """Single parsed GPS measurement from a GGA+RMC sentence pair."""
    timestamp: str  # ISO 8601 UTC
    latitude: float
    longitude: float
    altitude: float | None
    speed: float  # m/s
    heading: float  # degrees true
    satellites: int
    fix_quality: int  # 0=none, 1=GPS, 2=DGPS
    hdop: float | None


@dataclass
class GPSState:
    """Full state snapshot broadcast to clients."""
    type: str = "gpsState"
    fix: GPSFix | None = None
    smoothed_speed: float = 0.0
    max_speed: float = 0.0
    avg_speed: float = 0.0
    trip_status: str = "idle"  # idle | recording | paused
    trip_distance: float = 0.0  # meters
    trip_duration: float = 0.0  # seconds
    trip_max_speed: float = 0.0
    trip_avg_speed: float = 0.0

    def to_json(self) -> str:
        d = asdict(self)
        # Convert snake_case to camelCase for the frontend
        return json.dumps(_to_camel(d))


@dataclass
class StatusMessage:
    """Backend status broadcast."""
    type: str = "status"
    gps_connected: bool = False
    serial_port: str = ""
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(_to_camel(asdict(self)))


@dataclass
class TripInfo:
    id: int
    name: str | None
    started_at: str
    ended_at: str | None
    distance_m: float
    max_speed: float
    avg_speed: float


@dataclass
class TripListMessage:
    type: str = "tripList"
    trips: list[dict] = None

    def __post_init__(self):
        if self.trips is None:
            self.trips = []

    def to_json(self) -> str:
        return json.dumps(_to_camel(asdict(self)))


@dataclass
class GpxDataMessage:
    type: str = "gpxData"
    trip_id: int = 0
    gpx_xml: str = ""

    def to_json(self) -> str:
        return json.dumps(_to_camel(asdict(self)))


@dataclass
class TrackpointsDataMessage:
    type: str = "trackpointsData"
    trip_id: int = 0
    trackpoints: list[dict] = None

    def __post_init__(self):
        if self.trackpoints is None:
            self.trackpoints = []

    def to_json(self) -> str:
        return json.dumps(_to_camel(asdict(self)))


def parse_command(raw: str) -> dict[str, Any]:
    """Parse an incoming client command message."""
    try:
        msg = json.loads(raw)
        if msg.get("type") == "command":
            return msg
    except (json.JSONDecodeError, AttributeError):
        pass
    return {"type": "unknown"}


def _to_camel(d: Any) -> Any:
    """Recursively convert dict keys from snake_case to camelCase."""
    if isinstance(d, dict):
        return {_snake_to_camel(k): _to_camel(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_to_camel(i) for i in d]
    return d


def _snake_to_camel(s: str) -> str:
    parts = s.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])
