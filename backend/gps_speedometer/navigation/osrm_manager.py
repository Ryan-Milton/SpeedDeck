"""Manages OSRM download, processing, and routing server lifecycle."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import threading
import urllib.request
from pathlib import Path

log = logging.getLogger(__name__)


class OsrmManager:
    """Download, process, and run OSRM for offline routing."""

    def __init__(self, data_dir: str | Path, osrm_bin_dir: str | None = None):
        self._data_dir = Path(data_dir) / "osrm"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._osrm_bin_dir = osrm_bin_dir
        self._router_process: asyncio.subprocess.Process | None = None
        self._router_port = 5001
        self._active_region: str | None = None
        self._download_task: asyncio.Task | None = None
        self._process_task: asyncio.Task | None = None

        # Pollable progress state
        self.download_progress: dict = {"step": "idle", "percent": 0, "downloadedMb": 0, "totalMb": 0}
        self.process_progress: dict = {"step": "idle", "percent": 0, "stepNumber": 0, "totalSteps": 0}
        self.last_error: str | None = None

    def _find_car_profile(self) -> str:
        """Find the OSRM car.lua profile file."""
        import glob as _glob
        # Check custom dir first
        if self._osrm_bin_dir:
            candidates = _glob.glob(os.path.join(self._osrm_bin_dir, "**", "car.lua"), recursive=True)
            if candidates:
                return candidates[0]
        # Homebrew (macOS)
        for pattern in [
            "/opt/homebrew/Cellar/osrm-backend/*/share/osrm/profiles/car.lua",
            "/usr/local/Cellar/osrm-backend/*/share/osrm/profiles/car.lua",
            "/opt/homebrew/share/osrm/profiles/car.lua",
            "/usr/local/share/osrm/profiles/car.lua",
            "/usr/share/osrm/profiles/car.lua",
        ]:
            matches = _glob.glob(pattern)
            if matches:
                return matches[0]
        # Fallback — hope it's on PATH
        return "car.lua"

    def _resolve_binary(self, name: str) -> str:
        """Find an OSRM binary, checking custom dir first then PATH."""
        if self._osrm_bin_dir:
            path = Path(self._osrm_bin_dir) / name
            if path.exists():
                return str(path)
        return name  # rely on PATH

    def _region_dir(self, region_id: str) -> Path:
        return self._data_dir / region_id

    def _pbf_path(self, region_id: str) -> Path:
        return self._region_dir(region_id) / "region.osm.pbf"

    def _osrm_path(self, region_id: str) -> Path:
        return self._region_dir(region_id) / "region.osrm"

    def _places_db_path(self, region_id: str) -> Path:
        return self._region_dir(region_id) / "places.db"

    def _meta_path(self, region_id: str) -> Path:
        return self._region_dir(region_id) / "meta.json"

    def get_status(self) -> dict:
        """Return current OSRM status."""
        installed_region = None
        installed_size_mb = 0
        try:
            for d in self._data_dir.iterdir():
                if not d.is_dir():
                    continue
                region_id = d.name
                meta_path = d / "meta.json"
                osrm_path = d / "region.osrm"

                # Check meta.json first, fall back to checking for .osrm file
                if meta_path.exists():
                    try:
                        meta = json.loads(meta_path.read_text())
                        if meta.get("status") == "ready":
                            installed_region = meta
                    except (json.JSONDecodeError, OSError):
                        pass
                elif osrm_path.exists():
                    # OSRM files exist but no meta — create it
                    meta = {"regionId": region_id, "regionName": region_id, "status": "ready"}
                    try:
                        meta_path.write_text(json.dumps(meta))
                    except OSError:
                        pass
                    installed_region = meta

                if installed_region:
                    total = sum(f.stat().st_size for f in d.rglob("*") if f.is_file())
                    installed_size_mb = round(total / 1024 / 1024)
                    break
        except (OSError, StopIteration):
            pass

        return {
            "type": "navStatus",
            "routerRunning": self._router_process is not None and self._router_process.returncode is None,
            "installedRegion": installed_region,
            "installedSizeMb": installed_size_mb,
            "routerPort": self._router_port,
        }

    def start_download(self, region_id: str, pbf_url: str, openaddresses_source: str = "") -> None:
        """Start downloading an OSM PBF extract (and optional OpenAddresses data) in a background thread.
        Progress is stored in self.download_progress for polling."""
        self.last_error = None
        self.download_progress = {"step": "download", "percent": 0, "downloadedMb": 0, "totalMb": 0}

        thread = threading.Thread(
            target=self._download_thread,
            args=(region_id, pbf_url, openaddresses_source),
            daemon=True,
            name="osrm-download",
        )
        thread.start()

    def _download_thread(self, region_id: str, pbf_url: str, openaddresses_source: str = "") -> None:
        """Synchronous download in a background thread — no asyncio involvement."""
        region_dir = self._region_dir(region_id)
        region_dir.mkdir(parents=True, exist_ok=True)
        pbf_path = self._pbf_path(region_id)

        log.info("Downloading PBF for %s from %s", region_id, pbf_url)

        try:
            # Download PBF
            self._download_file(pbf_url, str(pbf_path), "download")
            log.info("PBF download complete: %s", pbf_path)

            # Download OpenAddresses (if available)
            if openaddresses_source:
                from .regions import resolve_openaddresses_url
                oa_url = resolve_openaddresses_url(openaddresses_source)
                if oa_url:
                    oa_path = str(region_dir / "openaddresses.geojson.gz")
                    log.info("Downloading OpenAddresses for %s", region_id)
                    self.download_progress["step"] = "download_addresses"
                    self._download_file(oa_url, oa_path, "download_addresses")
                    log.info("OpenAddresses download complete: %s", oa_path)
                else:
                    log.warning("Could not resolve OpenAddresses URL for %s, skipping", openaddresses_source)

            self.download_progress["step"] = "complete"
            self.download_progress["percent"] = 100

        except Exception as e:
            log.error("Download failed for %s: %s", region_id, e, exc_info=True)
            self.last_error = str(e)
            self.download_progress["step"] = "error"

    def _download_file(self, url: str, dest_path: str, progress_step: str) -> None:
        """Download a file with progress tracking."""
        req = urllib.request.Request(url, headers={"User-Agent": "SpeedDeck/1.0"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0

            with open(dest_path, "wb") as f:
                while True:
                    chunk = resp.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    pct = round(downloaded / total * 100) if total > 0 else 0
                    self.download_progress = {
                        "step": progress_step,
                        "percent": pct,
                        "downloadedMb": round(downloaded / 1024 / 1024),
                        "totalMb": round(total / 1024 / 1024),
                    }

    async def process_region(self, region_id: str) -> None:
        """Process PBF into OSRM routing graph + geocoding index. Progress in self.process_progress."""
        pbf_path = self._pbf_path(region_id)
        osrm_path = self._osrm_path(region_id)

        if not pbf_path.exists():
            raise FileNotFoundError(f"PBF not found: {pbf_path}")

        self.last_error = None
        car_profile = self._find_car_profile()
        steps = [
            ("extract", [self._resolve_binary("osrm-extract"), "-p", car_profile, str(pbf_path)]),
            ("partition", [self._resolve_binary("osrm-partition"), str(osrm_path)]),
            ("customize", [self._resolve_binary("osrm-customize"), str(osrm_path)]),
        ]

        step_info = {
            "extract": {"label": "Extracting road network", "estimate": "~30 seconds"},
            "partition": {"label": "Partitioning graph", "estimate": "~10 seconds"},
            "customize": {"label": "Optimizing routes", "estimate": "~5 seconds"},
        }

        for i, (step_name, cmd) in enumerate(steps):
            log.info("OSRM %s: %s", step_name, " ".join(cmd))
            info = step_info.get(step_name, {})
            self.process_progress = {
                "step": step_name,
                "stepNumber": i + 1,
                "totalSteps": 4,
                "percent": round(i / 4 * 100),
                "label": info.get("label", step_name),
                "estimate": info.get("estimate", ""),
            }

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(self._region_dir(region_id)),
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                error = stderr.decode("utf-8", errors="replace")[:500]
                raise RuntimeError(f"OSRM {step_name} failed (exit {proc.returncode}): {error}")

            log.info("OSRM %s complete", step_name)

        # Build geocoding index (run in thread to avoid blocking the event loop)
        self.process_progress = {
            "step": "geocoder", "stepNumber": 4, "totalSteps": 4, "percent": 75,
            "label": "Building search index (addresses, roads, POIs)", "estimate": "~15-20 minutes",
        }

        from .geocoder import build_geocoder_index
        # Check for OpenAddresses data in either format
        oa_gz = self._region_dir(region_id) / "openaddresses.geojson.gz"
        oa_zip = self._region_dir(region_id) / "openaddresses.zip"
        oa_path = str(oa_gz) if oa_gz.exists() else (str(oa_zip) if oa_zip.exists() else None)
        oa_zip_arg = oa_path
        await asyncio.get_event_loop().run_in_executor(
            None, build_geocoder_index, str(pbf_path), str(self._places_db_path(region_id)), oa_zip_arg
        )

        # Write metadata
        from .regions import get_region
        region = get_region(region_id)
        meta = {
            "regionId": region_id,
            "regionName": region.name if region else region_id,
            "status": "ready",
        }
        self._meta_path(region_id).write_text(json.dumps(meta))

        self.process_progress = {"step": "done", "stepNumber": 4, "totalSteps": 4, "percent": 100}
        log.info("Region %s fully processed", region_id)

    async def start_router(self, region_id: str | None = None) -> bool:
        """Start osrm-routed for the given or installed region."""
        if self._router_process and self._router_process.returncode is None:
            log.info("OSRM router already running")
            return True

        # Find the region to route
        if not region_id:
            for d in self._data_dir.iterdir():
                if d.is_dir() and (d / "meta.json").exists():
                    try:
                        meta = json.loads((d / "meta.json").read_text())
                        if meta.get("status") == "ready":
                            region_id = meta["regionId"]
                            break
                    except (json.JSONDecodeError, OSError):
                        continue

        if not region_id:
            log.warning("No processed routing data found")
            return False

        osrm_path = self._osrm_path(region_id)
        # OSRM uses the base path as a prefix — check for any .osrm.* files
        osrm_files = list(self._region_dir(region_id).glob("region.osrm.*"))
        if not osrm_files:
            log.warning("OSRM data not found in: %s", self._region_dir(region_id))
            return False

        cmd = [
            self._resolve_binary("osrm-routed"),
            "--algorithm=MLD",
            f"--port={self._router_port}",
            str(osrm_path),
        ]
        log.info("Starting OSRM router: %s", " ".join(cmd))

        try:
            self._router_process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError:
            log.error("osrm-routed binary not found. Install OSRM: brew install osrm-backend")
            return False

        self._active_region = region_id

        # Wait for HTTP readiness
        import aiohttp
        for attempt in range(30):
            await asyncio.sleep(0.5)
            if self._router_process.returncode is not None:
                log.error("OSRM router exited with code %d", self._router_process.returncode)
                self._router_process = None
                return False
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(f"http://127.0.0.1:{self._router_port}/", timeout=aiohttp.ClientTimeout(total=2)):
                        log.info("OSRM router ready on port %d", self._router_port)
                        return True
            except (aiohttp.ClientError, asyncio.TimeoutError):
                continue

        log.error("OSRM router did not become ready in 15 seconds")
        await self.stop_router()
        return False

    async def stop_router(self) -> None:
        """Stop the osrm-routed process."""
        if not self._router_process:
            return

        log.info("Stopping OSRM router")
        try:
            self._router_process.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self._router_process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._router_process.kill()
                await self._router_process.wait()
        except ProcessLookupError:
            pass

        self._router_process = None
        self._active_region = None
        log.info("OSRM router stopped")

    async def delete_region(self, region_id: str | None = None) -> None:
        """Delete a downloaded region's data."""
        await self.stop_router()

        if not region_id:
            # Delete all
            for d in self._data_dir.iterdir():
                if d.is_dir():
                    shutil.rmtree(d, ignore_errors=True)
        else:
            region_dir = self._region_dir(region_id)
            if region_dir.exists():
                shutil.rmtree(region_dir, ignore_errors=True)

        log.info("Deleted routing data for %s", region_id or "all regions")
