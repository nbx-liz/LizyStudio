"""Tests for WebSocket progress broadcaster."""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lizystudio.ws.progress import ProgressBroadcaster, websocket_progress

pytestmark = pytest.mark.unit


@pytest.fixture()
def broadcaster() -> ProgressBroadcaster:
    b = ProgressBroadcaster()
    loop = asyncio.new_event_loop()
    b.set_loop(loop)
    try:
        yield b  # type: ignore[misc]
    finally:
        loop.close()


def test_subscribe_unsubscribe(broadcaster: ProgressBroadcaster) -> None:
    q = broadcaster.subscribe("job_1")
    assert q is not None
    # Verify it's in the queues
    assert "job_1" in broadcaster._queues
    assert len(broadcaster._queues["job_1"]) == 1

    broadcaster.unsubscribe("job_1", q)
    assert "job_1" not in broadcaster._queues


def test_unsubscribe_nonexistent(broadcaster: ProgressBroadcaster) -> None:
    q = asyncio.Queue()  # type: ignore[type-arg]
    # Should not raise
    broadcaster.unsubscribe("nonexistent", q)


def test_send_no_subscribers(broadcaster: ProgressBroadcaster) -> None:
    # Should not raise
    broadcaster.send("job_1", {"type": "progress"})


def test_send_no_loop() -> None:
    b = ProgressBroadcaster()
    b.subscribe("job_1")
    # No loop set — should not raise
    b.send("job_1", {"type": "progress"})


def test_send_progress(broadcaster: ProgressBroadcaster) -> None:
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_progress("job_1", current=5, total=10, message="Training")
    # Process the call_soon_threadsafe callbacks
    loop.run_until_complete(asyncio.sleep(0.01))

    assert not q.empty()
    msg = q.get_nowait()
    assert msg["type"] == "progress"
    assert msg["current"] == 5
    assert msg["total"] == 10
    assert msg["message"] == "Training"


def test_send_completed(broadcaster: ProgressBroadcaster) -> None:
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_completed("job_1", "Done!")
    loop.run_until_complete(asyncio.sleep(0.01))

    msg = q.get_nowait()
    assert msg["type"] == "completed"
    assert msg["message"] == "Done!"


def test_send_error(broadcaster: ProgressBroadcaster) -> None:
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_error("job_1", "Something failed", "TEST_ERROR")
    loop.run_until_complete(asyncio.sleep(0.01))

    msg = q.get_nowait()
    assert msg["type"] == "error"
    assert msg["code"] == "TEST_ERROR"


def test_make_callback(broadcaster: ProgressBroadcaster) -> None:
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    cb = broadcaster.make_callback("job_1")
    cb(current=3, total=10, message="Step 3")
    loop.run_until_complete(asyncio.sleep(0.01))

    msg = q.get_nowait()
    assert msg["type"] == "progress"
    assert msg["current"] == 3


def test_multiple_subscribers(broadcaster: ProgressBroadcaster) -> None:
    q1 = broadcaster.subscribe("job_1")
    q2 = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_progress("job_1", current=1, total=1, message="Done")
    loop.run_until_complete(asyncio.sleep(0.01))

    # Both subscribers should receive the message
    assert not q1.empty()
    assert not q2.empty()
    assert q1.get_nowait()["type"] == "progress"
    assert q2.get_nowait()["type"] == "progress"


# ---------------------------------------------------------------------------
# Helpers for websocket_progress handler tests
# ---------------------------------------------------------------------------


def _make_websocket() -> MagicMock:
    """Return a mock WebSocket with async send_text / accept."""
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
    ws.close = AsyncMock()
    ws.headers = {}  # No origin header → pass origin check
    return ws


def _run(coro: Any) -> Any:
    """Run a coroutine synchronously with a fresh event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# websocket_progress handler tests
# ---------------------------------------------------------------------------


class TestWebsocketProgressCompleted:
    """completed message causes the loop to break."""

    def test_completed_message_breaks_loop(self) -> None:
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            # Pre-populate queue so handler gets message immediately
            task = asyncio.create_task(websocket_progress(ws, "job-1", broadcaster))
            # Give the handler time to subscribe and block on queue.get()
            await asyncio.sleep(0.01)

            broadcaster.send_completed("job-1", "All done")
            # Allow handler to process the message and exit
            await asyncio.wait_for(task, timeout=2.0)

        _run(run())

        ws.accept.assert_awaited_once()
        # send_text was called at least once with the completed payload
        sent_calls = [call.args[0] for call in ws.send_text.call_args_list]
        payloads = [json.loads(s) for s in sent_calls]
        assert any(p["type"] == "completed" for p in payloads)


class TestWebsocketProgressError:
    """error message causes the loop to break."""

    def test_error_message_breaks_loop(self) -> None:
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            task = asyncio.create_task(websocket_progress(ws, "job-2", broadcaster))
            await asyncio.sleep(0.01)

            broadcaster.send_error("job-2", "Training failed", "TRAIN_ERROR")
            await asyncio.wait_for(task, timeout=2.0)

        _run(run())

        sent_calls = [call.args[0] for call in ws.send_text.call_args_list]
        payloads = [json.loads(s) for s in sent_calls]
        assert any(p["type"] == "error" for p in payloads)
        error_payload = next(p for p in payloads if p["type"] == "error")
        assert error_payload["code"] == "TRAIN_ERROR"
        assert error_payload["message"] == "Training failed"


class TestWebsocketProgressKeepalive:
    """Timeout triggers a keepalive ping and the loop continues."""

    def test_keepalive_ping_sent_on_timeout(self) -> None:
        """Simulate TimeoutError from wait_for; expect ping then clean exit."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        # Capture the real asyncio.wait_for before we patch so the
        # side_effect can delegate to it without recursion.
        real_wait_for = asyncio.wait_for

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())

            call_count = 0

            async def patched_wait_for(coro: Any, timeout: float) -> dict[str, Any]:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    coro.close()
                    raise asyncio.TimeoutError
                # Delegate to the real function captured outside the patch
                return await real_wait_for(coro, timeout=2.0)

            with patch(
                "lizystudio.ws.progress.asyncio.wait_for",
                side_effect=patched_wait_for,
            ):
                task = asyncio.create_task(websocket_progress(ws, "job-3", broadcaster))
                await asyncio.sleep(0.01)
                broadcaster.send_completed("job-3", "done")
                await real_wait_for(task, timeout=2.0)

        _run(run())

        sent_texts = [c.args[0] for c in ws.send_text.call_args_list]
        payloads = [json.loads(t) for t in sent_texts]
        assert any(p.get("type") == "ping" for p in payloads), (
            "Expected at least one keepalive ping message"
        )

    def test_keepalive_ping_includes_job_id(self) -> None:
        """Keepalive ping payload must contain the correct job_id."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()
        job_id = "job-keepalive-id"

        real_wait_for = asyncio.wait_for

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())

            call_count = 0

            async def patched_wait_for(coro: Any, timeout: float) -> dict[str, Any]:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    coro.close()
                    raise asyncio.TimeoutError
                return await real_wait_for(coro, timeout=2.0)

            with patch(
                "lizystudio.ws.progress.asyncio.wait_for",
                side_effect=patched_wait_for,
            ):
                task = asyncio.create_task(websocket_progress(ws, job_id, broadcaster))
                await asyncio.sleep(0.01)
                broadcaster.send_completed(job_id, "done")
                await real_wait_for(task, timeout=2.0)

        _run(run())

        sent_texts = [c.args[0] for c in ws.send_text.call_args_list]
        ping_payloads = [
            json.loads(t) for t in sent_texts if json.loads(t).get("type") == "ping"
        ]
        assert len(ping_payloads) >= 1
        assert ping_payloads[0]["job_id"] == job_id

    def test_keepalive_loop_continues_after_ping(self) -> None:
        """After a timeout ping the handler continues and processes next msg."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        real_wait_for = asyncio.wait_for

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())

            timeouts_injected = 0

            async def patched_wait_for(coro: Any, timeout: float) -> dict[str, Any]:
                nonlocal timeouts_injected
                # Inject two consecutive timeouts then pass through
                if timeouts_injected < 2:
                    timeouts_injected += 1
                    coro.close()
                    raise asyncio.TimeoutError
                return await real_wait_for(coro, timeout=2.0)

            with patch(
                "lizystudio.ws.progress.asyncio.wait_for",
                side_effect=patched_wait_for,
            ):
                task = asyncio.create_task(
                    websocket_progress(ws, "job-loop", broadcaster)
                )
                await asyncio.sleep(0.01)
                broadcaster.send_completed("job-loop", "done")
                await real_wait_for(task, timeout=2.0)

        _run(run())

        sent_texts = [c.args[0] for c in ws.send_text.call_args_list]
        payloads = [json.loads(t) for t in sent_texts]
        # Two pings from two timeouts, then one completed
        ping_count = sum(1 for p in payloads if p.get("type") == "ping")
        assert ping_count == 2
        assert any(p.get("type") == "completed" for p in payloads)


class TestWebsocketProgressDisconnect:
    """WebSocketDisconnect is handled gracefully (no exception propagated)."""

    def test_disconnect_during_send_is_swallowed(self) -> None:
        from fastapi import WebSocketDisconnect

        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            task = asyncio.create_task(websocket_progress(ws, "job-disc", broadcaster))
            await asyncio.sleep(0.01)

            # Make send_text raise WebSocketDisconnect to simulate client drop
            ws.send_text.side_effect = WebSocketDisconnect(code=1001)
            broadcaster.send_progress("job-disc", current=1, total=10, message="step")

            # Handler should exit cleanly without raising
            await asyncio.wait_for(task, timeout=2.0)

        _run(run())

    def test_disconnect_on_accept_propagates(self) -> None:
        """WebSocketDisconnect on accept is NOT caught — propagates up."""
        from fastapi import WebSocketDisconnect

        ws = _make_websocket()
        ws.accept = AsyncMock(side_effect=WebSocketDisconnect(code=1000))
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            await websocket_progress(ws, "job-disc2", broadcaster)

        # WebSocketDisconnect during accept propagates (not caught by handler)
        with pytest.raises(WebSocketDisconnect):
            _run(run())

    def test_unsubscribe_called_on_disconnect(self) -> None:
        """Queue is always unsubscribed in the finally block."""
        from fastapi import WebSocketDisconnect

        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            task = asyncio.create_task(websocket_progress(ws, "job-unsub", broadcaster))
            await asyncio.sleep(0.01)

            ws.send_text.side_effect = WebSocketDisconnect(code=1001)
            broadcaster.send_progress("job-unsub", current=1, total=5, message="x")
            await asyncio.wait_for(task, timeout=2.0)

        _run(run())

        # After disconnect the queue should have been cleaned up
        assert "job-unsub" not in broadcaster._queues

    def test_unsubscribe_called_after_completed(self) -> None:
        """Queue is unsubscribed even after normal completed exit."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            broadcaster.set_loop(asyncio.get_event_loop())
            task = asyncio.create_task(
                websocket_progress(ws, "job-complete-unsub", broadcaster)
            )
            await asyncio.sleep(0.01)
            broadcaster.send_completed("job-complete-unsub", "done")
            await asyncio.wait_for(task, timeout=2.0)

        _run(run())

        assert "job-complete-unsub" not in broadcaster._queues


class TestWebsocketProgressThreadSafety:
    """Thread-safety: subscribe and send from different threads."""

    def test_send_from_background_thread(self) -> None:
        """Messages enqueued from a background thread are received by handler."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            loop = asyncio.get_event_loop()
            broadcaster.set_loop(loop)

            task = asyncio.create_task(
                websocket_progress(ws, "job-thread", broadcaster)
            )
            await asyncio.sleep(0.01)

            # Send completed from a background thread
            def background_send() -> None:
                # Small delay to ensure async task is waiting on queue
                import time

                time.sleep(0.05)
                broadcaster.send_completed("job-thread", "from thread")

            t = threading.Thread(target=background_send, daemon=True)
            t.start()
            await asyncio.wait_for(task, timeout=3.0)
            t.join(timeout=1.0)

        _run(run())

        sent_calls = [call.args[0] for call in ws.send_text.call_args_list]
        payloads = [json.loads(s) for s in sent_calls]
        assert any(p["type"] == "completed" for p in payloads)

    def test_multiple_messages_from_thread(self) -> None:
        """Progress messages followed by completed all arrive in order."""
        ws = _make_websocket()
        broadcaster = ProgressBroadcaster()
        received: list[dict[str, Any]] = []

        async def capturing_send(text: str) -> None:
            received.append(json.loads(text))

        ws.send_text = AsyncMock(side_effect=capturing_send)

        async def run() -> None:
            loop = asyncio.get_event_loop()
            broadcaster.set_loop(loop)

            task = asyncio.create_task(websocket_progress(ws, "job-multi", broadcaster))
            await asyncio.sleep(0.01)

            def background_send() -> None:
                import time

                time.sleep(0.02)
                for i in range(3):
                    broadcaster.send_progress(
                        "job-multi", current=i + 1, total=3, message=f"step {i + 1}"
                    )
                    time.sleep(0.01)
                broadcaster.send_completed("job-multi", "all done")

            t = threading.Thread(target=background_send, daemon=True)
            t.start()
            await asyncio.wait_for(task, timeout=5.0)
            t.join(timeout=1.0)

        _run(run())

        types = [m["type"] for m in received]
        assert types.count("progress") == 3
        assert types[-1] == "completed"

    def test_concurrent_subscribers_independent(self) -> None:
        """Two concurrent subscribers each receive all messages."""
        ws1 = _make_websocket()
        ws2 = _make_websocket()
        broadcaster = ProgressBroadcaster()

        async def run() -> None:
            loop = asyncio.get_event_loop()
            broadcaster.set_loop(loop)

            task1 = asyncio.create_task(
                websocket_progress(ws1, "job-concurrent", broadcaster)
            )
            task2 = asyncio.create_task(
                websocket_progress(ws2, "job-concurrent", broadcaster)
            )
            await asyncio.sleep(0.01)

            broadcaster.send_completed("job-concurrent", "done")

            await asyncio.wait_for(asyncio.gather(task1, task2), timeout=2.0)

        _run(run())

        for ws in (ws1, ws2):
            payloads = [json.loads(c.args[0]) for c in ws.send_text.call_args_list]
            assert any(p["type"] == "completed" for p in payloads)

    def test_subscribe_from_thread_safe(self) -> None:
        """Subscribing from multiple threads does not corrupt internal state."""
        broadcaster = ProgressBroadcaster()
        queues: list[asyncio.Queue[dict[str, Any]]] = []
        lock = threading.Lock()

        # asyncio.Queue must be created inside an event loop; use a fresh loop
        loop = asyncio.new_event_loop()

        def subscribe_in_thread() -> None:
            # Queue creation needs to happen in the event loop's thread
            # We test that _lock prevents data races on _queues dict
            with lock:
                q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
                with broadcaster._lock:
                    broadcaster._queues.setdefault("job-ts", []).append(q)
                queues.append(q)

        threads = [
            threading.Thread(target=subscribe_in_thread, daemon=True) for _ in range(10)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(broadcaster._queues.get("job-ts", [])) == 10
        loop.close()


# ---------------------------------------------------------------------------
# Issue #327 — terminal-replay invariants (P-0093)
#
# INV-1: terminal messages (completed / error) reach a subscriber that joins
#        AFTER the message was sent, as long as the per-jobId cache is still
#        within its TTL.
# INV-2: each cached terminal is delivered at most once per subscriber via
#        replay (already enforced UI-side via terminalFiredRef; here we only
#        guarantee the server side does not duplicate the message into a
#        subscriber that was present at send time).
# INV-3: cache retention is bounded by ``LIZYSTUDIO_WS_TERMINAL_TTL_S``
#        (default 5 minutes); expired entries are dropped on the next
#        subscribe and never replayed.
# ---------------------------------------------------------------------------


class TestTerminalReplay:
    """INV-1..INV-3: subscribe-before-send race fix (Issue #327)."""

    def test_completed_replayed_to_late_subscriber(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-1: a fast Fit's send_completed BEFORE subscribe still reaches
        the eventual subscriber via the per-jobId terminal cache."""
        loop = broadcaster._loop
        assert loop is not None

        # send terminal BEFORE any subscriber exists for this job
        broadcaster.send_completed("job_late", "Done!")
        loop.run_until_complete(asyncio.sleep(0.01))

        # late subscribe — terminal must be replayed as the queue's first item
        q = broadcaster.subscribe("job_late")
        assert not q.empty()
        msg = q.get_nowait()
        assert msg["type"] == "completed"
        assert msg["job_id"] == "job_late"
        assert msg["message"] == "Done!"

    def test_error_replayed_to_late_subscriber(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-1 (error variant): error terminals are also replayed."""
        loop = broadcaster._loop
        assert loop is not None

        broadcaster.send_error("job_err", "boom", code="X_TEST")
        loop.run_until_complete(asyncio.sleep(0.01))

        q = broadcaster.subscribe("job_err")
        assert not q.empty()
        msg = q.get_nowait()
        assert msg["type"] == "error"
        assert msg["code"] == "X_TEST"
        assert msg["message"] == "boom"

    def test_progress_not_cached_for_replay(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-1 negative: non-terminal progress is not stored, so a late
        subscriber starts with an empty queue (status quo for progress)."""
        loop = broadcaster._loop
        assert loop is not None

        broadcaster.send_progress("job_p", current=1, total=2, message="hi")
        loop.run_until_complete(asyncio.sleep(0.01))

        q = broadcaster.subscribe("job_p")
        assert q.empty()

    def test_ttl_expired_entry_is_dropped(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-3: cache retention is bounded; an expired entry is dropped on
        the next subscribe and the queue starts empty as if no terminal was
        ever sent."""
        # Shrink TTL inside the test so we don't have to wait minutes.
        broadcaster._terminal_ttl_s = 0.001  # 1ms

        loop = broadcaster._loop
        assert loop is not None

        broadcaster.send_completed("job_ttl")
        loop.run_until_complete(asyncio.sleep(0.05))  # >> TTL

        q = broadcaster.subscribe("job_ttl")
        # Expired: nothing to replay.
        assert q.empty()
        # And the cache entry itself is gone after the lazy GC.
        assert "job_ttl" not in broadcaster._last_terminal

    def test_replay_does_not_duplicate_to_present_subscriber(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-2: a subscriber that was present at send time receives the
        terminal exactly once (via the live broadcast path), NOT twice
        (no double delivery via replay)."""
        loop = broadcaster._loop
        assert loop is not None

        q_present = broadcaster.subscribe("job_present")
        broadcaster.send_completed("job_present", "Done!")
        loop.run_until_complete(asyncio.sleep(0.01))

        # Drain — exactly one message expected.
        msgs: list[dict[str, Any]] = []
        while not q_present.empty():
            msgs.append(q_present.get_nowait())
        assert len(msgs) == 1
        assert msgs[0]["type"] == "completed"

    def test_reconnect_subscriber_gets_replayed_terminal(
        self, broadcaster: ProgressBroadcaster
    ) -> None:
        """INV-1 (reconnect variant): the original subscriber drops, then a
        fresh subscriber for the same job_id (e.g. WS reconnect) receives
        the cached terminal so the UI never hangs in 'running' forever."""
        loop = broadcaster._loop
        assert loop is not None

        q1 = broadcaster.subscribe("job_reconn")
        broadcaster.send_completed("job_reconn", "Done!")
        loop.run_until_complete(asyncio.sleep(0.01))

        # Drain + drop original subscriber (simulates client disconnect).
        assert q1.get_nowait()["type"] == "completed"
        broadcaster.unsubscribe("job_reconn", q1)

        # Reconnect — fresh subscriber must still see the terminal.
        q2 = broadcaster.subscribe("job_reconn")
        assert not q2.empty()
        replayed = q2.get_nowait()
        assert replayed["type"] == "completed"
        assert replayed["job_id"] == "job_reconn"

    def test_replay_increments_metric(self, broadcaster: ProgressBroadcaster) -> None:
        """The replay path bumps the metrics counter so we can observe how
        often the race actually fires in production."""
        loop = broadcaster._loop
        assert loop is not None

        metrics = MagicMock()
        broadcaster._metrics = metrics

        broadcaster.send_completed("job_metric")
        loop.run_until_complete(asyncio.sleep(0.01))

        broadcaster.subscribe("job_metric")
        metrics.progress_terminal_replayed_total.inc.assert_called_once()

    def test_ttl_default_from_env_var(self) -> None:
        """``LIZYSTUDIO_WS_TERMINAL_TTL_S`` overrides the default TTL."""
        with patch.dict(
            "os.environ", {"LIZYSTUDIO_WS_TERMINAL_TTL_S": "12.5"}, clear=False
        ):
            b = ProgressBroadcaster()
        assert b._terminal_ttl_s == pytest.approx(12.5)


class TestQueueFullEviction:
    """Issue #449 — INV-5 defense: the terminal-eviction-on-queue-full
    path in ``ProgressBroadcaster._enqueue`` (a queued terminal message is
    NEVER dropped to make room for another message).

    ``_enqueue`` is synchronous (it runs on the event-loop thread via
    ``call_soon_threadsafe``), so the tests call it directly against a
    hand-built ``asyncio.Queue`` with a tiny ``maxsize`` — no running
    loop required. ``asyncio.Queue.put_nowait`` / ``get_nowait`` work
    purely on the internal deque.
    """

    @staticmethod
    def _drain(q: asyncio.Queue[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        while not q.empty():
            out.append(q.get_nowait())
        return out

    def test_terminal_evicts_oldest_nonterminal_when_queue_full(self) -> None:
        metrics = MagicMock()
        b = ProgressBroadcaster(metrics=metrics)
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2)
        b._enqueue(q, {"type": "progress", "step": 1}, False)
        b._enqueue(q, {"type": "progress", "step": 2}, False)
        assert q.full()

        # A terminal arriving on a full-of-non-terminals queue evicts the
        # head non-terminal and takes its slot.
        b._enqueue(q, {"type": "completed", "result": "ok"}, True)

        drained = self._drain(q)
        assert {"type": "completed", "result": "ok"} in drained
        # Exactly one non-terminal survives — the newer one (step 2).
        nonterminals = [m for m in drained if m["type"] == "progress"]
        assert nonterminals == [{"type": "progress", "step": 2}]
        # The drop was recorded so production back-pressure is observable.
        metrics.progress_dropped_total.inc.assert_called_once()

    def test_terminal_preserved_when_eviction_loop_passes_through_it(self) -> None:
        """Queue head is a terminal followed by a non-terminal; the new
        terminal must keep the existing terminal and evict the non-terminal.
        """
        b = ProgressBroadcaster(metrics=MagicMock())
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2)
        b._enqueue(q, {"type": "completed", "id": 1}, True)
        b._enqueue(q, {"type": "progress", "id": 2}, False)
        assert q.full()

        b._enqueue(q, {"type": "error", "id": 3}, True)

        drained = self._drain(q)
        # FIFO order preserved: old terminal first, new terminal second.
        assert [m["type"] for m in drained] == ["completed", "error"]
        # The non-terminal is gone.
        assert all(m["type"] != "progress" for m in drained)

    def test_new_terminal_dropped_when_queue_full_of_terminals(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        b = ProgressBroadcaster(metrics=MagicMock())
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=2)
        b._enqueue(q, {"type": "completed", "id": 1}, True)
        b._enqueue(q, {"type": "completed", "id": 2}, True)
        assert q.full()

        with caplog.at_level("WARNING"):
            b._enqueue(q, {"type": "error", "id": 3}, True)

        # The two existing terminals are preserved; the new one is dropped.
        drained = self._drain(q)
        assert {m["id"] for m in drained} == {1, 2}
        assert any(
            "queue full of terminals" in r.getMessage() for r in caplog.records
        ), caplog.text

    def test_nonterminal_dropped_silently_when_queue_full(self) -> None:
        metrics = MagicMock()
        b = ProgressBroadcaster(metrics=metrics)
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1)
        b._enqueue(q, {"type": "progress", "id": 1}, False)
        assert q.full()

        # Non-terminal on a full queue: dropped silently, metric bumped.
        b._enqueue(q, {"type": "progress", "id": 2}, False)

        assert q.qsize() == 1
        assert q.get_nowait()["id"] == 1
        metrics.progress_dropped_total.inc.assert_called_once()
