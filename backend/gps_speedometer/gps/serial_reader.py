"""Threaded serial reader for NMEA sentences from USB GNSS receiver."""

from __future__ import annotations

import logging
import queue
import threading
import time

import serial

log = logging.getLogger(__name__)


class SerialReader:
    """Reads raw NMEA lines from a serial port in a background thread."""

    def __init__(self, port: str, baud: int, sentence_queue: queue.Queue[str],
                 update_hz: int = 10):
        self.port = port
        self.baud = baud
        self.queue = sentence_queue
        self._update_hz = update_hz
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="serial-reader")
        self._thread.start()
        log.info("Serial reader started on %s @ %d baud", self.port, self.baud)

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5.0)
            self._thread = None
        self._connected = False
        log.info("Serial reader stopped")

    def _run(self) -> None:
        backoff = 1.0
        while not self._stop_event.is_set():
            try:
                with serial.Serial(self.port, self.baud, timeout=1.0) as ser:
                    log.info("Connected to %s", self.port)
                    self._connected = True
                    backoff = 1.0  # reset on successful connect

                    self._configure_update_rate(ser)

                    while not self._stop_event.is_set():
                        raw = ser.readline()
                        if not raw:
                            continue

                        try:
                            line = raw.decode("ascii", errors="ignore").strip()
                        except Exception:
                            continue

                        if line.startswith("$"):
                            try:
                                self.queue.put_nowait(line)
                            except queue.Full:
                                # Drop oldest to prevent unbounded growth
                                try:
                                    self.queue.get_nowait()
                                except queue.Empty:
                                    pass
                                self.queue.put_nowait(line)

            except (serial.SerialException, OSError) as e:
                self._connected = False
                if not self._stop_event.is_set():
                    log.warning("Serial error on %s: %s — retrying in %.1fs", self.port, e, backoff)
                    self._stop_event.wait(backoff)
                    backoff = min(backoff * 2, 10.0)

            except Exception as e:
                self._connected = False
                log.exception("Unexpected serial reader error: %s", e)
                self._stop_event.wait(backoff)
                backoff = min(backoff * 2, 10.0)

    def _configure_update_rate(self, ser: serial.Serial) -> None:
        """Send PAIR command to set the GPS update rate (Airoha AG3335 chipset)."""
        interval_ms = max(100, 1000 // self._update_hz)  # 10Hz = 100ms
        # PAIR050: Set position fix interval in milliseconds
        cmd = f"PAIR050,{interval_ms}"
        checksum = 0
        for c in cmd:
            checksum ^= ord(c)
        sentence = f"${cmd}*{checksum:02X}\r\n"
        try:
            ser.write(sentence.encode("ascii"))
            log.info("Configured GPS update rate: %dHz (%dms)", self._update_hz, interval_ms)
        except Exception as e:
            log.warning("Failed to set update rate: %s", e)
