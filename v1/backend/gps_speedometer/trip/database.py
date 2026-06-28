"""SQLite database for trip storage."""

from __future__ import annotations

import sqlite3
import logging
from pathlib import Path
from datetime import datetime, timezone

from ..server.protocol import GPSFix

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS trips (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT,
    distance_m  REAL DEFAULT 0,
    max_speed   REAL DEFAULT 0,
    avg_speed   REAL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trackpoints (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id     INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    timestamp   TEXT NOT NULL,
    latitude    REAL NOT NULL,
    longitude   REAL NOT NULL,
    altitude    REAL,
    speed       REAL,
    heading     REAL,
    satellites  INTEGER,
    fix_quality INTEGER,
    hdop        REAL
);

CREATE INDEX IF NOT EXISTS idx_trackpoints_trip
    ON trackpoints(trip_id, timestamp);
"""


class TripDatabase:
    def __init__(self, db_path: str):
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        log.info("Trip database initialized at %s", self._path)

    def create_trip(self, name: str | None = None) -> int:
        now = datetime.now(timezone.utc).isoformat()
        cur = self._conn.execute(
            "INSERT INTO trips (name, started_at) VALUES (?, ?)",
            (name, now),
        )
        self._conn.commit()
        trip_id = cur.lastrowid
        log.info("Created trip %d", trip_id)
        return trip_id

    def end_trip(
        self, trip_id: int, distance_m: float, max_speed: float, avg_speed: float
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._conn.execute(
            "UPDATE trips SET ended_at=?, distance_m=?, max_speed=?, avg_speed=? WHERE id=?",
            (now, distance_m, max_speed, avg_speed, trip_id),
        )
        self._conn.commit()
        log.info("Ended trip %d (%.0fm)", trip_id, distance_m)

    def insert_trackpoints(self, trip_id: int, fixes: list[GPSFix]) -> None:
        if not fixes:
            return
        rows = [
            (
                trip_id,
                f.timestamp,
                f.latitude,
                f.longitude,
                f.altitude,
                f.speed,
                f.heading,
                f.satellites,
                f.fix_quality,
                f.hdop,
            )
            for f in fixes
        ]
        self._conn.executemany(
            """INSERT INTO trackpoints
               (trip_id, timestamp, latitude, longitude, altitude, speed, heading,
                satellites, fix_quality, hdop)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            rows,
        )
        self._conn.commit()

    def get_trips(self) -> list[dict]:
        cur = self._conn.execute(
            "SELECT id, name, started_at, ended_at, distance_m, max_speed, avg_speed "
            "FROM trips ORDER BY started_at DESC"
        )
        return [
            {
                "id": r[0],
                "name": r[1],
                "started_at": r[2],
                "ended_at": r[3],
                "distance_m": r[4],
                "max_speed": r[5],
                "avg_speed": r[6],
            }
            for r in cur.fetchall()
        ]

    def get_trackpoints(self, trip_id: int) -> list[dict]:
        cur = self._conn.execute(
            """SELECT timestamp, latitude, longitude, altitude, speed, heading,
                      satellites, fix_quality, hdop
               FROM trackpoints WHERE trip_id=? ORDER BY timestamp""",
            (trip_id,),
        )
        return [
            {
                "timestamp": r[0],
                "latitude": r[1],
                "longitude": r[2],
                "altitude": r[3],
                "speed": r[4],
                "heading": r[5],
                "satellites": r[6],
                "fix_quality": r[7],
                "hdop": r[8],
            }
            for r in cur.fetchall()
        ]

    def delete_trip(self, trip_id: int) -> None:
        self._conn.execute("DELETE FROM trips WHERE id=?", (trip_id,))
        self._conn.commit()

    def rename_trip(self, trip_id: int, name: str) -> None:
        self._conn.execute("UPDATE trips SET name=? WHERE id=?", (name, trip_id))
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()
