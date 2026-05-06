"""INV-pause invariants for v0.5 R-1.4 (P-0099, PLAN.md v3-20c).

Pause is the first non-terminal mid-flight transition introduced into
the Job state machine.  Until v3-20c, every exit from ``_run_job_core``
released the active slot and cleared the cancel flag.  Pause breaks
that symmetry on purpose: a paused tune ist still owns the workspace's
single training slot so the same job can be resumed in place when the
user clicks Resume.

The invariants pinned here:

INV-pause-1: ``_run_job_core`` catching :class:`PausedError` MUST set
  ``status="paused"`` AND ``completed_at=None`` AND keep ``active_job_id``
  pointed at the paused job.  The finally-block's
  ``release_active`` / ``clear_cancel`` is skipped on the paused branch
  (this is the slot-ownership extension to INV-1).

INV-pause-2: ``request_pause`` is observable at the cancel-aware
  callback boundary — invoking the callback after a pause request raises
  :class:`PausedError` so the worker unwinds through the dedicated
  except-branch instead of mis-classifying as cancel/failure.

INV-pause-3: ``request_pause`` / ``is_pause_requested`` / ``clear_pause``
  are thread-safe under concurrent writes — the count of pause-requested
  job ids equals the number of distinct ``request_pause`` callers.

INV-pause-4 (state-machine guard): ``JobStore.set_status`` enforces
  P-0099 INV-3 ``LEGAL_TRANSITIONS`` at write time; illegal transitions
  raise instead of silently rewriting status.  The matching xfail in
  ``tests/regression/test_inv_state_machine.py`` flips to green in this
  same PR.

Tests use ``Memory.feedback_count_budget_assertions``: storm/spam-style
properties are asserted with explicit counts so a regression cannot pass
by being eventually-correct.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Literal

import pytest

from lizystudio.backends.exceptions import PausedError
from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services._training_core import _make_cancel_aware_cb, _run_job_core
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _make_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )


JobType = Literal["fit", "tune"]


def _claim_job(store: JobStore, job_type: JobType = "tune") -> Job:
    job = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type=job_type,
    )
    assert job is not None
    return job


def _stub_fit_summary() -> FitSummary:
    return FitSummary(metrics={}, fold_count=1, params=[])


# ---------------------------------------------------------------------------
# INV-pause-1: PausedError keeps the active slot.
# ---------------------------------------------------------------------------


def test_paused_branch_keeps_active_slot(job_store: JobStore) -> None:
    """``_run_job_core`` must NOT release the slot when the worker
    raised :class:`PausedError`.

    Pre-fix the same finally-block that handled cancel/failure also fired
    on pause, dropping ``active_job_id`` to ``None`` and letting another
    /fit or /tune steal the slot — that defeats the whole resume design,
    because the resume call would then race a different running job.
    """
    job = _claim_job(job_store)
    assert job_store.active_job_id == job.job_id, (
        "precondition: slot held by the freshly claimed job"
    )

    def execute_pause(_cb: Any) -> tuple[FitSummary, None, str]:
        raise PausedError

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_pause,
    )

    assert result.status == "paused", "PausedError must land on the paused branch"
    assert result.completed_at is None, (
        "INV-pause-1: paused is non-terminal — completed_at must remain unset"
    )
    assert job_store.active_job_id == job.job_id, (
        "INV-pause-1: paused must KEEP the active slot for in-place resume"
    )


def test_paused_branch_does_not_clear_cancel_flag(job_store: JobStore) -> None:
    """The paused finally-branch skips ``clear_cancel`` so a concurrent
    cancel observed during pause is preserved for the resume worker.

    Practical case: user clicks Pause, then immediately Cancel before the
    worker's checkpoint write finishes.  The cancel flag must survive into
    the next attempt to resume so the resume cycle short-circuits to
    ``cancelled`` instead of running another silent trial.
    """
    job = _claim_job(job_store)
    job_store.request_cancel(job.job_id)
    assert job_store.is_cancel_requested(job.job_id) is True

    def execute_pause(_cb: Any) -> tuple[FitSummary, None, str]:
        raise PausedError

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_pause,
    )

    assert job_store.is_cancel_requested(job.job_id) is True, (
        "INV-pause-1: paused finally must NOT clear the cancel flag"
    )


# ---------------------------------------------------------------------------
# INV-pause-2: request_pause is observable at cb boundary.
# ---------------------------------------------------------------------------


def test_request_pause_is_observable_at_cb_boundary(job_store: JobStore) -> None:
    """The cancel-aware callback must raise :class:`PausedError` after
    ``request_pause`` so the worker exits through the paused branch.

    Mirrors the cancel-cb contract: the callback is the single observation
    point shared by in-process and subprocess workers, so the pause check
    must live next to the cancel check there — anywhere else and the
    subprocess child's fresh JobStore (whose in-memory set is disjoint
    from the parent's) would never see the pause until OS-level
    escalation, which has no equivalent for pause.
    """
    job = _claim_job(job_store)
    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster=None)

    # Baseline: callback runs without raising.
    cb(current=1, total=10, message="ping")

    job_store.request_pause(job.job_id)

    with pytest.raises(PausedError):
        cb(current=2, total=10, message="ping")


def test_pause_check_takes_precedence_over_silent_progress(
    job_store: JobStore,
) -> None:
    """Even when the broadcaster would otherwise emit a progress event,
    a pending pause request short-circuits to :class:`PausedError`.

    Pre-fix risk: an over-eager progress emit before the pause check would
    leak a "trial 7/100" WS frame after the user clicked Pause, confusing
    the frontend's terminal-replay cache.
    """
    job = _claim_job(job_store)
    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster=None)
    job_store.request_pause(job.job_id)

    with pytest.raises(PausedError):
        cb(current=1, total=10, message="should-not-be-broadcast")


# ---------------------------------------------------------------------------
# INV-pause-3: thread-safe primitives (count-budget).
# ---------------------------------------------------------------------------


def test_concurrent_request_pause_count_balances(job_store: JobStore) -> None:
    """8 parallel ``request_pause`` calls on 8 distinct job ids must
    leave exactly 8 ids in the pause-requested set.

    feedback_count_budget_assertions: assert the count, not just that
    "at least one" lands.  The lock around ``_pause_requested`` is the
    only thing standing between this pattern and a torn write under
    asyncio's worker thread fan-out.
    """
    job_ids = [f"job_{i:08x}" for i in range(8)]

    def _request(jid: str) -> None:
        job_store.request_pause(jid)

    threads = [threading.Thread(target=_request, args=(jid,)) for jid in job_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    pause_observed = sum(1 for jid in job_ids if job_store.is_pause_requested(jid))
    assert pause_observed == 8, (
        f"INV-pause-3: expected 8 distinct ids pause-requested, got {pause_observed}"
    )


def test_clear_pause_removes_observation(job_store: JobStore) -> None:
    """``clear_pause`` is the inverse — after it runs, the worker no
    longer sees the pause.  The /unpause endpoint relies on this so a
    second Pause click after Resume goes through the same path again."""
    job_id = "job_clearpause"
    job_store.request_pause(job_id)
    assert job_store.is_pause_requested(job_id) is True

    job_store.clear_pause(job_id)
    assert job_store.is_pause_requested(job_id) is False, (
        "INV-pause-3: clear_pause must remove the observation"
    )


# ---------------------------------------------------------------------------
# INV-pause-4: set_status enforces INV-3 LEGAL_TRANSITIONS.
# ---------------------------------------------------------------------------


def test_set_status_allows_legal_pending_to_running(job_store: JobStore) -> None:
    """A legal transition succeeds and persists the new status."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job.status == "pending"

    job_store.set_status(job.job_id, "running")

    reloaded = job_store.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "running"


def test_set_status_allows_running_to_paused_and_back(job_store: JobStore) -> None:
    """The v3-20 round-trip (running → paused → running) is legal."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    job_store.set_status(job.job_id, "running")
    job_store.set_status(job.job_id, "paused")
    job_store.set_status(job.job_id, "running")

    reloaded = job_store.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "running"


def test_set_status_rejects_illegal_skip_to_completed(job_store: JobStore) -> None:
    """``pending -> completed`` skips the running phase and is illegal."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )

    with pytest.raises(AssertionError):
        job_store.set_status(job.job_id, "completed")


def test_set_status_rejects_terminal_outgoing(job_store: JobStore) -> None:
    """Terminal states must reject any outgoing transition."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    job_store.set_status(job.job_id, "running")
    job_store.set_status(job.job_id, "completed")

    with pytest.raises(AssertionError):
        job_store.set_status(job.job_id, "running")


def test_set_status_rejects_self_loop(job_store: JobStore) -> None:
    """No state may transition to itself (audit-trail invariant)."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    job_store.set_status(job.job_id, "running")

    with pytest.raises(AssertionError):
        job_store.set_status(job.job_id, "running")


# ---------------------------------------------------------------------------
# INV-pause-5: paused children count as "active" for the cascade-delete
# guard.  A paused tune child holds the workspace's training slot AND
# meaningful Optuna sqlite state; non-cascade delete of the parent must
# fail loudly rather than silently orphan the resume artefact.
# ---------------------------------------------------------------------------


def test_has_active_children_counts_paused_as_active(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    # Drive the child through running -> paused via the runtime guard so
    # the test exercises the same path the /pause endpoint will use.
    job_store.set_status(child.job_id, "running")
    job_store.set_status(child.job_id, "paused")

    assert job_store.has_active_children(parent.job_id) is True, (
        "INV-pause-5: paused children block non-cascade parent delete"
    )


# ---------------------------------------------------------------------------
# INV-pause-6 (v3-20d): subprocess parent finally MUST also skip release
# when the child wrote ``status="paused"``.
#
# v3-20c covered the in-process branch (``_run_job_core.finally``) but
# missed the subprocess wrapper (``_run_subprocess_job.finally``), which
# unconditionally calls ``release_active`` after the child exits. With
# the bug live, /pause in subprocess mode would correctly write paused
# to disk in the child but the parent process would immediately drop
# slot ownership — defeating in-place /unpause because the next /tune
# could steal the slot before the user clicks Resume.
# ---------------------------------------------------------------------------


def test_subprocess_finally_keeps_slot_when_child_wrote_paused(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    from lizystudio.services import _training_core as tc

    job_store = JobStore(tmp_path / "jobs")
    job = _claim_job(job_store)
    # Simulate the subprocess child having persisted paused status.
    job_store.set_status(job.job_id, "running")
    job_store.set_status(job.job_id, "paused")
    assert job_store.active_job_id == job.job_id

    # Stub the actual subprocess run so the test stays in-process.
    def _fake_run_job_in_subprocess(*_args: Any, **_kwargs: Any) -> Job:
        reloaded = job_store.get(job.job_id)
        assert reloaded is not None
        return reloaded

    from lizystudio.services import subprocess_runner

    monkeypatch.setattr(
        subprocess_runner,
        "run_job_in_subprocess",
        _fake_run_job_in_subprocess,
    )

    # Mock workspace so _run_subprocess_job sees a valid data_ref.
    from unittest.mock import MagicMock

    ws = MagicMock()
    ws.data_ref = _make_data_ref()
    ws.record_completion = MagicMock()

    tc._run_subprocess_job(ws, job, job_store, broadcaster=None)

    assert job_store.active_job_id == job.job_id, (
        "INV-pause-6: subprocess parent finally must NOT release the slot "
        "when the child wrote status=paused on disk"
    )
