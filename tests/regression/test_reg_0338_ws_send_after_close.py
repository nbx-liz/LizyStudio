"""Regression test for Issue #338 — WebSocket progress endpoint
raises ``RuntimeError`` when ``send_text`` is invoked after the
underlying transport has already sent a close frame.

Repro before fix:

1. Client opens ``/ws/jobs/{id}/progress`` and the server enqueues
   the cached terminal message (PR #329 replay).
2. Server reads the message off the queue and tries to ``send_text``.
3. If the client disconnected between accept() and the first send
   (e.g. tab close, page navigation), Starlette's WebSocket has
   already transitioned to ``DISCONNECTED`` and ``send`` raises
   ``RuntimeError: Cannot call "send" once a close message has been
   sent.``
4. The current handler only catches ``WebSocketDisconnect`` so the
   RuntimeError propagates and Starlette logs ``ERROR: Exception in
   ASGI application`` with a noisy stack trace.

The fix treats the ``RuntimeError`` from a closed transport the same
as a ``WebSocketDisconnect`` — silently exit the loop and unsubscribe
in the finally block.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from lizystudio.ws.progress import ProgressBroadcaster, websocket_progress

pytestmark = pytest.mark.unit


def _run(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _make_websocket() -> MagicMock:
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    ws.headers = {}
    return ws


def test_send_after_close_runtime_error_is_swallowed() -> None:
    """INV: ``websocket_progress`` exits cleanly when ``send_text``
    raises ``RuntimeError("Cannot call \"send\" once a close message
    has been sent.")`` due to a client-side disconnect that happens
    between accept() and the first message dispatch.

    Before the fix this exception escaped the handler and Starlette
    logged ``ERROR: Exception in ASGI application``. The handler must
    behave identically to the WebSocketDisconnect path: break out of
    the loop and unsubscribe the queue in the finally block.
    """
    ws = _make_websocket()
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        # Starlette raises this exact RuntimeError when ``send`` is
        # called after the application_state has flipped to
        # DISCONNECTED. We mirror that wording so a future Starlette
        # version with a different message still fails the regression.
        ws.send_text.side_effect = RuntimeError(
            'Cannot call "send" once a close message has been sent.',
        )
        task = asyncio.create_task(websocket_progress(ws, "job-rt", broadcaster))
        await asyncio.sleep(0.01)
        broadcaster.send_progress("job-rt", current=1, total=10, message="x")
        # Without the fix, the gather below propagates the RuntimeError
        # and the test fails with ``RuntimeError: Cannot call "send"...``.
        await asyncio.wait_for(task, timeout=2.0)

    _run(run())

    # Subscriber registry is cleaned up exactly like the
    # WebSocketDisconnect path — the finally block must run.
    assert "job-rt" not in broadcaster._queues


def test_send_after_close_runtime_error_during_ping_is_swallowed() -> None:
    """Sanity guard: the keepalive ping path was already wrapped in
    ``contextlib.suppress(Exception)`` before the fix. This test
    locks in that behavior so a regression in the ping branch shows
    up immediately.
    """
    ws = _make_websocket()
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        ws.send_text.side_effect = RuntimeError(
            'Cannot call "send" once a close message has been sent.',
        )
        # Drive the keepalive path by sending a terminal AFTER the
        # ping fails, so the loop exits cleanly via the message branch
        # we are testing.
        task = asyncio.create_task(websocket_progress(ws, "job-rt-ping", broadcaster))
        await asyncio.sleep(0.01)
        broadcaster.send_completed("job-rt-ping", "done")
        await asyncio.wait_for(task, timeout=2.0)

    _run(run())

    assert "job-rt-ping" not in broadcaster._queues
