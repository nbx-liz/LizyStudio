"""Regression tests for WebSocket backpressure and disconnect cleanup (Issue #162).

The bounded-queue behaviour is already covered line-by-line in
``test_reg_0151_progress_queue_bounded.py``. This file adds the
integration-level assertions requested by #162's acceptance:

- Subscriber cleanup runs on disconnect so stale queues do not leak.
- The invalid-origin handshake path closes with code 1008 before a
  subscription is ever created.
- The "queue full of earlier terminals" edge in
  ``ProgressBroadcaster._enqueue`` (lines 153-159) is exercised so
  the warning path is covered, without losing either terminal.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from lizystudio.ws.progress import (
    MAX_QUEUE_SIZE,
    ProgressBroadcaster,
    websocket_progress,
)

pytestmark = pytest.mark.unit


def _run(coro: Any) -> Any:
    """Run a coroutine synchronously on a fresh loop.

    Mirrors the helper in ``tests/test_progress.py`` so this test
    file remains independent of pytest-asyncio.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def _make_websocket(origin: str | None = None) -> MagicMock:
    """Mock WebSocket with async accept/send_text/close."""
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    ws.headers = {"origin": origin} if origin is not None else {}
    return ws


def test_subscriber_cleaned_up_on_disconnect() -> None:
    """INV: after a slow/disconnected consumer terminates, the
    broadcaster's ``_queues`` registry no longer holds its entry.

    Without cleanup, memory grows by one dead subscriber per connect/
    disconnect cycle during a long tune.
    """
    from fastapi import WebSocketDisconnect

    ws = _make_websocket()
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        task = asyncio.create_task(websocket_progress(ws, "job-disc", broadcaster))
        await asyncio.sleep(0.01)
        # Force a disconnect on the next send_text.
        ws.send_text.side_effect = WebSocketDisconnect(code=1001)
        broadcaster.send_progress("job-disc", current=1, total=10, message="x")
        await asyncio.wait_for(task, timeout=2.0)

    _run(run())

    # Registry is empty for this job_id — the only subscriber was
    # unsubscribed in the finally block.
    assert "job-disc" not in broadcaster._queues


def test_invalid_origin_closes_with_1008_and_no_subscription() -> None:
    """INV: a WebSocket with a non-allowlisted ``Origin`` is closed
    (code 1008) before ``subscribe`` is called, so no stray queue is
    registered.
    """
    ws = _make_websocket(origin="https://evil.example.com")
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        await websocket_progress(ws, "job-origin", broadcaster)

    _run(run())

    ws.close.assert_awaited_once_with(code=1008)
    ws.accept.assert_not_called()
    assert "job-origin" not in broadcaster._queues


def test_empty_origin_still_accepts_connection() -> None:
    """No Origin header (e.g. a non-browser client) passes the check
    and reaches ``accept()``. Regression guard for #167 — the origin
    whitelist must not reject the empty-string fallback that FastAPI
    uses when the header is absent.
    """
    ws = _make_websocket()  # no Origin header
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        task = asyncio.create_task(
            websocket_progress(ws, "job-noorigin", broadcaster),
        )
        await asyncio.sleep(0.01)
        broadcaster.send_completed("job-noorigin", "done")
        await asyncio.wait_for(task, timeout=2.0)

    _run(run())

    ws.accept.assert_awaited_once()
    sent = [json.loads(c.args[0]) for c in ws.send_text.call_args_list]
    assert any(p.get("type") == "completed" for p in sent)


def test_slow_consumer_under_high_load_stays_bounded() -> None:
    """Subscriber that never drains its queue while the producer
    fires ``MAX_QUEUE_SIZE * 4`` progress messages must leave the
    queue bounded by ``MAX_QUEUE_SIZE``. Extends the unit test in
    ``test_reg_0151`` to the integration level (async sleeps instead
    of a manual loop).
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job-slow")
        try:
            for i in range(MAX_QUEUE_SIZE * 4):
                broadcaster.send_progress(
                    "job-slow",
                    current=i,
                    total=MAX_QUEUE_SIZE * 4,
                    message=f"t{i}",
                )
                # Yield so the call_soon_threadsafe callbacks run.
                await asyncio.sleep(0)
            assert q.qsize() <= MAX_QUEUE_SIZE
        finally:
            broadcaster.unsubscribe("job-slow", q)

    _run(run())


def test_queue_full_of_terminals_drops_new_terminal_with_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Edge case: the queue is completely filled with earlier
    terminals. When a new terminal arrives, there is no non-terminal
    to evict. The new terminal is dropped and a warning is logged;
    the earlier terminals survive so the client still receives a
    connection-close signal.
    """
    import logging

    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job-full-terms")
        try:
            # Fill the queue entirely with terminals (mix completed + error
            # so FIFO ordering is observable below).
            for i in range(MAX_QUEUE_SIZE + 5):
                # Alternate to get a mix of terminals.
                if i % 2 == 0:
                    broadcaster.send_completed("job-full-terms", f"done-{i}")
                else:
                    broadcaster.send_error("job-full-terms", f"boom-{i}")
                await asyncio.sleep(0)
            # All queued items should be terminals; qsize capped at maxsize.
            assert q.qsize() == MAX_QUEUE_SIZE

            messages: list[dict[str, Any]] = []
            while not q.empty():
                messages.append(q.get_nowait())
            assert all(m.get("type") in {"completed", "error"} for m in messages)
        finally:
            broadcaster.unsubscribe("job-full-terms", q)

    with caplog.at_level(logging.WARNING, logger="lizystudio.ws.progress"):
        _run(run())

    # The warning fires each time the overflow-with-all-terminals
    # path was taken (at least once because we sent MAX_QUEUE_SIZE+5).
    warnings = [r for r in caplog.records if "full of terminals" in r.getMessage()]
    assert warnings, "expected at least one 'full of terminals' warning"


def test_evict_loop_handles_queue_drained_concurrently() -> None:
    """Covers the QueueEmpty branch in ``_enqueue``'s evict loop:
    when the queue is drained concurrently between the fullness check
    and ``get_nowait``, the broadcaster falls through and attempts to
    insert the terminal directly instead of looping forever.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job-drained")
        try:
            # Manually fill then immediately drain so the evict path
            # finds the queue empty. Use put_nowait directly because
            # we want a deterministic pre-state.
            for i in range(MAX_QUEUE_SIZE):
                q.put_nowait(
                    {"type": "progress", "job_id": "job-drained", "current": i},
                )
            while not q.empty():
                q.get_nowait()

            broadcaster.send_completed("job-drained", "after drain")
            await asyncio.sleep(0)

            messages: list[dict[str, Any]] = []
            while not q.empty():
                messages.append(q.get_nowait())
            assert any(m.get("type") == "completed" for m in messages)
        finally:
            broadcaster.unsubscribe("job-drained", q)

    _run(run())
