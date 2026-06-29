"""Fake GPS data generator for development without hardware."""

from __future__ import annotations

import math
import queue
import random
import threading
import time
from datetime import datetime, timezone

SEATTLE_LAT = 47.6062
SEATTLE_LON = -122.3321


class GpsSimulator:
    """Generates synthetic NMEA sentences at 10Hz following a drive pattern."""

    def __init__(self, sentence_queue: queue.Queue[str], update_hz: float = 10.0):
        self.queue = sentence_queue
        self._interval = 1.0 / update_hz
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._connected = True

        # Simulated state
        self._lat = SEATTLE_LAT
        self._lon = SEATTLE_LON
        self._heading = 45.0  # NE
        self._speed_knots = 0.0
        self._target_speed_knots = 35.0  # ~40 mph cruising
        self._altitude = 56.0  # meters
        self._satellites = 12
        self._time_offset = 0.0

    @property
    def connected(self) -> bool:
        return self._connected

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="gps-simulator")
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self._update_state()
            now = datetime.now(timezone.utc)

            gga = self._make_gga(now)
            rmc = self._make_rmc(now)

            try:
                self.queue.put_nowait(gga)
                self.queue.put_nowait(rmc)
            except queue.Full:
                pass

            self._stop_event.wait(self._interval)

    def _update_state(self) -> None:
        """Simulate vehicle dynamics — gentle acceleration, turning, speed variation."""
        self._time_offset += self._interval

        # Vary target speed in a pattern (stop at red lights, cruise, accelerate)
        cycle = self._time_offset % 60  # 60-second drive cycle
        if cycle < 5:
            self._target_speed_knots = 0.0  # stopped
        elif cycle < 15:
            self._target_speed_knots = 20.0  # accelerating
        elif cycle < 40:
            self._target_speed_knots = 35.0 + random.uniform(-3, 3)  # cruising
        elif cycle < 50:
            self._target_speed_knots = 50.0 + random.uniform(-2, 2)  # faster
        else:
            self._target_speed_knots = 10.0  # decelerating

        # Smooth speed transitions
        speed_diff = self._target_speed_knots - self._speed_knots
        self._speed_knots += speed_diff * 0.05  # gentle acceleration
        self._speed_knots = max(0, self._speed_knots)

        # Gentle heading drift (simulates curves)
        self._heading += math.sin(self._time_offset * 0.1) * 0.5
        self._heading %= 360

        # Move position based on speed and heading
        speed_mps = self._speed_knots * 0.514444
        dlat = speed_mps * math.cos(math.radians(self._heading)) * self._interval / 111320
        dlon = speed_mps * math.sin(math.radians(self._heading)) * self._interval / (
            111320 * math.cos(math.radians(self._lat))
        )
        self._lat += dlat
        self._lon += dlon

        # Slight altitude variation
        self._altitude += random.uniform(-0.1, 0.1)

    def _make_gga(self, now: datetime) -> str:
        """Generate a GGA sentence."""
        t = now.strftime("%H%M%S.%f")[:9]  # HHMMss.ss
        lat_str, lat_dir = self._format_lat(self._lat)
        lon_str, lon_dir = self._format_lon(self._lon)

        fields = [
            "GPGGA", t, lat_str, lat_dir, lon_str, lon_dir,
            "1",  # fix quality: GPS
            f"{self._satellites:02d}",
            "0.9",  # HDOP
            f"{self._altitude:.1f}", "M",  # altitude
            "-17.0", "M",  # geoid separation
            "", "",  # DGPS fields
        ]
        body = ",".join(fields)
        checksum = self._checksum(body)
        return f"${body}*{checksum}"

    def _make_rmc(self, now: datetime) -> str:
        """Generate an RMC sentence."""
        t = now.strftime("%H%M%S.%f")[:9]
        d = now.strftime("%d%m%y")
        lat_str, lat_dir = self._format_lat(self._lat)
        lon_str, lon_dir = self._format_lon(self._lon)

        fields = [
            "GPRMC", t, "A",  # A=active
            lat_str, lat_dir, lon_str, lon_dir,
            f"{self._speed_knots:.1f}",
            f"{self._heading:.1f}",
            d,
            "", "",  # magnetic variation
            "A",  # mode indicator
        ]
        body = ",".join(fields)
        checksum = self._checksum(body)
        return f"${body}*{checksum}"

    @staticmethod
    def _format_lat(lat: float) -> tuple[str, str]:
        d = "N" if lat >= 0 else "S"
        lat = abs(lat)
        deg = int(lat)
        mins = (lat - deg) * 60
        return f"{deg:02d}{mins:07.4f}", d

    @staticmethod
    def _format_lon(lon: float) -> tuple[str, str]:
        d = "E" if lon >= 0 else "W"
        lon = abs(lon)
        deg = int(lon)
        mins = (lon - deg) * 60
        return f"{deg:03d}{mins:07.4f}", d

    @staticmethod
    def _checksum(sentence: str) -> str:
        cs = 0
        for c in sentence:
            cs ^= ord(c)
        return f"{cs:02X}"
