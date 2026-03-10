"""WebSocket progress broadcaster (BLUEPRINT §5.5).

Stores progress state per job_id in memory. WebSocket clients connect
to ``/ws/jobs/{job_id}/progress`` and receive JSON messages:

- ``{"type": "progress", "job_id": ..., "current": N, "total": M, "message": ...}``
- ``{"type": "completed", "job_id": ..., "message": ...}``
- ``{"type": "error", "job_id": ..., "message": ..., "code": ...}``
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect


class ProgressBroadcaster:
    """In-memory progress broadcaster.

    Thread-safe: training threads call :meth:`send` which enqueues messages
    for async WebSocket handlers to read via :meth:`subscribe`.
    """

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the event loop reference for thread-safe enqueuing."""
        self._loop = loop

    def subscribe(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        """Create a new subscription queue for a job. Called from async."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscription."""
        qs = self._queues.get(job_id, [])
        if q in qs:
            qs.remove(q)
        if not qs:
            self._queues.pop(job_id, None)

    def send(self, job_id: str, message: dict[str, Any]) -> None:
        """Enqueue a message for all subscribers (thread-safe)."""
        qs = self._queues.get(job_id, [])
        if not qs or self._loop is None:
            return
        for q in qs:
            self._loop.call_soon_threadsafe(q.put_nowait, message)

    def send_progress(
        self, job_id: str, *, current: int, total: int, message: str
    ) -> None:
        """Convenience: send a progress message."""
        self.send(
            job_id,
            {
                "type": "progress",
                "job_id": job_id,
                "current": current,
                "total": total,
                "message": message,
            },
        )

    def send_completed(self, job_id: str, message: str = "Completed.") -> None:
        """Convenience: send a completion message."""
        self.send(
            job_id,
            {"type": "completed", "job_id": job_id, "message": message},
        )

    def send_error(
        self, job_id: str, message: str, code: str = "BACKEND_ERROR"
    ) -> None:
        """Convenience: send an error message."""
        self.send(
            job_id,
            {
                "type": "error",
                "job_id": job_id,
                "message": message,
                "code": code,
            },
        )

    def make_callback(self, job_id: str) -> Any:
        """Create a ProgressCallback for a specific job."""

        def callback(*, current: int, total: int, message: str) -> None:
            self.send_progress(job_id, current=current, total=total, message=message)

        return callback


async def websocket_progress(
    websocket: WebSocket,
    job_id: str,
    broadcaster: ProgressBroadcaster,
) -> None:
    """WebSocket handler for ``/ws/jobs/{job_id}/progress``."""
    await websocket.accept()
    queue = broadcaster.subscribe(job_id)
    try:
        while True:
            msg = await asyncio.wait_for(queue.get(), timeout=30.0)
            await websocket.send_text(json.dumps(msg))
            if msg.get("type") in ("completed", "error"):
                break
    except asyncio.TimeoutError:
        # Send keepalive ping on timeout
        with contextlib.suppress(Exception):
            await websocket.send_text(json.dumps({"type": "ping", "job_id": job_id}))
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unsubscribe(job_id, queue)
