"""Async WebSocket server for streaming GPS data to the Electron frontend."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable

import websockets
from websockets.asyncio.server import Server, ServerConnection

from .protocol import GPSState, StatusMessage, TripListMessage, GpxDataMessage, parse_command

log = logging.getLogger(__name__)


class WebSocketServer:
    """Broadcasts GPS state to connected clients and handles commands."""

    def __init__(self, host: str, port: int):
        self._host = host
        self._port = port
        self._clients: set[ServerConnection] = set()
        self._server: Server | None = None
        self._state_queue: asyncio.Queue[GPSState] = asyncio.Queue(maxsize=50)
        self._command_handler: Callable[[dict], asyncio.Future] | None = None
        self._last_state_json: str | None = None

    @property
    def last_state_json(self) -> str | None:
        return self._last_state_json

    def set_command_handler(self, handler: Callable[[dict], asyncio.Future]) -> None:
        self._command_handler = handler

    async def start(self) -> None:
        self._server = await websockets.serve(
            self._handle_client,
            self._host,
            self._port,
        )
        log.info("WebSocket server started on ws://%s:%d", self._host, self._port)
        # Start broadcast loop
        asyncio.create_task(self._broadcast_loop())

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()
            log.info("WebSocket server stopped")

    def push_state(self, state: GPSState) -> None:
        """Thread-safe: push a GPS state for broadcast."""
        try:
            self._state_queue.put_nowait(state)
        except asyncio.QueueFull:
            # Drop oldest
            try:
                self._state_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                self._state_queue.put_nowait(state)
            except asyncio.QueueFull:
                pass

    async def send_to_all(self, message: str) -> None:
        if not self._clients:
            return
        dead = set()
        for client in self._clients:
            try:
                await client.send(message)
            except websockets.ConnectionClosed:
                dead.add(client)
        self._clients -= dead

    async def _handle_client(self, ws: ServerConnection) -> None:
        self._clients.add(ws)
        remote = ws.remote_address
        log.info("Client connected: %s", remote)
        # Send last known state immediately so new clients don't wait
        if self._last_state_json:
            try:
                await ws.send(self._last_state_json)
            except websockets.ConnectionClosed:
                self._clients.discard(ws)
                return
        try:
            async for raw in ws:
                cmd = parse_command(raw)
                if cmd["type"] == "command" and self._command_handler:
                    response = await self._command_handler(cmd)
                    if response:
                        await ws.send(response)
        except websockets.ConnectionClosed:
            pass
        finally:
            self._clients.discard(ws)
            log.info("Client disconnected: %s", remote)

    async def _broadcast_loop(self) -> None:
        while True:
            state = await self._state_queue.get()
            msg = state.to_json()
            self._last_state_json = msg
            await self.send_to_all(msg)
