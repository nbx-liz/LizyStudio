"""WebSocket progress broadcaster (BLUEPRINT §5.5).

Stores progress state per job_id in memory. WebSocket clients connect
to ``/ws/jobs/{job_id}/progress`` and receive JSON messages whose
schema is defined by the Pydantic union in
:mod:`lizystudio.ws.messages` (H-0069):

- ``progress``: ``{type, job_id, current, total, message,
  fold_results?, trial_results?}``
- ``completed``: ``{type, job_id, message}``
- ``error``: ``{type, job_id, message, code}``
- ``ping``: ``{type, job_id}`` (30-second keepalive, H-0058)
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from lizystudio.ws.messages import WsCompleted, WsError, WsPing, WsProgress

_logger = logging.getLogger(__name__)

# Issue #151: bound every subscriber queue so a slow WS consumer cannot
# grow the server's memory footprint by one message per trial x N
# subscribers during a long tune. 1024 accommodates a reasonable burst
# (tune progress updates are emitted once per trial) while still
# applying back-pressure when a client stops draining.
MAX_QUEUE_SIZE: int = 1024

# Terminal message types. These MUST reach every live subscriber even
# when the queue is full — they are the signal that tells the WS
# handler to close the connection (ws/progress.py:149). Dropping a
# terminal would leave the client waiting for a message that will
# never arrive. The overflow path evicts the oldest non-terminal to
# make room instead of dropping the terminal itself.
_TERMINAL_TYPES: frozenset[str] = frozenset({"completed", "error"})


class ProgressBroadcaster:
    """In-memory progress broadcaster.

    Thread-safe: training threads call :meth:`send` which enqueues messages
    for async WebSocket handlers to read via :meth:`subscribe`.

    Queue policy (Issue #151):

    - Every subscriber queue has ``maxsize=MAX_QUEUE_SIZE``.
    - Non-terminal messages are dropped on overflow and
      ``PROGRESS_DROPPED_TOTAL`` is incremented.
    - Terminal messages (``completed`` / ``error``) never drop; on a
      full queue the oldest non-terminal item is evicted to make room.
    """

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[dict[str, Any]]]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._lock = threading.Lock()

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Store the event loop reference for thread-safe enqueuing."""
        self._loop = loop

    def subscribe(self, job_id: str) -> asyncio.Queue[dict[str, Any]]:
        """Create a new subscription queue for a job. Called from async."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=MAX_QUEUE_SIZE)
        with self._lock:
            self._queues.setdefault(job_id, []).append(q)
        return q

    def unsubscribe(self, job_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        """Remove a subscription."""
        with self._lock:
            qs = self._queues.get(job_id, [])
            if q in qs:
                qs.remove(q)
            if not qs:
                self._queues.pop(job_id, None)

    def send(self, job_id: str, message: dict[str, Any]) -> None:
        """Enqueue a message for all subscribers (thread-safe).

        Honours the terminal-preservation policy: a ``completed`` or
        ``error`` message evicts an older non-terminal on a full queue
        rather than being dropped itself.
        """
        with self._lock:
            qs = list(self._queues.get(job_id, []))
        if not qs or self._loop is None:
            return
        is_terminal = message.get("type") in _TERMINAL_TYPES
        for q in qs:
            self._loop.call_soon_threadsafe(self._enqueue, q, message, is_terminal)

    @staticmethod
    def _enqueue(
        q: asyncio.Queue[dict[str, Any]],
        message: dict[str, Any],
        is_terminal: bool,
    ) -> None:
        """Best-effort enqueue with the Issue #151 overflow policy.

        Runs on the event loop thread via ``call_soon_threadsafe`` so
        ``asyncio.Queue`` operations are safe. Importing the metrics
        counter lazily keeps the import graph free of a cycle between
        ``ws.progress`` and ``metrics`` (metrics is a leaf module).
        """
        try:
            q.put_nowait(message)
            return
        except asyncio.QueueFull:
            pass
        if is_terminal:
            # Evict one non-terminal to make room. Terminals already in
            # the queue are preserved by stashing them aside, evicting a
            # non-terminal, then restoring the terminals. INV-5: a
            # terminal already queued is NEVER dropped.
            preserved_terminals: list[dict[str, Any]] = []
            evicted_nonterminal = False
            while True:
                try:
                    head = q.get_nowait()
                except asyncio.QueueEmpty:
                    break
                if head.get("type") in _TERMINAL_TYPES:
                    preserved_terminals.append(head)
                    continue
                # Found a non-terminal to evict.
                _record_drop()
                evicted_nonterminal = True
                break
            # Put the preserved terminals back first (FIFO order
            # preserved — they were dequeued head-to-tail and we
            # re-enqueue in the same order).
            for t in preserved_terminals:
                try:
                    q.put_nowait(t)
                except asyncio.QueueFull:
                    # Should be impossible: we just freed at least one
                    # slot (by popping `head`). Log and drop rather than
                    # silently lose the terminal.
                    _logger.error(
                        "progress queue failed to restore terminal message: %s",
                        t.get("type"),
                    )
            # Now insert the new terminal. If we evicted a non-terminal
            # there is room; if the queue was drained to empty there is
            # also room. If all preserved terminals plus the new one
            # exceed maxsize, the newest terminal loses (the earlier
            # ones win by FIFO).
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                if not evicted_nonterminal:
                    # Every slot held a terminal; the new terminal has
                    # no room. The existing terminals will close the
                    # connection, so dropping this one is acceptable
                    # but must be visible.
                    _logger.warning(
                        "progress queue full of terminals; dropping new %s",
                        message.get("type"),
                    )
            return
        # Non-terminal on a full queue: drop silently, record metric.
        _record_drop()

    def send_progress(
        self,
        job_id: str,
        *,
        current: int,
        total: int,
        message: str,
        fold_results: list[dict[str, Any]] | None = None,
        trial_results: list[dict[str, Any]] | None = None,
    ) -> None:
        """Convenience: send a progress message (H-0047 / H-0069).

        Callers still pass raw ``list[dict[str, Any]]`` for compatibility
        with the LizyML tuning callbacks; Pydantic coerces the dicts
        into :class:`WsFoldResult` / :class:`WsTrialResult` at
        validation time and ``model_dump(exclude_none=True)`` yields a
        wire payload identical to the pre-H-0069 hand-rolled dict.
        """
        model = WsProgress.model_validate(
            {
                "type": "progress",
                "job_id": job_id,
                "current": current,
                "total": total,
                "message": message,
                "fold_results": fold_results,
                "trial_results": trial_results,
            }
        )
        self.send(job_id, model.model_dump(exclude_none=True))

    def send_completed(self, job_id: str, message: str = "Completed.") -> None:
        """Convenience: send a completion message (H-0069)."""
        model = WsCompleted(type="completed", job_id=job_id, message=message)
        self.send(job_id, model.model_dump(exclude_none=True))

    def send_error(
        self, job_id: str, message: str, code: str = "BACKEND_ERROR"
    ) -> None:
        """Convenience: send an error message (H-0069)."""
        model = WsError(type="error", job_id=job_id, message=message, code=code)
        self.send(job_id, model.model_dump(exclude_none=True))

    def make_callback(self, job_id: str) -> Any:
        """Create a ProgressCallback for a specific job."""

        def callback(*, current: int, total: int, message: str) -> None:
            self.send_progress(job_id, current=current, total=total, message=message)

        return callback


def _record_drop() -> None:
    """Increment the progress-dropped counter without a hard import.

    Kept module-private and lazy so importing ``ws.progress`` does not
    force metrics into the import graph during test collection.
    """
    try:
        from lizystudio.metrics import PROGRESS_DROPPED_TOTAL
    except ImportError:  # pragma: no cover — metrics is optional
        return
    PROGRESS_DROPPED_TOTAL.inc()


_ALLOWED_WS_ORIGINS: set[str] = {
    "http://localhost:5173",
    "http://localhost:8501",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8501",
}


async def websocket_progress(
    websocket: WebSocket,
    job_id: str,
    broadcaster: ProgressBroadcaster,
) -> None:
    """WebSocket handler for ``/ws/jobs/{job_id}/progress``."""
    origin = websocket.headers.get("origin", "")
    if origin and origin not in _ALLOWED_WS_ORIGINS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    queue = broadcaster.subscribe(job_id)
    try:
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=30.0)
            except asyncio.TimeoutError:
                # Send keepalive ping and continue the loop (H-0058 / H-0069)
                with contextlib.suppress(Exception):
                    ping = WsPing(type="ping", job_id=job_id)
                    await websocket.send_text(ping.model_dump_json(exclude_none=True))
                continue
            await websocket.send_text(json.dumps(msg))
            if msg.get("type") in ("completed", "error"):
                break
    except WebSocketDisconnect:
        pass
    finally:
        broadcaster.unsubscribe(job_id, queue)
