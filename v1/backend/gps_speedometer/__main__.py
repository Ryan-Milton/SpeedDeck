"""GPS Speedometer backend entry point.

Usage:
    python -m gps_speedometer [--data-dir PATH] [--simulator] [--port PORT]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import queue
import signal
import sys
from pathlib import Path

from .config import Config
from .gps.serial_reader import SerialReader
from .gps.simulator import GpsSimulator
from .gps.nmea_parser import NmeaParser
from .gps.data_processor import DataProcessor
from .trip.database import TripDatabase
from .trip.recorder import TripRecorder
from .trip.gpx_export import export_trip_gpx
from .server.ws_server import WebSocketServer
from .server.protocol import TripListMessage, GpxDataMessage, TrackpointsDataMessage
from .navigation.osrm_manager import OsrmManager
from .navigation.geocoder import Geocoder
from .navigation.regions import get_region, get_regions_grouped
from .navigation import router as nav_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("gps_speedometer")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GPS Speedometer Backend")
    p.add_argument("--data-dir", type=Path, default=Path("data"))
    p.add_argument("--config", type=Path, default=None)
    p.add_argument("--simulator", action="store_true", help="Use fake GPS data")
    p.add_argument("--port", type=int, default=None)
    p.add_argument("--serial-port", type=str, default=None)
    return p.parse_args()


async def main() -> None:
    args = parse_args()

    # Load config
    config = Config.load(args.config)
    if args.simulator:
        config.use_simulator = True
    if args.port:
        config.ws_port = args.port
    if args.serial_port:
        config.serial_port = args.serial_port

    # Auto-detect serial port if not specified and not using simulator
    from .config import detect_serial_port
    if not config.serial_port and not config.use_simulator:
        config.serial_port = detect_serial_port()

    # Resolve data dir
    data_dir = args.data_dir.resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = str(data_dir / "trips.db")

    # Initialize components
    sentence_queue: queue.Queue[str] = queue.Queue(maxsize=200)
    parser = NmeaParser()
    processor = DataProcessor(
        smoothing_alpha=config.speed_smoothing_alpha,
        min_speed_threshold=config.min_speed_threshold,
    )
    db = TripDatabase(db_path)
    recorder = TripRecorder(db, flush_interval=config.trackpoint_flush_interval)
    ws_server = WebSocketServer(config.ws_host, config.ws_port)

    # Navigation components
    osrm = OsrmManager(data_dir)
    nav = {"geocoder": None}  # mutable container to avoid nonlocal issues

    # Start GPS source
    if config.use_simulator:
        log.info("Starting in SIMULATOR mode")
        gps_source = GpsSimulator(sentence_queue)
    else:
        log.info("Connecting to GPS on %s @ %d baud", config.serial_port, config.serial_baud)
        gps_source = SerialReader(
            config.serial_port, config.serial_baud, sentence_queue,
            detect_port_fn=detect_serial_port,
        )

    # Command handler
    async def handle_command(cmd: dict, requesting_ws=None) -> str | None:
        action = cmd.get("action", "")

        if action == "trip_start":
            recorder.start()
            processor.start_trip()
            return None

        elif action == "trip_stop":
            recorder.stop(
                processor.trip_distance,
                processor.trip_max_speed,
                processor.trip_avg_speed,
            )
            processor.stop_trip()
            return None

        elif action == "trip_pause":
            recorder.pause()
            processor.pause_trip()
            return None

        elif action == "trip_resume":
            recorder.resume()
            processor.resume_trip()
            return None

        elif action == "trip_list":
            trips = db.get_trips()
            msg = TripListMessage(trips=trips)
            return msg.to_json()

        elif action == "trip_export":
            trip_id = cmd.get("tripId", 0)
            try:
                gpx_xml = export_trip_gpx(db, trip_id)
                msg = GpxDataMessage(trip_id=trip_id, gpx_xml=gpx_xml)
                return msg.to_json()
            except ValueError as e:
                return None

        elif action == "trip_trackpoints":
            trip_id = cmd.get("tripId", 0)
            trackpoints = db.get_trackpoints(trip_id)
            msg = TrackpointsDataMessage(trip_id=trip_id, trackpoints=trackpoints)
            return msg.to_json()

        elif action == "trip_delete":
            trip_id = cmd.get("tripId", 0)
            db.delete_trip(trip_id)
            return None

        elif action == "trip_rename":
            trip_id = cmd.get("tripId", 0)
            name = cmd.get("name", "")
            db.rename_trip(trip_id, name)
            return None

        elif action == "reset_max_speed":
            processor.reset_session_max()
            return None

        elif action == "reset_avg_speed":
            processor.reset_session_avg()
            return None

        elif action == "get_status":
            return ws_server.last_state_json

        # --- Navigation commands ---
        elif action == "nav_get_status":
            return json.dumps(osrm.get_status())

        elif action == "nav_get_regions":
            return json.dumps({"type": "navRegions", "regions": get_regions_grouped()})

        elif action == "nav_download_region":
            region_id = cmd.get("regionId", "")
            log.info("Received nav_download_region for: %s", region_id)
            region = get_region(region_id)
            if not region:
                return json.dumps({"type": "navError", "error": f"Unknown region: {region_id}"})

            osrm.start_download(region_id, region.pbf_url, region.openaddresses_url)  # openaddresses_url is the source name
            return json.dumps({"type": "navAck", "action": "download_started"})

        elif action == "nav_process_region":
            region_id = cmd.get("regionId", "")
            log.info("Received nav_process_region for: %s", region_id)

            async def _do_process():
                try:
                    await osrm.process_region(region_id)
                    started = await osrm.start_router(region_id)
                    if started:
                        places_db = str(data_dir / "osrm" / region_id / "places.db")
                        nav["geocoder"] = Geocoder(places_db)
                    log.info("Processing complete for %s", region_id)
                except Exception as e:
                    log.error("Processing failed: %s", e, exc_info=True)
                    osrm.last_error = str(e)

            asyncio.create_task(_do_process())
            return json.dumps({"type": "navAck", "action": "process_started"})

        elif action == "nav_get_progress":
            return json.dumps({
                "type": "navProgress",
                "download": osrm.download_progress,
                "process": osrm.process_progress,
                "error": osrm.last_error,
            })

        elif action == "nav_start_router":
            started = await osrm.start_router()
            return json.dumps(osrm.get_status())

        elif action == "nav_stop_router":
            await osrm.stop_router()
            return json.dumps(osrm.get_status())

        elif action == "nav_delete_region":
            region_id = cmd.get("regionId")
            await osrm.delete_region(region_id)
            nav["geocoder"] = None
            return json.dumps(osrm.get_status())

        elif action == "geocode_search":
            query = cmd.get("query", "")
            near_lat = cmd.get("nearLat")
            near_lon = cmd.get("nearLon")
            if not nav["geocoder"]:
                return json.dumps({"type": "geocodeResults", "results": []})
            # Run in executor to avoid blocking the event loop (Nominatim fallback is synchronous HTTP)
            loop = asyncio.get_running_loop()
            results = await loop.run_in_executor(
                None, nav["geocoder"].search, query, 10, near_lat, near_lon
            )
            return json.dumps({"type": "geocodeResults", "results": results})

        elif action == "calculate_route":
            from_lon = cmd.get("fromLon", 0)
            from_lat = cmd.get("fromLat", 0)
            to_lon = cmd.get("toLon", 0)
            to_lat = cmd.get("toLat", 0)
            heading = cmd.get("heading")
            speed = cmd.get("speed")
            try:
                result = await nav_router.calculate_route(
                    from_lon, from_lat, to_lon, to_lat,
                    heading=heading, speed=speed,
                )
                return json.dumps(result)
            except Exception as e:
                log.error("Route calculation failed: %s", e)
                return json.dumps({"type": "navError", "error": str(e)})

        return None

    ws_server.set_command_handler(handle_command)

    # Start everything
    gps_source.start()
    await ws_server.start()

    # Auto-start OSRM router if routing data is available
    try:
        nav_status = osrm.get_status()
        if nav_status.get("installedRegion"):
            region_id = nav_status["installedRegion"]["regionId"]
            started = await osrm.start_router(region_id)
            if started:
                places_db = str(data_dir / "osrm" / region_id / "places.db")
                if Path(places_db).exists():
                    nav["geocoder"] = Geocoder(places_db)
                log.info("Navigation routing ready (region: %s)", region_id)
    except Exception as e:
        log.warning("Could not auto-start OSRM: %s", e)

    # Shutdown handler
    stop_event = asyncio.Event()

    def on_signal():
        log.info("Shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, on_signal)

    log.info("GPS Speedometer backend running (ws://%s:%d)", config.ws_host, config.ws_port)

    # Main processing loop
    try:
        while not stop_event.is_set():
            # Drain NMEA sentences from the queue
            processed = False
            try:
                while True:
                    sentence = sentence_queue.get_nowait()
                    fix = parser.parse(sentence)
                    if fix:
                        # Record if trip is active
                        recorder.record(fix)
                        # Process and broadcast
                        state = processor.process(fix)
                        ws_server.push_state(state)
                        processed = True
            except queue.Empty:
                pass

            if not processed:
                # No data available — yield generously so background tasks
                # (downloads, OSRM processing, etc.) get proper event loop time
                await asyncio.sleep(0.1)
            else:
                # Yield to let broadcast coroutine run
                await asyncio.sleep(0)

    except asyncio.CancelledError:
        pass
    finally:
        log.info("Shutting down...")
        await osrm.stop_router()
        if nav["geocoder"]:
            nav["geocoder"].close()
        gps_source.stop()
        await ws_server.stop()
        db.close()
        log.info("Goodbye")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
