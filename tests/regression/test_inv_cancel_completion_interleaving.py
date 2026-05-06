"""INV-5 cancel + completion interleaving tests (v0.5 R-1.2 / v3-18).

The v3-17 invariant matrix already covers the *read* side of INV-5
(``is_cancel_requested`` monotonic until terminal write). This module
adds defense-in-depth coverage for the *write* side:

  * **Cancel-before-last-cb wins.** When ``request_cancel`` lands
    between two cooperative-callback observations, the next callback
    must raise ``CancelledError`` and the worker must land on
    ``status="cancelled"`` — not silently swallow the cancel and
    proceed to completion.

  * **Cancel-during-completion race is structurally exclusive.** The
    cancel flag is observed only at cb boundaries; once ``execute_fn``
    has returned successfully the worker writes ``completed``. Both
    outcomes are valid for any single run, but across N concurrent
    runs the count of ``cancelled`` plus ``completed`` must equal N
    (no run may end in an inconsistent intermediate state, no run may
    be lost). This is the count-based assertion form for
    ``feedback_count_budget_assertions``: storms must be counted, not
    asserted to "eventually settle".

These tests exercise ``_run_job_core`` directly. The PLAN.md v3-18
phase rescope (away from the misattributed Issue #358 and toward this
defensive coverage) is recorded in HISTORY.md P-0099 acceptance
criteria.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Literal

import pytest

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


def _claim_job(store: JobStore, job_type: Literal["fit", "tune"] = "fit") -> Job:
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
# Test 1: cancel-between-cb-calls wins over completion (deterministic)
# ---------------------------------------------------------------------------


def test_inv5_cancel_request_between_cb_calls_lands_on_cancelled(
    job_store: JobStore,
) -> None:
    """``request_cancel`` between cb calls must propagate before completion.

    The cooperative-cancel contract: once the cancel flag is set, the
    next progress callback must raise ``CancelledError``. This test
    pins that contract by interleaving ``request_cancel`` with a
    deterministic 5-step ``execute_fn`` and asserting the worker lands
    on ``status="cancelled"`` — never reaches the completion branch.
    """
    job = _claim_job(job_store)
    cb_calls: list[int] = []
    cancel_after_step = 2

    def execute_fn(
        cb: Any,
    ) -> tuple[FitSummary, None, str]:
        for i in range(5):
            cb_calls.append(i)
            cb(current=i, total=5, message=f"step {i}")
            if i == cancel_after_step:
                # Set the cancel flag AFTER step ``cancel_after_step``
                # observed; the NEXT cb invocation must raise
                # CancelledError.
                job_store.request_cancel(job.job_id)
        # If the loop exits without raising, the cancel was lost — bug.
        return _stub_fit_summary(), None, "/tmp/model"

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )

    assert result.status == "cancelled", (
        "INV-5: cancel observed at cb boundary must override completion"
    )
    # The cb at i=cancel_after_step + 1 is the one that raises. We
    # appended `i` to cb_calls BEFORE the raising cb call, so the list
    # ends at that index inclusive.
    assert cb_calls == [0, 1, 2, 3], (
        f"cb call sequence diverged from the cooperative-cancel contract: "
        f"{cb_calls}. Expected the cb at i=3 to raise without further "
        f"loop progress."
    )
    assert job_store.active_job_id is None, (
        "INV-1 cross-link: cancelled job must release the slot via finally"
    )


# ---------------------------------------------------------------------------
# Test 2: concurrent cancel-during-completion race is count-balanced
# ---------------------------------------------------------------------------


def test_inv5_cancel_completion_race_count_balanced_under_concurrency(
    tmp_path: Path,
) -> None:
    """N concurrent runs with timed cancel: count(cancelled) + count(completed) == N.

    Each run uses its own ``JobStore`` (isolated jobs_dir) so the
    test does not contend with a single active slot. Half of the runs
    fire ``request_cancel`` between cb calls; half let the worker
    finish naturally. Across all runs, the worker either lands on
    ``cancelled`` or ``completed`` — never an inconsistent
    intermediate state, never silently lost.

    This is the count-based assertion variant called out in memory
    ``feedback_count_budget_assertions``: for race regressions, the
    test must count occurrences across the input axis, not just
    assert that "eventually" the right thing happens.
    """
    n_runs = 16

    def run_one(idx: int) -> str:
        store = JobStore(tmp_path / f"jobs_{idx}")
        job = store.create_and_claim_active(
            backend_name="lizyml",
            config={"task": "binary", "data": {"target": "y"}},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        assert job is not None
        will_cancel = idx % 2 == 0

        def execute_fn(cb: Any) -> tuple[FitSummary, None, str]:
            for i in range(4):
                cb(current=i, total=4, message=f"step {i}")
                if will_cancel and i == 1:
                    store.request_cancel(job.job_id)
            return _stub_fit_summary(), None, "/tmp/model"

        result = _run_job_core(
            job=job,
            job_store=store,
            broadcaster=None,
            execute_fn=execute_fn,
        )
        return result.status

    results: list[str] = []
    results_lock = threading.Lock()

    def worker(idx: int) -> None:
        status = run_one(idx)
        with results_lock:
            results.append(status)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_runs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    cancelled_count = sum(1 for s in results if s == "cancelled")
    completed_count = sum(1 for s in results if s == "completed")
    other_count = len(results) - cancelled_count - completed_count

    assert other_count == 0, (
        f"INV-5: every run must land on cancelled or completed, never "
        f"an intermediate or unknown status. Saw {other_count} other "
        f"statuses across {n_runs} runs: {results}"
    )
    assert cancelled_count + completed_count == n_runs, (
        f"INV-5: count must balance — saw {cancelled_count} cancelled + "
        f"{completed_count} completed across {n_runs} runs"
    )
    assert cancelled_count == n_runs // 2, (
        f"INV-5: every will_cancel=True run must land on cancelled — saw "
        f"{cancelled_count} (expected {n_runs // 2})"
    )
    assert completed_count == n_runs // 2, (
        f"INV-5: every will_cancel=False run must land on completed — saw "
        f"{completed_count} (expected {n_runs // 2})"
    )


# ---------------------------------------------------------------------------
# Test 3: cancel after terminal write must not corrupt persisted status
# ---------------------------------------------------------------------------


def test_inv5_cancel_after_terminal_does_not_overwrite_completed(
    job_store: JobStore,
) -> None:
    """``request_cancel`` arriving after terminal MUST NOT mutate the status.

    The worker's finally-block runs ``clear_cancel`` AFTER
    ``release_active`` AFTER the terminal status write. After that,
    any new ``request_cancel`` for the same job_id sets the in-memory
    flag again, but no worker is observing it — and ``Job.status``
    is already ``completed`` on disk. This test pins that boundary so
    a future "post-terminal cancel rewrites status" regression cannot
    ship silently.
    """
    job = _claim_job(job_store)

    def execute_fn(_cb: Any) -> tuple[FitSummary, None, str]:
        return _stub_fit_summary(), None, "/tmp/model"

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )
    assert result.status == "completed"

    # Now fire a cancel for the same id AFTER terminal. The persisted
    # status must NOT change.
    job_store.request_cancel(job.job_id)
    reloaded = job_store.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "completed", (
        "INV-5: post-terminal request_cancel must not rewrite a completed "
        f"status (saw {reloaded.status})"
    )
