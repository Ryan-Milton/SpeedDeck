from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
import glob
import json
import logging
import platform

log = logging.getLogger(__name__)


def detect_serial_port() -> str:
    """Auto-detect a USB GNSS serial port on macOS and Linux."""
    system = platform.system()

    if system == "Darwin":
        # macOS: Prolific PL2303, FTDI, CP2102, and generic USB serial
        patterns = [
            "/dev/tty.PL2303*",
            "/dev/tty.usbserial-*",
            "/dev/tty.usbmodem*",
            "/dev/tty.wchusbserial*",
            "/dev/tty.SLAB_USBtoUART*",
            "/dev/cu.PL2303*",
            "/dev/cu.usbserial-*",
            "/dev/cu.usbmodem*",
        ]
    else:
        # Linux
        patterns = [
            "/dev/ttyUSB*",
            "/dev/ttyACM*",
        ]

    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if matches:
            log.info("Auto-detected serial port: %s", matches[0])
            return matches[0]

    fallback = "/dev/ttyUSB0" if system != "Darwin" else "/dev/tty.usbserial-0"
    log.warning("No serial port detected, using fallback: %s", fallback)
    return fallback


@dataclass
class Config:
    # Serial
    serial_port: str = ""
    serial_baud: int = 115200

    # GPS
    use_simulator: bool = False
    speed_smoothing_alpha: float = 0.3
    min_speed_threshold: float = 0.56  # m/s (~2 km/h) — ignore drift below this

    # Server
    ws_host: str = "127.0.0.1"
    ws_port: int = 8765

    # Database
    db_path: str = "data/trips.db"
    trackpoint_flush_interval: float = 1.0  # seconds

    # Display defaults
    default_unit: str = "mph"  # mph | kmh | knots

    @classmethod
    def load(cls, config_path: Path | None = None) -> "Config":
        if config_path and config_path.exists():
            with open(config_path) as f:
                data = json.load(f)
            return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        return cls()

    def save(self, config_path: Path) -> None:
        config_path.parent.mkdir(parents=True, exist_ok=True)
        from dataclasses import asdict
        with open(config_path, "w") as f:
            json.dump(asdict(self), f, indent=2)
