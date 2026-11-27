"""Issue #786: the child-test teardown reaps what a failed test leaves running.

``child_env_scope`` is the context manager behind the ``cenv`` fixture, so
driving its exit drives the fixture's own teardown. The child is held alive at
the file barrier; the exit must stop it and its worker thread, and must raise
when a survivor remains (the counts are never discarded).
"""

from __future__ import annotations

import subprocess
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.regression.p0119_harness import live_job_threads
from tests.regression.test_reg_0697_child_windows import (
    ChildEnv,
    child_env_scope,
)

pytestmark = pytest.mark.integration


def _start_held_child(child_env: ChildEnv) -> None:
    child_env.barrier.arm("core_entry")
    assert child_env.post("/api/workspace/tune").status_code == 200
    child_env.barrier.wait_reached("core_entry")
    assert len(child_env.children) == 1
    assert child_env.children[0].poll() is None


def test_exit_stops_a_held_child_and_its_worker(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = set(threading.enumerate())
    with child_env_scope(client, tmp_path, monkeypatch) as child_env:
        _start_held_child(child_env)
        children = list(child_env.children)
        assert live_job_threads(baseline), "the worker should be running"
    assert all(proc.poll() is not None for proc in children)
    assert live_job_threads(baseline) == []


def test_exit_raises_when_a_child_survives(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = set(threading.enumerate())
    survivors: list[subprocess.Popen[bytes]] = []
    with (
        pytest.raises(AssertionError, match="teardown left"),
        pytest.MonkeyPatch.context() as stop_off,
        child_env_scope(client, tmp_path, monkeypatch) as child_env,
    ):
        _start_held_child(child_env)
        survivors.extend(child_env.children)
        # The spy replaces ``subprocess.Popen``, so patch the live class.
        popen_cls = type(survivors[0])
        stop_off.setattr(popen_cls, "terminate", lambda self: None)
        stop_off.setattr(popen_cls, "kill", lambda self: None)
    # The patch is undone: really stop what the failed teardown left.
    for proc in survivors:
        proc.kill()
        proc.wait(10)
    for thread in live_job_threads(baseline):
        thread.join(15)
    assert live_job_threads(baseline) == []
