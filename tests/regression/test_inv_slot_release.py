"""INV-1 / INV-5 invariant matrix for v0.5 R-1.1 (P-0099, PLAN.md v3-17).

INV-1: ``active_job_id`` holds at most one running-or-paused job at any
time. The slot is released through one of six termination paths:

  1. Normal completion (in-process)
  2. User cancel (``CancelledError`` observed mid-run)
  3. In-process exception (non-cancel)
  4. SIGKILL of subprocess child (parent watchdog detects child death)
  5. WebSocket disconnect during run (job continues, slot released at
     terminal write — INV-7 cross-link: WS does NOT release the slot)
  6. Browser tab close during run (same as #5; verified in Playwright)

INV-5: cancel observation is monotonic — once
``is_cancel_requested(job_id)`` returns ``True`` at time T, it returns
``True`` for every subsequent call until the worker's terminal write
finally-block clears it via ``clear_cancel``.

This module is the canonical RED-phase invariant matrix. v3-17 (R-1.1)
covers paths 1, 2, 3, and the in-process WS-disconnect Python
assertion. Path 4 (SIGKILL watchdog) is marked ``xfail`` and unblocked
by v3-19 (R-1.3). Path 6 (browser close) is a Playwright-only path
covered separately in ``tests/e2e/slot-release-paths.spec.ts``.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Literal

import pytest

from lizystudio.backends.exceptions import CancelledError
from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services._training_core import _run_job_core
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


def _claim_job(store: JobStore, job_type: JobType = "fit") -> Job:
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
# INV-1 path 1: normal completion releases the slot.
# ---------------------------------------------------------------------------


def test_inv1_path1_normal_completion_releases_slot(job_store: JobStore) -> None:
    job = _claim_job(job_store)
    assert job_store.active_job_id == job.job_id, (
        "precondition: slot held by the freshly claimed job"
    )

    def execute_ok(_cb: Any) -> tuple[FitSummary, None, str]:
        return _stub_fit_summary(), None, "/tmp/model"

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_ok,
    )

    assert result.status == "completed"
    assert job_store.active_job_id is None, (
        "INV-1: normal completion must release the slot via the finally-block"
    )


# ---------------------------------------------------------------------------
# INV-1 path 2: cancel releases the slot.
# ---------------------------------------------------------------------------


def test_inv1_path2_cancel_releases_slot(job_store: JobStore) -> None:
    job = _claim_job(job_store)

    def execute_cancel(_cb: Any) -> tuple[FitSummary, None, str]:
        raise CancelledError

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_cancel,
    )

    assert result.status == "cancelled"
    assert job_store.active_job_id is None, (
        "INV-1: a cancelled job must release the slot at terminal-write time"
    )


# ---------------------------------------------------------------------------
# INV-1 path 3: non-cancel exception releases the slot.
# ---------------------------------------------------------------------------


def test_inv1_path3_exception_releases_slot(job_store: JobStore) -> None:
    job = _claim_job(job_store)

    def execute_boom(_cb: Any) -> tuple[FitSummary, None, str]:
        raise RuntimeError("simulated training failure")

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_boom,
    )

    assert result.status == "failed"
    assert "RuntimeError" in (result.error or "")
    assert job_store.active_job_id is None, (
        "INV-1: a failing job must still release the slot via finally"
    )


# ---------------------------------------------------------------------------
# INV-1 path 4: SIGKILL of subprocess child eventually releases the slot.
#
# Audit conducted at v3-19 kickoff (2026-05-06):
# - ``run_job_in_subprocess`` already reconciles a kill -9 child by
#   reloading the persisted job after ``proc.wait()`` and rewriting
#   ``status="failed"`` when the child died without persisting a
#   terminal — see ``services/subprocess_runner.py:run_job_in_subprocess``
#   lines 250-275.
# - ``_run_subprocess_job.finally`` then unconditionally calls
#   ``release_active`` — see ``services/_training_core.py:362-363``.
#
# The xfail placeholder originally lived here because the v3-17 (R-1.1)
# scope did not extend to subprocess simulation. v3-19 (R-1.3) lands the
# concrete invariant assertion: a mocked ``run_job_in_subprocess`` that
# emulates the parent observing a -9 exit MUST drive ``_run_subprocess_job``
# to release the slot within a bounded time window. INV-6 deeper coverage
# (real Popen + os.kill) lives in
# ``tests/regression/test_inv_subprocess_crash_recovery.py``.
# ---------------------------------------------------------------------------


def _make_ws_mock_for_subprocess() -> Any:
    """Helper used by path 4 — returns a workspace double that
    satisfies ``_run_subprocess_job`` without a real backend."""
    from unittest.mock import MagicMock

    ws = MagicMock()
    ws.data_ref = DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )
    ws.backend.info.name = "lizyml"
    ws._lock = MagicMock()
    ws._lock.__enter__ = MagicMock(return_value=None)
    ws._lock.__exit__ = MagicMock(return_value=None)
    return ws


def test_inv1_path4_sigkill_subprocess_releases_slot_within_bounded_time(
    job_store: JobStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A child dying without persisting a terminal must release the slot.

    The mock simulates the parent's view of a kill -9: the subprocess
    runner returns the job unchanged (still ``pending``/``running``
    on disk because the child never reached ``_run_job_core.finally``).
    ``_run_subprocess_job.finally`` MUST still call ``release_active``,
    and the bounded time check exists so a future regression that
    blocks the parent thread on a dead PID is caught immediately.
    """
    from unittest.mock import MagicMock

    from lizystudio.services import training as training_module

    job = _claim_job(job_store)
    assert job_store.active_job_id == job.job_id

    bounded_time_window_s = 15.0

    def fake_run_subprocess(**kwargs: Any) -> Any:
        # Return the job unchanged to simulate a child that died
        # mid-run without writing a terminal status. The parent's
        # _run_subprocess_job.finally is what we are testing here.
        return kwargs["job"]

    monkeypatch.setattr(
        "lizystudio.services.subprocess_runner.run_job_in_subprocess",
        fake_run_subprocess,
    )

    ws = _make_ws_mock_for_subprocess()
    start = time.monotonic()
    training_module._run_subprocess_job(ws, job, job_store, broadcaster=MagicMock())
    elapsed = time.monotonic() - start

    assert elapsed < bounded_time_window_s, (
        f"INV-6: slot release after subprocess crash must complete within "
        f"{bounded_time_window_s}s; took {elapsed:.2f}s"
    )
    assert job_store.active_job_id is None, (
        "INV-1 path 4: subprocess crash must release the slot via "
        "_run_subprocess_job.finally"
    )


# ---------------------------------------------------------------------------
# INV-1 path 5: WebSocket disconnect during run does NOT release the slot
# (INV-7 cross-link); the slot is released only at terminal write.
# ---------------------------------------------------------------------------


def test_inv1_path5_ws_disconnect_does_not_release_until_terminal(
    job_store: JobStore,
) -> None:
    """Disconnecting all WS subscribers mid-run must not release the slot.

    The job's lifetime is owned by the worker thread, not by the
    presence of WebSocket subscribers. INV-7 mandates that WS
    disconnect (or zero subscribers) is irrelevant to slot ownership.
    The slot release happens only via the worker's finally-block when
    the job reaches a terminal state.
    """
    from lizystudio.ws.progress import ProgressBroadcaster

    broadcaster = ProgressBroadcaster()
    job = _claim_job(job_store)

    # Simulate "subscriber present, then disconnects mid-run, then
    # the job completes normally". The broadcaster is fed a real
    # subscribe -> unsubscribe lifecycle.
    import asyncio

    async def subscribe_unsubscribe() -> None:
        q = broadcaster.subscribe(job.job_id)
        broadcaster.unsubscribe(job.job_id, q)

    asyncio.run(subscribe_unsubscribe())

    # During the disconnect, the slot must still be held — no terminal
    # write happened yet, so the worker's finally-block has not run.
    assert job_store.active_job_id == job.job_id, (
        "INV-7: WS disconnect must not release the slot — only the "
        "worker's terminal write may release it"
    )

    # Now drive the worker to terminal. After this, the slot must be
    # released by the finally-block, regardless of the prior WS
    # disconnect.
    def execute_ok(_cb: Any) -> tuple[FitSummary, None, str]:
        return _stub_fit_summary(), None, "/tmp/model"

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        execute_fn=execute_ok,
    )

    assert job_store.active_job_id is None, (
        "INV-1: terminal write after a prior WS disconnect must still release the slot"
    )


# ---------------------------------------------------------------------------
# INV-5: cancel observation is monotonic until terminal write.
# ---------------------------------------------------------------------------


def test_inv5_cancel_observation_monotonic_until_terminal(
    job_store: JobStore,
) -> None:
    """Once ``request_cancel`` is called, every observation reads True.

    The contract is: there must exist no time T' > T in
    [request_cancel, terminal-write] where ``is_cancel_requested``
    returns False. ``clear_cancel`` is called inside the worker's
    finally-block AFTER ``release_active`` and AFTER the terminal
    status was written, so post-terminal False reads are allowed.
    """
    job = _claim_job(job_store)

    # Pre-cancel: False.
    assert job_store.is_cancel_requested(job.job_id) is False

    # Cancel.
    job_store.request_cancel(job.job_id)

    # Repeated checks must all return True.
    observations: list[bool] = []
    for _ in range(20):
        observations.append(job_store.is_cancel_requested(job.job_id))
        time.sleep(0.001)

    assert all(observations), (
        "INV-5: every read between request_cancel and terminal-write "
        "must observe True. Observations: " + repr(observations)
    )


def test_inv5_cancel_observation_monotonic_under_concurrency(
    job_store: JobStore,
) -> None:
    """Cancel observation cannot flicker even with concurrent readers.

    Spawns N threads polling ``is_cancel_requested`` while the main
    thread issues ``request_cancel``. After cancel, no thread may
    observe a False. This is the count-based assertion variant from
    memory ``feedback_count_budget_assertions``: we count False reads
    after cancel, and assert the count is exactly zero.
    """
    job = _claim_job(job_store)

    n_threads = 8
    duration_s = 0.2
    cancel_event = threading.Event()
    false_after_cancel_count = 0
    count_lock = threading.Lock()

    def reader() -> None:
        nonlocal false_after_cancel_count
        deadline = time.monotonic() + duration_s
        while time.monotonic() < deadline:
            if cancel_event.is_set() and not job_store.is_cancel_requested(job.job_id):
                with count_lock:
                    false_after_cancel_count += 1
            time.sleep(0.001)

    threads = [threading.Thread(target=reader) for _ in range(n_threads)]
    for t in threads:
        t.start()

    # Let the readers warm up briefly so the assertion is meaningful.
    time.sleep(0.02)
    job_store.request_cancel(job.job_id)
    cancel_event.set()

    for t in threads:
        t.join()

    assert false_after_cancel_count == 0, (
        f"INV-5: {false_after_cancel_count} False reads observed after "
        "request_cancel — cancel monotonicity violated under concurrency"
    )


# ---------------------------------------------------------------------------
# INV-1 cross-cutting: at most one owner of the active slot.
# ---------------------------------------------------------------------------


def test_inv1_at_most_one_concurrent_slot_owner(job_store: JobStore) -> None:
    """Concurrent ``create_and_claim_active`` calls must serialize.

    Spawns N threads that each attempt to claim the slot. Exactly one
    must succeed. The losers receive ``None`` and must NOT see the
    slot as their own. The succeeded count is the count-based
    assertion ground truth.
    """
    n_threads = 8
    barrier = threading.Barrier(n_threads)
    succeeded: list[Job] = []
    succeeded_lock = threading.Lock()

    def claimer() -> None:
        barrier.wait()
        job = job_store.create_and_claim_active(
            backend_name="lizyml",
            config={"task": "binary", "data": {"target": "y"}},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        if job is not None:
            with succeeded_lock:
                succeeded.append(job)

    threads = [threading.Thread(target=claimer) for _ in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(succeeded) == 1, (
        f"INV-1: at most one claimer may succeed concurrently, got {len(succeeded)}"
    )
    assert job_store.active_job_id == succeeded[0].job_id
