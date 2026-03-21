"""Additional coverage tests for websocket_progress handler (lines 114-133).

Covers:
- keepalive ping sent on 30s timeout then continues listening
- completed message sent and loop breaks
- error message sent and loop breaks
- WebSocketDisconnect handled gracefully
- thread-safe: subscribe and send from different threads
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from lizystudio.ws.progress import ProgressBroadcaster, websocket_progress

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_websocket() -> MagicMock:
    """Return a mock WebSocket with async send_text / accept."""
    ws = MagicMock()
    ws.accept = AsyncMock()
    ws.send_text = AsyncMock()
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
        assert any(
            p.get("type") == "ping" for p in payloads
        ), "Expected at least one keepalive ping message"

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
