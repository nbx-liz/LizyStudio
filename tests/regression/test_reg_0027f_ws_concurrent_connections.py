"""Stress tests for WebSocket fan-out under concurrent subscribers (Issue #27 (f)).

``test_progress.test_multiple_subscribers`` covers the basic 2-3
subscriber case. This file scales to 20+ concurrent subscribers and
adds connection/disconnection churn during active broadcasting:

- INV: every live subscriber receives every progress message broadcast
  while it is subscribed (modulo the bounded-queue overflow policy).
- INV: subscribers added/removed during a live broadcast leave the
  broadcaster state consistent — no leaked queues, no fan-out crash.
- INV: terminal messages reach every subscriber that is connected
  at send time (per :class:`ProgressBroadcaster` INV-1).
- INV: subscribers attached AFTER the terminal observe the cached
  terminal via the replay path (per P-0093) — even when 20 of them
  reconnect at once.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from lizystudio.ws.progress import ProgressBroadcaster

pytestmark = pytest.mark.unit


def _run(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


def test_20_subscribers_each_receive_terminal() -> None:
    """20 concurrent subscribers on the same job_id all receive the
    completed terminal. No subscriber is left in 'running' forever.
    """
    broadcaster = ProgressBroadcaster()
    n = 20

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())
        queues = [broadcaster.subscribe("job_fanout") for _ in range(n)]

        broadcaster.send_progress("job_fanout", current=1, total=2, message="x")
        broadcaster.send_completed("job_fanout", "Done!")
        await asyncio.sleep(0)

        for i, q in enumerate(queues):
            msgs: list[dict[str, Any]] = []
            while not q.empty():
                msgs.append(q.get_nowait())
            types = [m["type"] for m in msgs]
            assert "completed" in types, f"subscriber #{i} missed terminal: {types}"

    _run(run())


def test_subscribers_joining_during_broadcast_observe_subsequent_messages() -> None:
    """A subscriber that joins mid-broadcast must receive every
    message broadcast AFTER its subscribe() call. Earlier messages
    that fired before subscribe() are not retroactively delivered
    (no replay for non-terminal progress per the cache policy).
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        q_early = broadcaster.subscribe("job_join")
        broadcaster.send_progress("job_join", current=1, total=3, message="a")
        await asyncio.sleep(0)

        # Join mid-stream.
        q_late = broadcaster.subscribe("job_join")
        broadcaster.send_progress("job_join", current=2, total=3, message="b")
        broadcaster.send_progress("job_join", current=3, total=3, message="c")
        await asyncio.sleep(0)

        early_msgs: list[dict[str, Any]] = []
        while not q_early.empty():
            early_msgs.append(q_early.get_nowait())
        late_msgs: list[dict[str, Any]] = []
        while not q_late.empty():
            late_msgs.append(q_late.get_nowait())

        early_currents = [m["current"] for m in early_msgs]
        late_currents = [m["current"] for m in late_msgs]
        # Early sub saw all three.
        assert early_currents == [1, 2, 3], early_msgs
        # Late sub missed message 1 but caught 2 and 3.
        assert late_currents == [2, 3], late_msgs

    _run(run())


def test_subscriber_churn_does_not_corrupt_broadcaster_state() -> None:
    """Repeated subscribe/unsubscribe cycles interleaved with
    broadcasts must leave ``_queues`` consistent: every entry maps to
    a live queue, and no zombie keys remain.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        keep_q = broadcaster.subscribe("job_churn")

        # 10 churn cycles interleaved with broadcasts.
        for i in range(10):
            ephemeral_q = broadcaster.subscribe("job_churn")
            broadcaster.send_progress("job_churn", current=i, total=10, message=".")
            await asyncio.sleep(0)
            broadcaster.unsubscribe("job_churn", ephemeral_q)

        broadcaster.send_completed("job_churn", "Done!")
        await asyncio.sleep(0)

        # The keeper subscriber received every progress and the terminal.
        msgs: list[dict[str, Any]] = []
        while not keep_q.empty():
            msgs.append(keep_q.get_nowait())
        assert sum(1 for m in msgs if m["type"] == "progress") == 10
        assert any(m["type"] == "completed" for m in msgs)

        # _queues retains only the keeper.
        live = broadcaster._queues.get("job_churn", [])
        assert live == [keep_q], f"churn left zombie subscribers: {len(live)} entries"

        broadcaster.unsubscribe("job_churn", keep_q)
        # After everyone leaves, the entry is GC'd.
        assert "job_churn" not in broadcaster._queues

    _run(run())


def test_burst_reconnect_after_terminal_all_get_replay() -> None:
    """20 subscribers reconnect simultaneously after the terminal was
    sent. Each must see the cached terminal via the P-0093 replay
    path so the UI on every tab converges to the correct final state
    without polling.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        # Terminal sent before anyone is subscribed.
        broadcaster.send_completed("job_burst", "Done!")
        await asyncio.sleep(0)

        # 20 simultaneous reconnects.
        queues = [broadcaster.subscribe("job_burst") for _ in range(20)]

        for i, q in enumerate(queues):
            msgs: list[dict[str, Any]] = []
            while not q.empty():
                msgs.append(q.get_nowait())
            types = [m["type"] for m in msgs]
            assert "completed" in types, (
                f"reconnect #{i} did not see cached terminal: {types}"
            )

    _run(run())


def test_independent_jobs_do_not_cross_pollinate() -> None:
    """Subscribers across different ``job_id``s must NOT see each
    other's messages. Guards against a regression where a shared
    queue list bug let job_a progress leak to job_b subscribers.
    """
    broadcaster = ProgressBroadcaster()

    async def run() -> None:
        broadcaster.set_loop(asyncio.get_event_loop())

        q_a = [broadcaster.subscribe("job_a") for _ in range(5)]
        q_b = [broadcaster.subscribe("job_b") for _ in range(5)]

        broadcaster.send_progress("job_a", current=1, total=1, message="A")
        broadcaster.send_completed("job_a", "A done")
        broadcaster.send_progress("job_b", current=1, total=1, message="B")
        broadcaster.send_completed("job_b", "B done")
        await asyncio.sleep(0)

        for q in q_a:
            messages: list[dict[str, Any]] = []
            while not q.empty():
                messages.append(q.get_nowait())
            for m in messages:
                assert m["job_id"] == "job_a", (
                    f"job_a subscriber received foreign job_id: {m}"
                )

        for q in q_b:
            messages = []
            while not q.empty():
                messages.append(q.get_nowait())
            for m in messages:
                assert m["job_id"] == "job_b", (
                    f"job_b subscriber received foreign job_id: {m}"
                )

    _run(run())
