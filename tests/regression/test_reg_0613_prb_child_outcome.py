"""P-0119 PR-B (folded into PR-A after CI on #768): the child stops writing.

Regressions pinned here:

- **A1 / A2 (CI e2e, subprocess mode):** a client that sees ``paused`` /
  ``completed`` on ``GET /jobs/{id}`` and at once calls unpause / retune
  must get 200. Before the fold the child wrote that status itself, ahead of
  the parent's commit, so the job's run token was still live and the call
  answered 409 ``JOB_CONFLICT``. The parent's reconcile is held with a gate,
  which makes the window deterministic.
- **Codex r1-1:** the subprocess child writes no ``meta.json`` at all.
- **Codex r1-2:** a force-release between the child's exit and the parent's
  reconcile counts the terminal exactly once.
- **Codex r1-3:** an accepted cancel survives an ``abandon`` and a restart.
- **Codex r1-4:** a run revoked after the callback's checks emits no progress
  frame and no warning frame.
- **Codex r1-5:** the test recorder counts publications, so a duplicate
  publication fails an exactly-once assertion.
"""

from __future__ import annotations

import json
import time
import warnings
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.exceptions import CancelledError
from lizystudio.backends.types import DataRef
from lizystudio.services import subprocess_runner
from lizystudio.services._job_metadata import JobMetadataStore
from lizystudio.services.jobs import JobStore
from tests.regression.p0119_harness import (
    CHILD_WAIT,
    Gate,
    Recorder,
    metric,
    short_reset_wait,
)
from tests.regression.test_reg_0697_child_windows import ChildEnv, cenv

__all__ = ["cenv"]

_REF = DataRef(
    source_type="path",
    path="/tmp/x.csv",
    filename="x.csv",
    fingerprint="f",
    shape=(1, 1),
)


def _poll_until(cenv: ChildEnv, job_id: str, status: str, seconds: float) -> bool:
    """Poll ``GET /jobs/{id}`` until it reads *status* (bounded wait)."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if cenv.client.get(f"/api/jobs/{job_id}").json()["status"] == status:
            return True
        time.sleep(0.05)
    return False


def _hold_reconcile(cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch) -> Gate:
    gate = cenv.gate()
    monkeypatch.setattr(
        subprocess_runner,
        "_reconcile_subprocess_result",
        gate.wrap(subprocess_runner._reconcile_subprocess_result),
    )
    return gate


def _act_when_visible(
    cenv: ChildEnv, gate: Gate, job_id: str, status: str, act: Any
) -> Any:
    """While the parent's reconcile is held, act as soon as *status* is
    visible; otherwise release the reconcile, wait for *status*, then act."""
    gate.wait_reached()
    if _poll_until(cenv, job_id, status, 2.0):
        response = act()
        gate.release.set()
        return response
    gate.release.set()
    assert _poll_until(cenv, job_id, status, cenv.budget.left(CHILD_WAIT)), (
        f"never read {status}"
    )
    return act()


def test_a1_unpause_as_soon_as_paused_is_visible(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A1: ``paused`` becomes visible only with the parent's commit, so an
    unpause sent the moment a client reads it is accepted (200)."""
    cenv.barrier.arm("core_entry")
    job_id = cenv.post("/api/workspace/tune").json()["job_id"]
    cenv.barrier.wait_reached("core_entry")
    gate = _hold_reconcile(cenv, monkeypatch)
    assert cenv.post(f"/api/jobs/{job_id}/pause").status_code == 200
    cenv.barrier.release("core_entry")
    cenv.barrier.disarm()
    response = _act_when_visible(
        cenv, gate, job_id, "paused", lambda: cenv.post(f"/api/jobs/{job_id}/unpause")
    )
    assert response.status_code == 200, response.text
    cenv.join()
    assert cenv.status(job_id) == "completed"


def test_a2_retune_as_soon_as_completed_is_visible(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A2: ``completed`` becomes visible only with the parent's commit, which
    also released the slot, so a retune sent at once is accepted (200)."""
    gate = _hold_reconcile(cenv, monkeypatch)
    job_id = cenv.post("/api/workspace/tune").json()["job_id"]
    response = _act_when_visible(
        cenv,
        gate,
        job_id,
        "completed",
        lambda: cenv.post(f"/api/jobs/{job_id}/retune", json={"n_trials": 1}),
    )
    assert response.status_code == 200, response.text
    cenv.join()
    assert cenv.status(response.json()["job_id"]) == "completed"


def test_force_release_before_the_reconcile_counts_the_terminal_once(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex r1-2: the child has finished; reset force-releases the run while
    the parent's reconcile is held. Exactly one terminal is published and
    counted, and the later reconcile is dropped."""
    gate = _hold_reconcile(cenv, monkeypatch)
    job_id = cenv.post("/api/workspace/tune").json()["job_id"]
    gate.wait_reached()
    with short_reset_wait(monkeypatch, 0.3):
        assert cenv.post("/api/workspace/reset").status_code == 200
    gate.release.set()
    cenv.join()
    counted = sum(
        metric(cenv.client, "tune", s) for s in ("completed", "failed", "cancelled")
    )
    assert counted == 1
    assert cenv.status(job_id) == "cancelled"
    assert cenv.store.active_job_id is None


def test_the_subprocess_child_writes_no_meta_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex r1-1: the child entry (run in-process with a fake backend)
    makes no ``meta.json`` write at all; only the parent publishes status."""
    from tests.lifecycle_seed import admit_running
    from tests.regression.p0119_harness import FakeTrainer

    store = JobStore(tmp_path / "jobs")
    csv = tmp_path / "d.csv"
    csv.write_text("a,target\n1,0\n2,1\n")
    job = store.create(backend_name="lizyml", config={}, data_ref=_REF, job_type="fit")
    token = admit_running(store, job)
    args = {
        "job_id": job.job_id,
        "jobs_dir": str(store.jobs_dir),
        "backend_name": "lizyml",
        "config": {},
        "data_path": str(csv),
        "job_type": "fit",
        "mode": "job",
        "run_gen": token.run_gen,
    }
    args_path = tmp_path / "args.json"
    args_path.write_text(json.dumps(args))
    from lizystudio.backends.registry import get_adapter

    adapter = get_adapter("lizyml")
    FakeTrainer().install(monkeypatch, adapter)
    monkeypatch.setattr("lizystudio.backends.registry.get_adapter", lambda _n: adapter)
    monkeypatch.setattr(subprocess_runner, "_install_sigterm_handler", lambda: None)
    writes: list[str] = []
    original = JobMetadataStore.save_meta

    def save_meta(meta_store: JobMetadataStore, saved: Any) -> None:
        writes.append(saved.status)
        original(meta_store, saved)

    monkeypatch.setattr(JobMetadataStore, "save_meta", save_meta)
    subprocess_runner._child_main(str(args_path), str(tmp_path / "progress.jsonl"))
    assert writes == []
    stored = store.get(job.job_id)
    assert stored is not None
    assert stored.status == "running"


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


def test_an_accepted_cancel_survives_abandon_and_restart(tmp_path: Path) -> None:
    """Codex r1-3: cancel is accepted (200), the terminal write keeps failing
    and the run is abandoned; after a restart the job is ``cancelled``."""
    store = JobStore(tmp_path / "jobs")
    job, token = _admitted(store)
    assert store.cancel(job.job_id).accepted is True
    assert store.abandon(token) is True
    assert store.is_cancel_requested(job.job_id) is True
    fresh = JobStore(tmp_path / "jobs")
    fresh.recover()
    recovered = fresh.get(job.job_id)
    assert recovered is not None
    assert recovered.status == "cancelled"


def test_a_run_revoked_after_the_callback_checks_emits_no_progress(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex r1-4 (progress): the run is revoked after the callback's cancel
    and token checks and before its frame; the frame is dropped."""
    from lizystudio.services._training_core import _make_cancel_aware_cb

    store = JobStore(tmp_path / "jobs")
    job, token = _admitted(store)
    broadcaster = MagicMock()
    original = store.is_pause_requested

    def revoke_then_check(job_id: str) -> bool:
        store.force_release(job_id)
        return original(job_id)

    monkeypatch.setattr(store, "is_pause_requested", revoke_then_check)
    cb = _make_cancel_aware_cb(job.job_id, store, broadcaster, token=token)
    # The dropped frame also stops the revoked worker at this point (Q1).
    with pytest.raises(CancelledError):
        cb(current=1, total=2, message="trial")
    assert broadcaster.send_progress.call_count == 0


def test_a_run_revoked_after_its_warning_write_emits_no_warning(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex r1-4 (warnings): the run is revoked between the warning's write
    and its frame; the frame is dropped."""
    import logging

    from lizystudio.services._job_warnings import JobWarningCollector

    store = JobStore(tmp_path / "jobs")
    job, token = _admitted(store)
    broadcaster = MagicMock()
    original = store.write_results

    def write_then_revoke(saved: Any, run: Any) -> bool:
        stored = original(saved, run)
        store.force_release(job.job_id)
        return stored

    monkeypatch.setattr(store, "write_results", write_then_revoke)
    collector = JobWarningCollector(
        job=job,
        job_store=store,
        broadcaster=broadcaster,
        job_logger=logging.getLogger("test"),
        token=token,
    )
    with warnings.catch_warnings():
        collector.record_warning("late", "UserWarning")
    assert broadcaster.send_warning.call_count == 0


def test_the_recorder_counts_a_duplicate_publication(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Codex r1-5: two publications of the same status count as two, so an
    exactly-once assertion on ``writes_of`` fails on a duplicate."""
    store = JobStore(tmp_path / "jobs")
    rec = Recorder()
    rec.install(monkeypatch, None, store._slot)
    job, token = _admitted(store)
    store._meta.write_status_locked(
        job.job_id, "cancelled", error=None, completed_at=None
    )
    store._meta.write_status_locked(
        job.job_id, "cancelled", error=None, completed_at=None
    )
    assert rec.writes_of(job.job_id, "cancelled") == 2
    with pytest.raises(AssertionError):
        assert rec.writes_of(job.job_id, "cancelled") == 1
