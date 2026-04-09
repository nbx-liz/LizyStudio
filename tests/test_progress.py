"""Tests for WebSocket progress broadcaster."""

from __future__ import annotations

import asyncio

import pytest

from lizystudio.ws.progress import ProgressBroadcaster

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
