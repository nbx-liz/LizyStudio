"""P-0119 (Issues #697 / #613): the subprocess-mode windows, with a real child.

Acceptance items pinned here (P-0119 Acceptance Criteria):

- #697 窓1 (a) reset and (b) HTTP cancel while an unpaused tune's child is
  held in ``_child_main``'s setup;
- #697 窓2: cancel, then ``KeyboardInterrupt`` at the child's core entry;
- Race A and Race B, subprocess halves;
- 窓4: a killed child, cancel before the reconcile and inside it.

Each test launches a real ``python -m lizystudio.services.subprocess_runner``
child on a 60-row CSV with the real lizyml backend. The child is held with
the test-only file barrier (``services/_child_barrier.py``), the parent with
event gates; every wait is bounded by a timeout.
"""

from __future__ import annotations

import contextlib
import subprocess
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lizystudio.api import workspace as ws_api
from lizystudio.services import subprocess_runner, training
from lizystudio.services._child_barrier import ENV_VAR
from tests.regression.p0119_harness import (
    CHILD_WAIT,
    Call,
    Gate,
    Reaper,
    Recorder,
    app_parts,
    join_worker,
    metric,
    seed_workspace,
)

pytestmark = pytest.mark.integration

_POINTS = ("setup", "core_entry")


class ChildBarrier:
    """The test side of the child's file barrier (one directory per phase)."""

    def __init__(self, root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self._root = root
        self._monkeypatch = monkeypatch
        self._n = 0
        self.dir = root

    def arm(self, hold: str) -> None:
        """Point the next child at a fresh barrier directory that holds it at
        *hold* only; every other point is released in advance."""
        self._n += 1
        self.dir = self._root / f"phase{self._n}"
        self.dir.mkdir(parents=True)
        for point in _POINTS:
            if point != hold:
                self.release(point)
        self._monkeypatch.setenv(ENV_VAR, str(self.dir))

    def disarm(self) -> None:
        self._monkeypatch.delenv(ENV_VAR, raising=False)

    def wait_reached(self, point: str) -> None:
        deadline = time.monotonic() + CHILD_WAIT
        while not (self.dir / f"{point}.reached").exists():
            assert time.monotonic() < deadline, f"child never reached {point}"
            time.sleep(0.02)

    def release(self, point: str) -> None:
        (self.dir / f"{point}.release").touch()


class ChildEnv:
    """An app in subprocess mode that launches real children."""

    def __init__(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
        )
        self.client = client
        self.ws, self.store, self.broadcaster = app_parts(client)
        self.rec = Recorder()
        self.rec.install(monkeypatch, self.broadcaster, self.store._slot)
        self.barrier = ChildBarrier(tmp_path / "barrier", monkeypatch)
        self.children: list[subprocess.Popen[bytes]] = []
        self._spy_popen(monkeypatch)
        self.tmp_path = tmp_path
        self.seed()

    def seed(self) -> None:
        seed_workspace(self.client, self.tmp_path)
        r = self.client.put(
            "/api/workspace/config/tuning-overrides", json={"n_trials": 2}
        )
        assert r.status_code == 200, r.text

    def _spy_popen(self, monkeypatch: pytest.MonkeyPatch) -> None:
        original = subprocess.Popen

        def popen(*args: Any, **kwargs: Any) -> subprocess.Popen[bytes]:
            proc = original(*args, **kwargs)
            if "lizystudio.services.subprocess_runner" in str(args[0]):
                self.children.append(proc)
            return proc

        monkeypatch.setattr(subprocess_runner.subprocess, "Popen", popen)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self.client.post(url, **kwargs)

    def gate(self) -> Gate:
        """A gate that bounds a real child's spawn, import and run."""
        return Gate(timeout=CHILD_WAIT)

    def join(self) -> None:
        join_worker(self.client, CHILD_WAIT)

    def status(self, job_id: str) -> str:
        job = self.store.get(job_id)
        assert job is not None
        return job.status

    def start_paused_tune(self) -> str:
        """Run a real tune child and pause it at its first callback."""
        self.barrier.arm("core_entry")
        r = self.post("/api/workspace/tune")
        assert r.status_code == 200, r.text
        job_id: str = r.json()["job_id"]
        self.barrier.wait_reached("core_entry")
        assert self.post(f"/api/jobs/{job_id}/pause").status_code == 200
        self.barrier.release("core_entry")
        self.join()
        assert self.status(job_id) == "paused"
        assert self.store.active_job_id == job_id
        return job_id


@contextlib.contextmanager
def child_env_scope(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[ChildEnv]:
    """A :class:`ChildEnv` whose exit, on any path, reaps its gates, workers
    and children and raises if one survives (#786)."""
    reaper = Reaper()
    child_env = ChildEnv(client, tmp_path, monkeypatch)
    try:
        yield child_env
    finally:
        reaper.close(child_env.children)


@pytest.fixture()
def cenv(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[ChildEnv]:
    with child_env_scope(client, tmp_path, monkeypatch) as child_env:
        yield child_env


def test_697_window1a_reset_during_child_setup_cancels_without_force_release(
    cenv: ChildEnv,
) -> None:
    """#697 窓1 (a): reset while the unpaused child is in setup. The job ends
    ``cancelled``, the slot is released without force-release (reset returns
    within its 12 s wait) and the cancelled metric is counted once."""
    job_id = cenv.start_paused_tune()
    before = metric(cenv.client, "tune", "cancelled")
    cenv.barrier.arm("setup")
    assert cenv.post(f"/api/jobs/{job_id}/unpause").status_code == 200
    cenv.barrier.wait_reached("setup")
    started = time.monotonic()
    assert cenv.post("/api/workspace/reset").status_code == 200
    elapsed = time.monotonic() - started
    cenv.barrier.release("setup")
    cenv.join()
    assert elapsed < ws_api._RESET_WAIT_TIMEOUT
    assert cenv.status(job_id) == "cancelled"
    assert cenv.store.active_job_id is None
    assert metric(cenv.client, "tune", "cancelled") - before == 1


def test_697_window1b_cancel_during_child_setup_ends_cancelled(
    cenv: ChildEnv,
) -> None:
    """#697 窓1 (b): an HTTP cancel while the unpaused child is in setup sets
    CANCEL, the child is stopped, and the job ends ``cancelled`` once."""
    job_id = cenv.start_paused_tune()
    before = metric(cenv.client, "tune", "cancelled")
    frames_before = len(cenv.rec.terminal_frames(job_id))
    cenv.barrier.arm("setup")
    assert cenv.post(f"/api/jobs/{job_id}/unpause").status_code == 200
    cenv.barrier.wait_reached("setup")
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    cenv.barrier.release("setup")
    cenv.join()
    assert cenv.status(job_id) == "cancelled"
    assert cenv.store.active_job_id is None
    assert cenv.rec.terminal_frames(job_id)[frames_before:] == ["error:JOB_CANCELLED"]
    assert metric(cenv.client, "tune", "cancelled") - before == 1
    assert metric(cenv.client, "tune", "completed") == 0


def test_697_window2_interrupt_at_child_core_entry_ends_cancelled(
    cenv: ChildEnv,
) -> None:
    """#697 窓2: cancel is sent while the unpaused child waits at its core
    entry, and the parent's SIGTERM turns into ``KeyboardInterrupt`` there,
    before any outcome is written. The job ends ``cancelled``, metric once."""
    job_id = cenv.start_paused_tune()
    before = metric(cenv.client, "tune", "cancelled")
    cenv.barrier.arm("core_entry")
    assert cenv.post(f"/api/jobs/{job_id}/unpause").status_code == 200
    cenv.barrier.wait_reached("core_entry")
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    cenv.join()
    cenv.barrier.release("core_entry")
    assert cenv.children[-1].returncode != 0
    assert cenv.status(job_id) == "cancelled"
    assert cenv.store.active_job_id is None
    assert metric(cenv.client, "tune", "cancelled") - before == 1


def test_race_a_subprocess_second_unpause_is_refused(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Race A (subprocess): the second unpause is 400 while the first waits
    in its join; exactly one child is spawned for the resume."""
    job_id = cenv.start_paused_tune()
    cenv.barrier.disarm()
    spawned = len(cenv.children)
    gate = cenv.gate()
    monkeypatch.setattr(
        training, "_join_previous_thread", gate.wrap(training._join_previous_thread)
    )
    first = Call(lambda: cenv.post(f"/api/jobs/{job_id}/unpause"))
    gate.wait_reached()
    second = cenv.post(f"/api/jobs/{job_id}/unpause")
    assert second.status_code == 400, second.text
    gate.release.set()
    assert first.result(CHILD_WAIT).status_code == 200
    cenv.join()
    assert len(cenv.children) - spawned == 1
    assert cenv.status(job_id) == "completed"


def test_race_b_subprocess_cancel_after_admission(cenv: ChildEnv) -> None:
    """Race B (subprocess): the admitted child is held before its first
    commit and cancelled; the job ends ``cancelled`` with one terminal frame,
    one metric and the slot released."""
    before = metric(cenv.client, "tune", "cancelled")
    cenv.barrier.arm("core_entry")
    job_id = cenv.post("/api/workspace/tune").json()["job_id"]
    cenv.barrier.wait_reached("core_entry")
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    cenv.barrier.release("core_entry")
    cenv.join()
    assert cenv.status(job_id) == "cancelled"
    assert cenv.rec.terminal_frames(job_id) == ["error:JOB_CANCELLED"]
    assert metric(cenv.client, "tune", "cancelled") - before == 1
    assert cenv.store.active_job_id is None


def test_race_b_subprocess_cancel_before_admission_spawns_nothing(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Race B (subprocess), reverse order: cancel of the reserved job is 200,
    its launch is refused and no child is spawned."""
    gate = cenv.gate()
    monkeypatch.setattr(ws_api, "start_tune_async", gate.wrap(ws_api.start_tune_async))
    tune = Call(lambda: cenv.post("/api/workspace/tune"))
    gate.wait_reached()
    job_id = cenv.store.active_job_id
    assert job_id is not None
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    gate.release.set()
    assert tune.result(CHILD_WAIT).status_code == 409
    assert cenv.children == []
    assert cenv.status(job_id) == "cancelled"


def _killed_child_job(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> tuple[str, Gate]:
    """A tune whose child is SIGKILLed in setup, the parent held at reconcile."""
    gate = cenv.gate()
    monkeypatch.setattr(
        subprocess_runner,
        "_reconcile_subprocess_result",
        gate.wrap(subprocess_runner._reconcile_subprocess_result),
    )
    cenv.barrier.arm("setup")
    job_id: str = cenv.post("/api/workspace/tune").json()["job_id"]
    cenv.barrier.wait_reached("setup")
    cenv.children[-1].kill()
    gate.wait_reached()
    return job_id, gate


def test_window4_cancel_before_the_reconcile_ends_cancelled(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """窓4 (order 1): the child died; a cancel sent before the parent's
    reconcile is 200 and the job ends ``cancelled`` with one terminal frame."""
    job_id, gate = _killed_child_job(cenv, monkeypatch)
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    gate.release.set()
    cenv.join()
    assert cenv.status(job_id) == "cancelled"
    assert cenv.rec.writes_of(job_id, "cancelled") == 1
    assert cenv.rec.terminal_frames(job_id) == ["error:JOB_CANCELLED"]


def test_window4_cancel_inside_the_reconcile_waits_and_is_400(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """窓4 (order 2): the reconcile's commit is held inside the lifecycle lock;
    a cancel waits for it, then is 400 against the ``failed`` terminal. The
    seam is new in P-0119, so this test has no RED on develop."""
    from lizystudio.services._job_lifecycle import JobLifecycle

    lock_gate = cenv.gate()
    monkeypatch.setattr(
        JobLifecycle, "_commit_locked", lock_gate.wrap(JobLifecycle._commit_locked)
    )
    cenv.barrier.arm("setup")
    job_id: str = cenv.post("/api/workspace/tune").json()["job_id"]
    cenv.barrier.wait_reached("setup")
    cenv.children[-1].kill()
    lock_gate.wait_reached()
    cancel = Call(lambda: cenv.post(f"/api/jobs/{job_id}/cancel"))
    assert cancel.finished_within(0.3) is False, "cancel did not wait for the lock"
    lock_gate.release.set()
    assert cancel.result(CHILD_WAIT).status_code == 400
    cenv.join()
    assert cenv.status(job_id) == "failed"
    assert cenv.rec.writes_of(job_id, "failed") == 1
    assert cenv.rec.terminal_frames(job_id) == ["error:default"]
