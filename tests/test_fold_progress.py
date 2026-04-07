"""Tests for fold_results support in progress broadcasting (H-0047)."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

import pytest

from lizystudio.services.subprocess_runner import _FileBroadcaster, _forward_progress
from lizystudio.ws.progress import ProgressBroadcaster

pytestmark = pytest.mark.unit

_SAMPLE_FOLD_RESULTS: list[dict[str, Any]] = [
    {"fold": 1, "rmse": 0.12, "r2": 0.95},
    {"fold": 2, "rmse": 0.14, "r2": 0.93},
]


@pytest.fixture()
def broadcaster() -> ProgressBroadcaster:
    b = ProgressBroadcaster()
    loop = asyncio.new_event_loop()
    b.set_loop(loop)
    try:
        yield b  # type: ignore[misc]
    finally:
        loop.close()


# --- ProgressBroadcaster tests ---


def test_send_progress_with_fold_results(broadcaster: ProgressBroadcaster) -> None:
    """fold_results should be included in the message when provided."""
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_progress(
        "job_1",
        current=2,
        total=5,
        message="Fold 2",
        fold_results=_SAMPLE_FOLD_RESULTS,
    )
    loop.run_until_complete(asyncio.sleep(0.01))

    msg = q.get_nowait()
    assert msg["type"] == "progress"
    assert msg["current"] == 2
    assert msg["total"] == 5
    assert msg["fold_results"] == _SAMPLE_FOLD_RESULTS


def test_send_progress_without_fold_results(broadcaster: ProgressBroadcaster) -> None:
    """fold_results should be omitted from the message when not provided."""
    q = broadcaster.subscribe("job_1")
    loop = broadcaster._loop
    assert loop is not None

    broadcaster.send_progress(
        "job_1",
        current=1,
        total=5,
        message="Step 1",
    )
    loop.run_until_complete(asyncio.sleep(0.01))

    msg = q.get_nowait()
    assert msg["type"] == "progress"
    assert "fold_results" not in msg


# --- _FileBroadcaster tests ---


def test_file_broadcaster_with_fold_results() -> None:
    """_FileBroadcaster.send_progress should write fold_results to JSONL."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as tmp:
        path = tmp.name

    try:
        fb = _FileBroadcaster(path)
        fb.send_progress(
            "job_1",
            current=3,
            total=5,
            message="Fold 3",
            fold_results=_SAMPLE_FOLD_RESULTS,
        )

        lines = Path(path).read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["type"] == "progress"
        assert data["fold_results"] == _SAMPLE_FOLD_RESULTS
    finally:
        Path(path).unlink(missing_ok=True)


def test_file_broadcaster_without_fold_results() -> None:
    """_FileBroadcaster.send_progress should omit fold_results when None."""
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as tmp:
        path = tmp.name

    try:
        fb = _FileBroadcaster(path)
        fb.send_progress(
            "job_1",
            current=1,
            total=5,
            message="Step 1",
        )

        lines = Path(path).read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["type"] == "progress"
        assert "fold_results" not in data
    finally:
        Path(path).unlink(missing_ok=True)


# --- _forward_progress tests ---


class _FakeBroadcaster:
    """Minimal broadcaster that records send_progress calls."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    def send_progress(self, job_id: str, **kwargs: Any) -> None:
        self.calls.append({"job_id": job_id, **kwargs})

    def send_completed(self, job_id: str, message: str = "Completed.") -> None:
        pass

    def send_error(
        self, job_id: str, message: str, code: str = "BACKEND_ERROR"
    ) -> None:
        pass


def test_forward_progress_with_fold_results() -> None:
    """_forward_progress should forward fold_results from JSONL to broadcaster."""
    fake = _FakeBroadcaster()
    line = json.dumps(
        {
            "type": "progress",
            "current": 2,
            "total": 5,
            "message": "Fold 2",
            "fold_results": _SAMPLE_FOLD_RESULTS,
        }
    )

    _forward_progress(line, "job_1", fake)  # type: ignore[arg-type]

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["job_id"] == "job_1"
    assert call["current"] == 2
    assert call["fold_results"] == _SAMPLE_FOLD_RESULTS


def test_forward_progress_without_fold_results() -> None:
    """_forward_progress should not include fold_results when absent."""
    fake = _FakeBroadcaster()
    line = json.dumps(
        {
            "type": "progress",
            "current": 1,
            "total": 5,
            "message": "Step 1",
        }
    )

    _forward_progress(line, "job_1", fake)  # type: ignore[arg-type]

    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert "fold_results" not in call
