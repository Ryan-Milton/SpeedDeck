"""Processes raw GPS fixes into smoothed, enriched state snapshots."""

from __future__ import annotations

import time

from ..server.protocol import GPSFix, GPSState
from ..utils.geo import haversine_distance


class DataProcessor:
    """Takes raw GPSFix data and produces GPSState with smoothing and stats."""

    def __init__(self, smoothing_alpha: float = 0.3, min_speed_threshold: float = 0.56):
        self._alpha = smoothing_alpha
        self._min_speed = min_speed_threshold

        # Session stats
        self._smoothed_speed: float = 0.0
        self._max_speed: float = 0.0
        self._speed_sum: float = 0.0
        self._speed_count: int = 0

        # Previous fix for distance calculation
        self._prev_lat: float | None = None
        self._prev_lon: float | None = None

        # Trip state (managed externally by recorder, read here)
        self.trip_status: str = "idle"
        self.trip_distance: float = 0.0
        self.trip_duration: float = 0.0
        self.trip_max_speed: float = 0.0
        self.trip_avg_speed: float = 0.0
        self.trip_start_time: float | None = None
        self._trip_speed_sum: float = 0.0
        self._trip_speed_count: int = 0

    def process(self, fix: GPSFix) -> GPSState:
        """Process a raw fix into a full state snapshot."""
        # EMA speed smoothing
        if self._speed_count == 0:
            self._smoothed_speed = fix.speed
        else:
            self._smoothed_speed = (
                self._alpha * fix.speed + (1 - self._alpha) * self._smoothed_speed
            )

        # Session max
        if fix.speed > self._max_speed:
            self._max_speed = fix.speed

        # Session average (only when moving)
        if fix.speed >= self._min_speed:
            self._speed_sum += fix.speed
            self._speed_count += 1
        elif self._speed_count == 0:
            self._speed_count = 1  # avoid div by zero

        avg_speed = self._speed_sum / max(self._speed_count, 1)

        # Trip accumulation
        if self.trip_status == "recording":
            self._accumulate_trip(fix)

        # Update previous position
        self._prev_lat = fix.latitude
        self._prev_lon = fix.longitude

        return GPSState(
            fix=fix,
            smoothed_speed=self._smoothed_speed,
            max_speed=self._max_speed,
            avg_speed=avg_speed,
            trip_status=self.trip_status,
            trip_distance=self.trip_distance,
            trip_duration=self.trip_duration,
            trip_max_speed=self.trip_max_speed,
            trip_avg_speed=self.trip_avg_speed,
        )

    def _accumulate_trip(self, fix: GPSFix) -> None:
        """Accumulate distance and stats for the active trip."""
        # Distance (only when moving above threshold)
        if (
            self._prev_lat is not None
            and self._prev_lon is not None
            and fix.speed >= self._min_speed
        ):
            d = haversine_distance(self._prev_lat, self._prev_lon, fix.latitude, fix.longitude)
            self.trip_distance += d

        # Trip max speed
        if fix.speed > self.trip_max_speed:
            self.trip_max_speed = fix.speed

        # Trip average (moving only)
        if fix.speed >= self._min_speed:
            self._trip_speed_sum += fix.speed
            self._trip_speed_count += 1
            self.trip_avg_speed = self._trip_speed_sum / self._trip_speed_count

        # Trip duration
        if self.trip_start_time is not None:
            self.trip_duration = time.time() - self.trip_start_time

    def start_trip(self) -> None:
        self.trip_status = "recording"
        self.trip_distance = 0.0
        self.trip_duration = 0.0
        self.trip_max_speed = 0.0
        self.trip_avg_speed = 0.0
        self.trip_start_time = time.time()
        self._trip_speed_sum = 0.0
        self._trip_speed_count = 0

    def stop_trip(self) -> None:
        self.trip_status = "idle"
        self.trip_start_time = None

    def pause_trip(self) -> None:
        self.trip_status = "paused"

    def resume_trip(self) -> None:
        self.trip_status = "recording"

    def reset_session_max(self) -> None:
        self._max_speed = 0.0

    def reset_session_avg(self) -> None:
        self._speed_sum = 0.0
        self._speed_count = 0
