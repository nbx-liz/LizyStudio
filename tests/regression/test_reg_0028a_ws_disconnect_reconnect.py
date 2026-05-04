"""Regression tests for WebSocket disconnect/reconnect resilience (Issue #28 (a)).

Builds on top of:

- ``test_reg_0162_ws_backpressure_disconnect`` — single-disconnect cleanup.
- ``test_progress.TestTerminalReplayCache`` — terminal replay cache (P-0093).

This file fills the remaining sub-area (a) coverage gaps that those
files do not directly exercise:

- INV: a mid-stream reconnect (disconnect after partial progress) sees
  subsequent broadcast messages on the *new* queue, never on the dead
  one.
- INV: N rapid reconnect cycles for the same ``job_id`` do not leak
  subscriber entries in :class:`ProgressBroadcaster`.
- INV: a terminal sent during the disconnect window is replayed in
  full on reconnect, including the progress that preceded it.
- INV: reconnect under producer load (broadcast rate ≈ MAX_QUEUE_SIZE)
  preserves the terminal even when the dead queue is full at the
  moment of disconnect.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocketDisconnect

from lizystudio.ws.progress import (
    MAX_QUEUE_SIZE,
    ProgressBroadcaster,
    websocket_progress,
)

pytestmark = pytest.mark.unit


def _run(coro: Any) -> Any:
    """Drive a coroutine on a fresh loop (mirrors test_reg_0162)."""
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


def test_midstream_reconnect_receives_subsequent_progress() -> None:
    """A consumer that disconnects after partial progress and reconnects
    must receive subsequent broadcast messages on the *new* subscriber
    queue, not the abandoned one. Without this guarantee the UI shows
    'running' forever after a transient WS drop.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        # First subscriber receives progress 1/3, then disconnects.
        q1 = broadcaster.subscribe("job_mid")
        broadcaster.send_progress("job_mid", current=1, total=3, message="t1")
        await asyncio.sleep(0)
        first_msg = q1.get_nowait()
        assert first_msg["current"] == 1

        broadcaster.unsubscribe("job_mid", q1)

        # Producer keeps emitting while the consumer is offline.
        broadcaster.send_progress("job_mid", current=2, total=3, message="t2")
        await asyncio.sleep(0)

        # Reconnect.
        q2 = broadcaster.subscribe("job_mid")

        # Subsequent progress lands on q2, NOT q1.
        broadcaster.send_progress("job_mid", current=3, total=3, message="t3")
        await asyncio.sleep(0)

        msgs_q2: list[dict[str, Any]] = []
        while not q2.empty():
            msgs_q2.append(q2.get_nowait())
        currents = [m["current"] for m in msgs_q2 if m.get("type") == "progress"]
        assert 3 in currents, f"reconnected subscriber missed t3: {msgs_q2}"

        # The dead queue receives nothing further.
        assert q1.empty()

    _run(run())


def test_n_reconnect_cycles_do_not_leak_subscribers() -> None:
    """Repeated subscribe/unsubscribe cycles for the same ``job_id``
    must not grow the broadcaster's internal queue list. Without this,
    a flaky network connection running 50 reconnects/min would fill
    the registry with stale entries until the producer thread iterated
    over them on every send().
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        for _ in range(20):
            q = broadcaster.subscribe("job_cycle")
            broadcaster.send_progress("job_cycle", current=1, total=1, message=".")
            await asyncio.sleep(0)
            broadcaster.unsubscribe("job_cycle", q)

        # After 20 cycles the registry has zero entries for this job.
        assert broadcaster._queues.get("job_cycle") in (None, [])

    _run(run())


def test_terminal_during_disconnect_replays_on_reconnect() -> None:
    """The producer fires ``progress`` then ``completed`` while the
    consumer is offline. Reconnect must observe the cached ``completed``
    so the client converges to the correct final state without polling.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        q1 = broadcaster.subscribe("job_drop")
        broadcaster.send_progress("job_drop", current=1, total=2, message="t1")
        await asyncio.sleep(0)
        broadcaster.unsubscribe("job_drop", q1)

        # All remaining traffic happens during the disconnect window.
        broadcaster.send_progress("job_drop", current=2, total=2, message="t2")
        broadcaster.send_completed("job_drop", "Done!")
        await asyncio.sleep(0)

        # Reconnect — the cached terminal is replayed.
        q2 = broadcaster.subscribe("job_drop")
        msgs: list[dict[str, Any]] = []
        while not q2.empty():
            msgs.append(q2.get_nowait())
        types = [m["type"] for m in msgs]
        assert "completed" in types, f"reconnect missed the cached terminal: {types}"

    _run(run())


def test_reconnect_when_dead_queue_was_full_still_delivers_terminal() -> None:
    """If the producer floods the original queue past ``MAX_QUEUE_SIZE``
    and then sends a terminal *after* the consumer disconnects, the
    reconnecting subscriber still receives the terminal via the cache.

    Guards against a regression where the eviction logic on a full
    queue could clobber the cached terminal entry.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q1 = broadcaster.subscribe("job_full")

        # Saturate q1 well beyond capacity.
        for i in range(MAX_QUEUE_SIZE * 2):
            broadcaster.send_progress(
                "job_full", current=i, total=MAX_QUEUE_SIZE * 2, message="x"
            )
        await asyncio.sleep(0)
        assert q1.qsize() <= MAX_QUEUE_SIZE

        # Disconnect, then send the terminal.
        broadcaster.unsubscribe("job_full", q1)
        broadcaster.send_completed("job_full", "Done!")
        await asyncio.sleep(0)

        # Reconnect; cache replay must surface the terminal.
        q2 = broadcaster.subscribe("job_full")
        msgs: list[dict[str, Any]] = []
        while not q2.empty():
            msgs.append(q2.get_nowait())
        assert any(m["type"] == "completed" for m in msgs), (
            f"reconnect after queue saturation missed the terminal: {msgs}"
        )

    _run(run())


def test_disconnect_midstream_via_handler_then_reconnect() -> None:
    """Integration-level: drive the actual ``websocket_progress``
    handler twice. First connection disconnects mid-progress; second
    connection (reconnect) receives the cached terminal even though it
    was sent while the first connection was tearing down.
    """
    broadcaster = ProgressBroadcaster()

    ws1 = _make_websocket()
    ws2 = _make_websocket()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        # First WS connection: starts streaming, disconnects on send_text.
        task1 = asyncio.create_task(websocket_progress(ws1, "job_handler", broadcaster))
        await asyncio.sleep(0.01)
        ws1.send_text.side_effect = WebSocketDisconnect(code=1001)
        broadcaster.send_progress("job_handler", current=1, total=2, message="partial")
        await asyncio.wait_for(task1, timeout=2.0)

        # While the client is offline the producer completes.
        broadcaster.send_completed("job_handler", "Done!")
        await asyncio.sleep(0)

        # Second WS connection (reconnect): handler exits cleanly after
        # delivering the cached terminal.
        task2 = asyncio.create_task(websocket_progress(ws2, "job_handler", broadcaster))
        await asyncio.wait_for(task2, timeout=2.0)

        sent_payloads = [
            json.loads(call.args[0]) for call in ws2.send_text.call_args_list
        ]
        types = [p.get("type") for p in sent_payloads]
        assert "completed" in types, f"reconnected client did not see terminal: {types}"

        # Both subscriptions cleaned up.
        assert "job_handler" not in broadcaster._queues

    _run(run())
