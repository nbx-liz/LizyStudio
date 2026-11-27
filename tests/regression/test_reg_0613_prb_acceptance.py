"""P-0119 acceptance items closed by the PR-B fold (plan §3.3).

- 通知: the child's ``completed`` outcome is written, a cancel lands before
  the parent's commit; the WebSocket sees exactly one terminal frame,
  ``JOB_CANCELLED``, and no ``completed`` (real child).
- 古い outcome: an outcome of another run generation is discarded and
  logged; the job ends ``cancelled`` with CANCEL and ``failed`` without.
- 窓3 (subprocess half): a run force-released while its child still runs;
  another /tune takes the slot; the old child's later outcome is dropped.
- fence を外す確認: with the token, generation and outcome fences disabled,
  the fence tests fail (an executable check, not a manual step).
- status の書き手の census: no ``meta.json`` save changes a stored status
  outside the primitive's one status writer, in thread and subprocess mode.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services import subprocess_runner
from lizystudio.services._job_lifecycle import JobLifecycle
from lizystudio.services._job_lifecycle_types import Outcome
from lizystudio.services._job_outcome_file import write_outcome
from lizystudio.services.jobs import JobStore
from tests.regression import test_reg_0613_restart_and_fence as fence
from tests.regression.p0119_harness import (
    CHILD_WAIT,
    Env,
    Gate,
    env,
    join_worker,
    metric,
    short_reset_wait,
)
from tests.regression.test_reg_0697_child_windows import ChildEnv, cenv

__all__ = ["cenv", "env"]

_REF = DataRef(
    source_type="path",
    path="/tmp/x.csv",
    filename="x.csv",
    fingerprint="f",
    shape=(1, 1),
)


def _admitted(store: JobStore) -> tuple[Any, Any]:
    reservation = store.create_and_reserve(
        backend_name="lizyml", config={}, data_ref=_REF, job_type="tune"
    )
    assert reservation is not None
    job, gen = reservation
    token = store.admit(
        job.job_id, expect="pending", reset_gen=gen, slot_rule="reserved"
    )
    return job, token


# --- 通知 -----------------------------------------------------------------


def test_cancel_after_the_child_outcome_emits_one_cancelled_frame(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """通知: the child finished and wrote ``completed``; the cancel lands
    before the parent's commit. One terminal frame, ``JOB_CANCELLED``."""
    gate = cenv.gate()
    monkeypatch.setattr(
        subprocess_runner,
        "_reconcile_subprocess_result",
        gate.wrap(subprocess_runner._reconcile_subprocess_result),
    )
    job_id = cenv.post("/api/workspace/tune").json()["job_id"]
    gate.wait_reached()
    assert cenv.store.path_for(job_id, "outcome").exists()
    assert cenv.post(f"/api/jobs/{job_id}/cancel").status_code == 200
    gate.release.set()
    cenv.join()
    assert cenv.rec.terminal_frames(job_id) == ["error:JOB_CANCELLED"]
    assert cenv.status(job_id) == "cancelled"
    assert metric(cenv.client, "tune", "cancelled") == 1
    assert metric(cenv.client, "tune", "completed") == 0
    assert cenv.rec.census_violations == []


# --- 古い outcome ---------------------------------------------------------


def _reconcile_with_outcome(
    store: JobStore, *, stale: bool, cancel: bool
) -> tuple[Any, Any]:
    job, token = _admitted(store)
    if cancel:
        assert store.cancel(job.job_id).accepted is True
    write_outcome(
        store.path_for(job.job_id, "outcome"),
        run_gen=token.run_gen - 1 if stale else token.run_gen,
        outcome=Outcome(status="completed"),
        fit_result=None,
        tune_result=None,
        model_path=None,
    )
    result = subprocess_runner._reconcile_subprocess_result(
        job=job, job_store=store, broadcaster=None, returncode=-9, token=token
    )
    return job, result


@pytest.mark.parametrize(
    ("cancel", "expected"), [(True, "cancelled"), (False, "failed")]
)
def test_a_stale_outcome_is_discarded_and_logged(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, cancel: bool, expected: str
) -> None:
    """古い outcome: an outcome of another run generation is not committed;
    the job ends as a dead child does, by CANCEL, and the file is removed."""
    store = JobStore(tmp_path / "jobs")
    with caplog.at_level(logging.WARNING):
        job, result = _reconcile_with_outcome(store, stale=True, cancel=cancel)
    assert result.status == expected
    assert sum("stale_outcome_dropped" in r.getMessage() for r in caplog.records) == 1
    assert not store.path_for(job.job_id, "outcome").exists()


def test_the_live_runs_outcome_is_committed(tmp_path: Path) -> None:
    """The control case: the same outcome with the live generation commits."""
    store = JobStore(tmp_path / "jobs")
    _job, result = _reconcile_with_outcome(store, stale=False, cancel=False)
    assert result.status == "completed"


# --- 窓3 (subprocess half) ------------------------------------------------


class _HeldChildren:
    """A fake child exit per run: each holds on its own gate, then reports
    ``completed`` with its run generation (read from the child's args)."""

    def __init__(self) -> None:
        self.gates: list[Gate] = []
        self._lock = threading.Lock()

    def __call__(self, *, job: Any, job_store: Any, args_path: str, **_: Any) -> int:
        gate = Gate(timeout=CHILD_WAIT)
        with self._lock:
            self.gates.append(gate)
        gate.hold()
        write_outcome(
            job_store.path_for(job.job_id, "outcome"),
            run_gen=json.loads(Path(args_path).read_text())["run_gen"],
            outcome=Outcome(status="completed"),
            fit_result=None,
            tune_result=None,
            model_path=None,
        )
        return 0

    def gate(self, index: int) -> Gate:
        deadline = time.monotonic() + CHILD_WAIT
        while time.monotonic() < deadline:
            with self._lock:
                if len(self.gates) > index:
                    return self.gates[index]
            threading.Event().wait(0.05)
        raise AssertionError(f"child {index} never started")


def test_window3_subprocess_a_force_released_childs_outcome_is_dropped(
    env: Env, monkeypatch: pytest.MonkeyPatch
) -> None:
    """窓3 (subprocess): the old child is still running when reset
    force-releases its run and a new /tune takes the slot. Its later
    ``completed`` outcome is dropped (logged); one ``cancelled`` publication,
    frame and metric; the new job's slot and status are untouched."""
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
    )
    children = _HeldChildren()
    monkeypatch.setattr(subprocess_runner, "_supervise_child", children)
    old_id = env.post("/api/workspace/tune").json()["job_id"]
    old_gate = children.gate(0)
    old_gate.wait_reached()
    with short_reset_wait(monkeypatch, 0.3):
        env.reset()
    env.reseed()
    new_id = env.post("/api/workspace/tune").json()["job_id"]
    children.gate(1).wait_reached()
    old_gate.release.set()
    for thread in threading.enumerate():
        if thread is not env.ws.previous_job_thread() and "start_tune_async" in str(
            getattr(thread, "_target", "")
        ):
            thread.join(CHILD_WAIT)
    assert env.status(old_id) == "cancelled"
    assert env.rec.writes_of(old_id, "cancelled") == 1
    assert env.rec.writes_of(old_id, "completed") == 0
    assert env.rec.terminal_frames(old_id) == ["error:JOB_CANCELLED"]
    assert metric(env.client, "tune", "cancelled") == 1
    assert env.store.active_job_id == new_id
    assert env.status(new_id) == "running"
    children.gate(1).release.set()
    join_worker(env.client)
    assert env.status(new_id) == "completed"
    assert env.rec.census_violations == []


# --- fence を外す確認 -----------------------------------------------------


def _stale_outcome_body(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    _job, result = _reconcile_with_outcome(store, stale=True, cancel=False)
    assert result.status == "failed"


def _pre_reset_admission_body(tmp_path: Path) -> None:
    # A retune child: created with the request's generation, holding no slot,
    # so only the generation fence can refuse it after a reset (INV-LC-6).
    store = JobStore(tmp_path / "jobs")
    job, gen = store.create_child(
        backend_name="lizyml", config={}, data_ref=_REF, job_type="tune"
    )
    store.reset_cancel_active()
    from lizystudio.services._job_lifecycle_types import AdmissionRefused

    with pytest.raises(AdmissionRefused):
        store.admit(job.job_id, expect="pending", reset_gen=gen, slot_rule="claim")


_FENCE_TESTS: dict[str, Callable[[Path], None]] = {
    "competing_commits": lambda p: fence.test_competing_commits_publish_once(
        p, "completed"
    ),
    "paused_commit_revokes": fence.test_a_paused_commit_revokes_its_token,
    "fail_escaped_revoked": (
        fence.test_fail_escaped_job_with_a_revoked_token_changes_nothing
    ),
    "stale_outcome": _stale_outcome_body,
    "pre_reset_admission": _pre_reset_admission_body,
}


@pytest.mark.parametrize("name", sorted(_FENCE_TESTS))
def test_the_fence_tests_pass_with_the_fences_on(tmp_path: Path, name: str) -> None:
    """The control half: each fence test passes as shipped."""
    _FENCE_TESTS[name](tmp_path)


@pytest.mark.parametrize("name", sorted(_FENCE_TESTS))
def test_the_fence_tests_fail_with_the_fences_off(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """fence を外す確認: with the token, generation and outcome comparisons
    forced to "equal", each fence test fails."""
    monkeypatch.setattr(JobLifecycle, "_is_live_locked", lambda self, token: True)
    monkeypatch.setattr(JobLifecycle, "_same_reset_gen_locked", lambda self, gen: True)
    monkeypatch.setattr(subprocess_runner, "_same_run", lambda gen, token: True)
    with pytest.raises((AssertionError, pytest.fail.Exception)):
        _FENCE_TESTS[name](tmp_path)


# --- status の書き手の census --------------------------------------------


def test_the_census_sees_a_status_write_outside_the_primitive(env: Env) -> None:
    """The census itself: a save that changes the stored status outside the
    primitive's status writer is reported."""
    job = env.store.create(
        backend_name="lizyml", config={}, data_ref=_REF, job_type="fit"
    )
    job.status = "completed"
    env.store._meta.save_meta(job)
    assert env.rec.census_violations == [(job.job_id, "pending", "completed")]


def test_every_thread_mode_lifecycle_path_writes_status_through_the_primitive(
    env: Env,
) -> None:
    """status の書き手の census (thread mode): fit, tune → pause → unpause,
    cancel during a run, and a reset with a live run — every status change on
    disk went through the primitive's one writer."""
    assert env.post("/api/workspace/fit").status_code == 200
    join_worker(env.client)
    paused_id = env.start_paused_tune()
    assert env.post(f"/api/jobs/{paused_id}/unpause").status_code == 200
    join_worker(env.client)
    gate = Gate()
    env.trainer.fit_gate = gate
    fit_id = env.post("/api/workspace/fit").json()["job_id"]
    gate.wait_reached()
    assert env.post(f"/api/jobs/{fit_id}/cancel").status_code == 200
    gate.release.set()
    join_worker(env.client)
    held = Gate()
    env.trainer.fit_gate = held
    env.post("/api/workspace/fit")
    held.wait_reached()
    env.reset()
    held.release.set()
    join_worker(env.client)
    assert env.rec.census_violations == []
    assert sum(len(v) for v in env.rec.publications.values()) >= 8
