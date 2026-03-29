"""Parse NMEA sentences into GPSFix snapshots."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import pynmea2

from ..server.protocol import GPSFix
from ..utils.units import KNOTS_TO_MPS

log = logging.getLogger(__name__)


def _to_float(val, default=None):
    """Safely convert a value to float, returning default on failure."""
    if val is None or val == '':
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def _to_int(val, default=0):
    """Safely convert a value to int, returning default on failure."""
    if val is None or val == '':
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


class NmeaParser:
    """Accumulates GGA and RMC data into unified GPSFix snapshots."""

    def __init__(self):
        # Partial state from most recent sentences
        self._latitude: float = 0.0
        self._longitude: float = 0.0
        self._altitude: float | None = None
        self._satellites: int = 0
        self._fix_quality: int = 0
        self._hdop: float | None = None
        self._speed_mps: float = 0.0
        self._heading: float = 0.0
        self._timestamp: datetime = datetime.now(timezone.utc)
        self._has_rmc = False
        self._has_gga = False

    def parse(self, sentence: str) -> GPSFix | None:
        """Parse a single NMEA sentence. Returns a GPSFix when we have
        enough data from a GGA+RMC pair (or standalone RMC)."""
        try:
            msg = pynmea2.parse(sentence, check=True)
        except pynmea2.ParseError:
            return None
        except pynmea2.ChecksumError:
            log.debug("Checksum failed: %s", sentence[:20])
            return None

        if isinstance(msg, pynmea2.types.talker.GGA):
            self._handle_gga(msg)
        elif isinstance(msg, pynmea2.types.talker.RMC):
            self._handle_rmc(msg)
        elif isinstance(msg, pynmea2.types.talker.VTG):
            self._handle_vtg(msg)
        else:
            return None

        # Emit a fix after every RMC (it carries speed + position)
        if self._has_rmc:
            self._has_rmc = False
            return self._build_fix()

        return None

    def _handle_gga(self, msg: pynmea2.types.talker.GGA) -> None:
        self._has_gga = True
        if msg.latitude and msg.longitude:
            self._latitude = msg.latitude
            self._longitude = msg.longitude
        self._altitude = _to_float(msg.altitude, self._altitude)
        if msg.num_sats:
            try:
                self._satellites = int(msg.num_sats)
            except (ValueError, TypeError):
                pass
        self._fix_quality = _to_int(msg.gps_qual, self._fix_quality)
        self._hdop = _to_float(msg.horizontal_dil, self._hdop)
        if msg.timestamp:
            self._update_time(msg.timestamp)

    def _handle_rmc(self, msg: pynmea2.types.talker.RMC) -> None:
        self._has_rmc = True
        if msg.latitude and msg.longitude:
            self._latitude = msg.latitude
            self._longitude = msg.longitude
        spd = _to_float(msg.spd_over_grnd)
        if spd is not None:
            self._speed_mps = spd * KNOTS_TO_MPS
        course = _to_float(msg.true_course)
        if course is not None:
            self._heading = course
        if msg.timestamp:
            self._update_time(msg.timestamp)

    def _handle_vtg(self, msg: pynmea2.types.talker.VTG) -> None:
        # VTG can provide a more accurate speed; use it if available
        try:
            spd_kmh = _to_float(getattr(msg, "spd_over_grnd_kmph", None))
            if spd_kmh is not None:
                self._speed_mps = spd_kmh / 3.6
        except (ValueError, TypeError):
            pass

    def _update_time(self, t) -> None:
        if isinstance(t, datetime):
            self._timestamp = t.replace(tzinfo=timezone.utc)
        else:
            # pynmea2 sometimes returns a time object without date
            now = datetime.now(timezone.utc)
            try:
                self._timestamp = datetime.combine(now.date(), t, tzinfo=timezone.utc)
            except Exception:
                self._timestamp = now

    def _build_fix(self) -> GPSFix:
        return GPSFix(
            timestamp=self._timestamp.isoformat(),
            latitude=self._latitude,
            longitude=self._longitude,
            altitude=self._altitude,
            speed=self._speed_mps,
            heading=self._heading,
            satellites=self._satellites,
            fix_quality=self._fix_quality,
            hdop=self._hdop,
        )
