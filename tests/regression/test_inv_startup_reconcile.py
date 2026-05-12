"""INV-7 / INV-1 cross-restart reconciliation (P-0099 v3-22a, R-1.5b).

When the server (re)starts, the in-memory ``JobStore`` is empty —
``_active_job_id`` is ``None`` and ``_pause_requested`` / ``_cancel_requested``
are empty sets. The on-disk ``meta.json`` files survive, so the disk
records may carry mid-flight state from the previous process:

  * ``status="running"`` jobs whose worker thread / subprocess is now
    dead. Without reconciliation the UI would show "running forever"
    and ``_is_slot_holder_stale_locked`` would only catch this AFTER
    the next /fit or /tune request.

  * ``status="paused"`` jobs that were holding the active slot via
    INV-1. Without reconciliation the slot is silently free and a
    concurrent /tune could steal it before the user clicks Resume,
    breaking the in-place /unpause contract from v3-20d.

This module pins the startup reconciliation contract:

  INV-restart-1: every ``running`` record on disk transitions to
                 ``failed`` with a clear error message at startup.

  INV-restart-2: at most ONE ``paused`` job survives startup (newest
                 by ``created_at`` wins); the survivor claims the
                 active slot so concurrent /tune is rejected with
                 ``JOB_CONFLICT``.

  INV-restart-3: terminal states (completed / failed / cancelled)
                 are NEVER rewritten — the reconciliation is a one-way
                 forward arrow.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit


@pytest.fixture()
def fresh_store(tmp_path: Path) -> JobStore:
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


def _create_with_status(
    store: JobStore,
    status: str,
    *,
    job_type: JobType = "tune",
) -> Job:
    """Create a job and force-write *status* to disk.

    Mirrors how a previous process would have left meta.json — we
    bypass the runtime guard because the test is exactly about disk
    state surviving across restart, not the live transition path.
    """
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type=job_type,
    )
    job.status = status  # type: ignore[assignment]
    store.update(job)
    return job


# ---------------------------------------------------------------------------
# INV-restart-1: orphaned ``running`` rows transition to ``failed``.
# ---------------------------------------------------------------------------


def test_reconcile_at_startup_running_orphan_transitions_to_failed(
    fresh_store: JobStore,
) -> None:
    job = _create_with_status(fresh_store, "running")

    # Simulate a fresh process: re-instantiate the JobStore against
    # the same on-disk directory (in-memory state reset) and run the
    # reconciliation entry point.
    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "failed", (
        "INV-restart-1: running rows must reconcile to failed at startup"
    )
    assert reloaded.error is not None
    assert "server" in reloaded.error.lower(), (
        "Error must explain the cause (server restart) for the user"
    )
    assert reloaded.completed_at is not None, (
        "INV-restart-1: failed is terminal — completed_at must be stamped"
    )


def test_reconcile_at_startup_pending_orphan_transitions_to_failed(
    fresh_store: JobStore,
) -> None:
    """``pending`` jobs that never got a worker also count as orphans.

    Without reconciliation the UI would dangle on "pending" forever
    because the worker thread that would normally flip it to running
    is gone with the previous process.
    """
    job = _create_with_status(fresh_store, "pending")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "failed"


# ---------------------------------------------------------------------------
# INV-restart-2: paused job re-claims the active slot.
# ---------------------------------------------------------------------------


def test_reconcile_at_startup_paused_claims_active_slot(
    fresh_store: JobStore,
) -> None:
    job = _create_with_status(fresh_store, "paused")

    reborn = JobStore(fresh_store.jobs_dir)
    assert reborn.active_job_id is None, "precondition: fresh store has no slot"

    reborn.reconcile_at_startup()

    assert reborn.active_job_id == job.job_id, (
        "INV-restart-2: paused job must re-attach the active slot at startup"
    )

    # And the on-disk status remains paused (NOT rewritten to running
    # or anything else — the user must click Resume to advance).
    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "paused"


def test_reconcile_at_startup_concurrent_claim_blocked_by_paused(
    fresh_store: JobStore,
) -> None:
    """After reconciliation the paused job's slot blocks new tunes.

    This is the JOB_CONFLICT contract that the v3-20d /tune endpoint
    relies on — without slot re-attach, a /tune POST seconds after
    startup would silently steal the slot the user thought they had
    paused.
    """
    paused = _create_with_status(fresh_store, "paused")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    new_job = reborn.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert new_job is None, (
        "INV-restart-2: concurrent /tune must be rejected while a "
        "reconciled paused job holds the slot"
    )
    # And the original paused job is still the slot holder.
    assert reborn.active_job_id == paused.job_id


def test_reconcile_at_startup_multiple_paused_keeps_newest_only(
    fresh_store: JobStore,
) -> None:
    """If the disk somehow holds multiple paused jobs (corruption),
    only the newest by ``created_at`` survives — the others are
    reconciled to ``failed`` so INV-1 ("at most one paused job") is
    restored deterministically.
    """
    older = _create_with_status(fresh_store, "paused")
    # Force the second to be objectively newer.
    newer = _create_with_status(fresh_store, "paused")
    assert newer.created_at >= older.created_at

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    # Only the newer one keeps the paused state and the slot.
    survivor = reborn.get(newer.job_id)
    loser = reborn.get(older.job_id)
    assert survivor is not None and survivor.status == "paused"
    assert loser is not None and loser.status == "failed"
    assert reborn.active_job_id == newer.job_id


# ---------------------------------------------------------------------------
# INV-restart-3: terminal states are NEVER rewritten.
# ---------------------------------------------------------------------------


def test_reconcile_at_startup_completed_job_unchanged(
    fresh_store: JobStore,
) -> None:
    job = _create_with_status(fresh_store, "completed")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "completed"


def test_reconcile_at_startup_failed_job_unchanged(
    fresh_store: JobStore,
) -> None:
    job = _create_with_status(fresh_store, "failed")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "failed"


def test_reconcile_at_startup_cancelled_job_unchanged(
    fresh_store: JobStore,
) -> None:
    job = _create_with_status(fresh_store, "cancelled")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "cancelled"


# ---------------------------------------------------------------------------
# Idempotence: a second reconcile call after a normal startup is a no-op.
# ---------------------------------------------------------------------------


def test_reconcile_at_startup_is_idempotent(fresh_store: JobStore) -> None:
    """Calling reconcile twice in the same process is harmless.

    Practical scenarios where this matters: a test fixture invokes
    reconcile, then production lifespan code (also calling reconcile)
    runs against the same JobStore — the second call must observe the
    same already-reconciled state and not re-rewrite anything.
    """
    paused = _create_with_status(fresh_store, "paused")
    completed = _create_with_status(fresh_store, "completed")

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()
    reborn.reconcile_at_startup()  # no-op on already-reconciled state

    assert reborn.active_job_id == paused.job_id
    assert reborn.get(completed.job_id) is not None
    assert reborn.get(completed.job_id).status == "completed"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Issue #450 — INV-1 multi-paused reconcile branch (services/jobs.py:768-789).
# The existing ``test_reconcile_at_startup_multiple_paused_keeps_newest_only``
# above hits the branch for two paused jobs but does not assert the failed
# rows' error text / ``completed_at`` nor exercise non-monotonic timestamps
# (the ``sort(key=created_at)`` vs. insertion-order distinction).
# ---------------------------------------------------------------------------


def test_reconcile_at_startup_two_paused_loser_carries_inv1_error(
    fresh_store: JobStore,
) -> None:
    older = _create_with_status(fresh_store, "paused")
    newer = _create_with_status(fresh_store, "paused")
    assert newer.created_at >= older.created_at

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    loser = reborn.get(older.job_id)
    assert loser is not None
    assert loser.status == "failed"
    assert "only the newest" in (loser.error or ""), loser.error
    assert loser.completed_at is not None
    # The survivor keeps a clean record (no error / completed_at written).
    survivor = reborn.get(newer.job_id)
    assert survivor is not None and survivor.status == "paused"


def test_reconcile_at_startup_three_paused_picks_latest_timestamp_not_insertion_order(
    fresh_store: JobStore,
) -> None:
    """Three paused jobs whose ``created_at`` order is the *reverse* of
    their creation order — reconciliation must keep the one with the
    newest ``created_at`` (the sort key), not the last-created one.
    """
    j_a = _create_with_status(fresh_store, "paused")  # created 1st
    j_b = _create_with_status(fresh_store, "paused")  # created 2nd
    j_c = _create_with_status(fresh_store, "paused")  # created 3rd
    # Timestamp them in reverse: j_a newest, j_c oldest.
    j_a.created_at = "2026-05-03T00:00:00+00:00"
    j_b.created_at = "2026-05-02T00:00:00+00:00"
    j_c.created_at = "2026-05-01T00:00:00+00:00"
    for j in (j_a, j_b, j_c):
        fresh_store.update(j)

    reborn = JobStore(fresh_store.jobs_dir)
    reborn.reconcile_at_startup()

    jobs = reborn.list()
    paused = [j for j in jobs if j.status == "paused"]
    failed = [j for j in jobs if j.status == "failed"]
    assert len(paused) == 1
    assert paused[0].job_id == j_a.job_id  # newest created_at, not last-created
    assert {j.job_id for j in failed} == {j_b.job_id, j_c.job_id}
    for j in failed:
        assert "only the newest" in (j.error or ""), j.error
        assert j.completed_at is not None
    # The surviving paused job holds the active slot (INV-1).
    assert reborn.active_job_id == j_a.job_id

    # On-disk state matches the in-memory reconciliation (a 2nd fresh
    # JobStore re-reads meta.json from scratch).
    reread = JobStore(fresh_store.jobs_dir)
    survivor = reread.get(j_a.job_id)
    loser_b = reread.get(j_b.job_id)
    loser_c = reread.get(j_c.job_id)
    assert survivor is not None and survivor.status == "paused"
    assert loser_b is not None and loser_b.status == "failed"
    assert loser_c is not None and loser_c.status == "failed"
