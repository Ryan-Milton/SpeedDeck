"""Trip recording state machine."""

from __future__ import annotations

import logging
import time

from ..server.protocol import GPSFix
from .database import TripDatabase

log = logging.getLogger(__name__)


class TripRecorder:
    """Manages trip recording lifecycle: idle -> recording -> paused -> idle."""

    def __init__(self, db: TripDatabase, flush_interval: float = 1.0):
        self._db = db
        self._flush_interval = flush_interval

        self._trip_id: int | None = None
        self._buffer: list[GPSFix] = []
        self._last_flush: float = 0.0
        self._status: str = "idle"

    @property
    def status(self) -> str:
        return self._status

    @property
    def trip_id(self) -> int | None:
        return self._trip_id

    def start(self) -> int:
        """Start a new trip. Returns the trip ID."""
        self._trip_id = self._db.create_trip()
        self._buffer.clear()
        self._last_flush = time.time()
        self._status = "recording"
        log.info("Trip recording started (id=%d)", self._trip_id)
        return self._trip_id

    def stop(self, distance: float, max_speed: float, avg_speed: float) -> None:
        """Stop recording and finalize the trip."""
        if self._trip_id is None:
            return
        self._flush()
        self._db.end_trip(self._trip_id, distance, max_speed, avg_speed)
        log.info("Trip recording stopped (id=%d)", self._trip_id)
        self._trip_id = None
        self._status = "idle"

    def pause(self) -> None:
        if self._status == "recording":
            self._flush()
            self._status = "paused"
            log.info("Trip recording paused")

    def resume(self) -> None:
        if self._status == "paused":
            self._status = "recording"
            log.info("Trip recording resumed")

    def record(self, fix: GPSFix) -> None:
        """Buffer a trackpoint. Flushes to DB periodically."""
        if self._status != "recording":
            return

        self._buffer.append(fix)

        now = time.time()
        if now - self._last_flush >= self._flush_interval:
            self._flush()
            self._last_flush = now

    def _flush(self) -> None:
        if self._buffer and self._trip_id is not None:
            self._db.insert_trackpoints(self._trip_id, self._buffer)
            self._buffer.clear()
