"""Regression test for unbounded progress queue (Issue #151).

Verifies the ProgressBroadcaster's per-subscriber queue is bounded and
that terminal messages (``completed`` / ``error``) are never dropped
when a slow consumer leaves the queue full.

## Invariants

- INV-3: ``q.qsize() <= MAX_QUEUE_SIZE`` for every subscriber.
- INV-4: Terminal messages (``completed`` / ``error``) are delivered
  even when the queue is full. The drop policy evicts the oldest
  non-terminal to make room when a terminal arrives.
- INV-5: Only non-terminal messages are ever dropped / evicted.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from lizystudio.ws.progress import MAX_QUEUE_SIZE, ProgressBroadcaster

pytestmark = pytest.mark.unit


def _run(coro: Any) -> Any:
    """Run a coroutine synchronously with a fresh event loop.

    Mirrors the helper in ``tests/test_progress.py`` so this regression
    test does not depend on pytest-asyncio, which is not a project
    dependency.
    """
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_queue_has_declared_maxsize() -> None:
    """INV-3: subscriber queue has maxsize == MAX_QUEUE_SIZE."""
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_1")
        try:
            assert q.maxsize == MAX_QUEUE_SIZE
        finally:
            broadcaster.unsubscribe("job_1", q)

    _run(scenario())


def test_slow_consumer_queue_stays_bounded() -> None:
    """INV-3: a slow consumer cannot grow the queue past its maxsize."""
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_slow")
        try:
            for i in range(MAX_QUEUE_SIZE * 3):
                broadcaster.send_progress(
                    "job_slow", current=i, total=MAX_QUEUE_SIZE * 3, message=f"t{i}"
                )
                # Yield so scheduled put_nowait callbacks actually run.
                await asyncio.sleep(0)
            assert q.qsize() <= MAX_QUEUE_SIZE
        finally:
            broadcaster.unsubscribe("job_slow", q)

    _run(scenario())


def test_terminal_completed_delivered_when_queue_full() -> None:
    """INV-4: ``completed`` is delivered even when the queue is full."""
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_term")
        try:
            for i in range(MAX_QUEUE_SIZE + 10):
                broadcaster.send_progress(
                    "job_term", current=i, total=MAX_QUEUE_SIZE, message=f"t{i}"
                )
                await asyncio.sleep(0)
            broadcaster.send_completed("job_term", "done")
            await asyncio.sleep(0)

            types_seen: list[str] = []
            while not q.empty():
                msg = q.get_nowait()
                types_seen.append(msg.get("type", ""))
            assert "completed" in types_seen, (
                f"completed not delivered; types: {types_seen!r}"
            )
        finally:
            broadcaster.unsubscribe("job_term", q)

    _run(scenario())


def test_terminal_error_delivered_when_queue_full() -> None:
    """INV-4: ``error`` is terminal and must also survive a full queue."""
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_err")
        try:
            for i in range(MAX_QUEUE_SIZE + 5):
                broadcaster.send_progress(
                    "job_err", current=i, total=MAX_QUEUE_SIZE, message=f"t{i}"
                )
                await asyncio.sleep(0)
            broadcaster.send_error("job_err", "boom", code="BACKEND_ERROR")
            await asyncio.sleep(0)

            types_seen: list[str] = []
            while not q.empty():
                msg = q.get_nowait()
                types_seen.append(msg.get("type", ""))
            assert "error" in types_seen
        finally:
            broadcaster.unsubscribe("job_err", q)

    _run(scenario())


def test_drop_policy_preserves_earlier_terminal() -> None:
    """INV-5: a terminal already queued is never evicted by later sends."""
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_preserve")
        try:
            # Put a terminal in first, then flood with non-terminals.
            broadcaster.send_completed("job_preserve", "early done")
            await asyncio.sleep(0)
            for i in range(MAX_QUEUE_SIZE * 2):
                broadcaster.send_progress(
                    "job_preserve",
                    current=i,
                    total=MAX_QUEUE_SIZE,
                    message=f"t{i}",
                )
                await asyncio.sleep(0)

            types_seen: list[str] = []
            while not q.empty():
                msg = q.get_nowait()
                types_seen.append(msg.get("type", ""))
            assert "completed" in types_seen
        finally:
            broadcaster.unsubscribe("job_preserve", q)

    _run(scenario())


def test_two_terminals_on_full_queue_both_survive_or_first_wins() -> None:
    """INV-5 strict: if one terminal is already in a full queue and a
    second terminal arrives, the first terminal must still be
    observable. The second terminal may or may not fit, but it MUST
    NOT displace the first.
    """
    broadcaster = ProgressBroadcaster()

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_two_term")
        try:
            # Enqueue the first terminal so it is at the head.
            broadcaster.send_completed("job_two_term", "first done")
            await asyncio.sleep(0)
            # Fill the rest with non-terminals, then send a second
            # terminal that competes for space.
            for i in range(MAX_QUEUE_SIZE * 2):
                broadcaster.send_progress(
                    "job_two_term",
                    current=i,
                    total=MAX_QUEUE_SIZE,
                    message=f"t{i}",
                )
                await asyncio.sleep(0)
            broadcaster.send_error("job_two_term", "second boom", code="BACKEND_ERROR")
            await asyncio.sleep(0)

            messages: list[dict[str, Any]] = []
            while not q.empty():
                messages.append(q.get_nowait())

            types = [m.get("type") for m in messages]
            # The first terminal MUST be present.
            assert "completed" in types, f"first terminal dropped; types: {types!r}"
            # FIFO preservation: the first terminal comes first among
            # terminals even if a second one also landed.
            terminal_positions = [
                i
                for i, m in enumerate(messages)
                if m.get("type") in {"completed", "error"}
            ]
            first_terminal_type = messages[terminal_positions[0]].get("type")
            assert first_terminal_type == "completed"
        finally:
            broadcaster.unsubscribe("job_two_term", q)

    _run(scenario())


def test_dropped_counter_increments_on_overflow() -> None:
    """Observability: ``progress_dropped_total`` increments on overflow.

    A-9: the counter lives on a per-app :class:`MetricsRegistry`
    injected into the broadcaster at construction time. Using a fresh
    registry here isolates the drop accounting from whatever
    counts the main ``client`` fixture's app may also be emitting in
    the same pytest session.
    """
    from lizystudio.metrics import MetricsRegistry

    metrics = MetricsRegistry()
    broadcaster = ProgressBroadcaster(metrics=metrics)

    async def scenario() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        q = broadcaster.subscribe("job_counter")
        try:
            before = metrics.progress_dropped_total._value.get()  # type: ignore[attr-defined]

            overflow = MAX_QUEUE_SIZE
            total = MAX_QUEUE_SIZE + overflow
            for i in range(total):
                broadcaster.send_progress(
                    "job_counter", current=i, total=total, message=f"t{i}"
                )
                await asyncio.sleep(0)

            after = metrics.progress_dropped_total._value.get()  # type: ignore[attr-defined]
            assert after - before >= overflow, (
                f"expected at least {overflow} drops, got delta={after - before}"
            )
        finally:
            broadcaster.unsubscribe("job_counter", q)

    _run(scenario())
