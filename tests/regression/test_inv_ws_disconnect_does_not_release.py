"""INV-7: WebSocket disconnect MUST NOT release the active slot
(P-0099 v3-22b, R-1.5b / Issue #384).

INV-7 declaration (P-0099):

  WebSocket disconnect は active slot を release **しない** — 進行中
  job は subscriber 数に依らず completion または terminal failure まで
  走る。

The same-process invariant (subscribe -> unsubscribe within a single
``ProgressBroadcaster`` instance) is pinned by
``test_inv_slot_release.py::test_inv1_path5_ws_disconnect_does_not_release_until_terminal``.
This module focuses on the **cross-restart** angle that v3-22a's
``reconcile_at_startup`` introduced:

  Scenario A (running + WS disconnect + crash):
    User opens the WS, the worker starts a tune, the WS disconnects
    (browser close / network drop), the server crashes mid-run. On
    next startup the orphaned ``running`` row reconciles to ``failed``
    — the slot is freed by the crash, NOT by the WS disconnect.

  Scenario B (paused + WS disconnect + restart):
    User clicks Pause, the WS disconnects, the server is restarted
    cleanly (``uvicorn --reload`` or operational restart). The on-
    disk paused row survives, ``reconcile_at_startup`` re-attaches
    the slot, and a concurrent /tune is rejected with JOB_CONFLICT
    just as if the WS had never been opened. INV-7 is preserved
    across the restart boundary.

Together these scenarios + the existing same-process test give INV-7
end-to-end coverage and let us close Issue #384.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Literal

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import Job, JobStore
from lizystudio.ws.progress import ProgressBroadcaster

pytestmark = pytest.mark.unit


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

    Bypasses the runtime guard so we can stage cross-restart fixtures
    that mirror what a previous process would have left on disk.
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
# Scenario A: WS disconnect on a running job is independent of crash recovery.
# ---------------------------------------------------------------------------


def test_ws_disconnect_does_not_release_slot_in_same_process(tmp_path: Path) -> None:
    """Same-process baseline: subscribe + unsubscribe leaves the slot held.

    Pre-fix the broadcaster's bookkeeping leaked into slot ownership
    so a single WS round-trip on a paused / running job would silently
    free the slot. This test pins the inverse contract.
    """
    store = JobStore(tmp_path / "jobs")
    job = _create_with_status(store, "paused")
    # Manually install the slot — paused jobs hold the slot per INV-1
    # (claimed at /tune time, retained by the v3-20c paused branch).
    store.claim_active(job.job_id)
    assert store.active_job_id == job.job_id

    broadcaster = ProgressBroadcaster()

    async def subscribe_unsubscribe() -> None:
        q = broadcaster.subscribe(job.job_id)
        broadcaster.unsubscribe(job.job_id, q)

    asyncio.run(subscribe_unsubscribe())

    assert store.active_job_id == job.job_id, (
        "INV-7: a WS subscribe / unsubscribe round-trip must not flip "
        "active_job_id — slot ownership is the worker thread's concern, "
        "not the broadcaster's"
    )


# ---------------------------------------------------------------------------
# Scenario A continued: running + crash -> reconcile-to-failed (slot freed by
# crash recovery, NOT by the prior WS disconnect).
# ---------------------------------------------------------------------------


def test_running_orphan_after_ws_disconnect_reconciles_to_failed(
    tmp_path: Path,
) -> None:
    """A running job whose WS disconnected then died with the server
    is reconciled to failed at next startup. The slot is freed by the
    crash-recovery path, not by the WS disconnect — INV-7 preserved.
    """
    store = JobStore(tmp_path / "jobs")
    running = _create_with_status(store, "running")
    store.claim_active(running.job_id)

    # Simulate a WS subscribe + disconnect mid-flight.
    broadcaster = ProgressBroadcaster()

    async def subscribe_unsubscribe() -> None:
        q = broadcaster.subscribe(running.job_id)
        broadcaster.unsubscribe(running.job_id, q)

    asyncio.run(subscribe_unsubscribe())
    # Pre-crash invariant: the slot is still held even though no one
    # is watching.
    assert store.active_job_id == running.job_id

    # Simulate process restart: in-memory state goes away, on-disk
    # rows survive, reconcile runs.
    reborn = JobStore(store.jobs_dir)
    reborn.reconcile_at_startup()

    reloaded = reborn.get(running.job_id)
    assert reloaded is not None
    assert reloaded.status == "failed", (
        "Crash-recovery branch must transition the orphan to failed"
    )
    # And the slot is now free — but it was freed by reconcile (the
    # worker is gone), NOT by the WS disconnect that happened earlier.
    assert reborn.active_job_id is None


# ---------------------------------------------------------------------------
# Scenario B: paused + WS disconnect + restart -> slot survives via reconcile.
# ---------------------------------------------------------------------------


def test_paused_slot_survives_ws_disconnect_and_restart(tmp_path: Path) -> None:
    """The user pauses, closes the browser (WS disconnect), then the
    operator restarts the server. INV-7 must hold across the restart:
    a concurrent /tune the moment the server comes back up is rejected
    because the paused job's slot is re-attached by reconcile.
    """
    store = JobStore(tmp_path / "jobs")
    paused = _create_with_status(store, "paused")
    store.claim_active(paused.job_id)

    # User closes the browser; WS disconnects.
    broadcaster = ProgressBroadcaster()

    async def subscribe_unsubscribe() -> None:
        q = broadcaster.subscribe(paused.job_id)
        broadcaster.unsubscribe(paused.job_id, q)

    asyncio.run(subscribe_unsubscribe())
    assert store.active_job_id == paused.job_id  # still held

    # Operational restart — in-memory state is wiped, disk survives.
    reborn = JobStore(store.jobs_dir)
    assert reborn.active_job_id is None  # fresh process
    reborn.reconcile_at_startup()

    # INV-7 across restart: the slot is restored, the paused row is
    # untouched, and a concurrent /tune is rejected.
    assert reborn.active_job_id == paused.job_id, (
        "INV-7 cross-restart: paused job's slot must be re-attached so "
        "WS disconnect + restart is observably equivalent to no-disconnect"
    )
    reloaded = reborn.get(paused.job_id)
    assert reloaded is not None
    assert reloaded.status == "paused"  # never rewritten

    new_job = reborn.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert new_job is None, (
        "Concurrent /tune after restart must be rejected with JOB_CONFLICT "
        "because the reconciled slot is still held by the paused job"
    )


def test_repeated_ws_subscribe_unsubscribe_does_not_perturb_slot(
    tmp_path: Path,
) -> None:
    """Robustness: many subscribe/unsubscribe cycles do not touch slot state.

    A flaky network can produce dozens of WS reconnect cycles in a
    minute. Each round must be inert with respect to slot ownership
    so a long-running paused job survives noisy clients without
    user-visible drift.
    """
    store = JobStore(tmp_path / "jobs")
    job = _create_with_status(store, "paused")
    store.claim_active(job.job_id)

    broadcaster = ProgressBroadcaster()

    async def subscribe_cycles() -> None:
        for _ in range(16):
            q = broadcaster.subscribe(job.job_id)
            broadcaster.unsubscribe(job.job_id, q)

    asyncio.run(subscribe_cycles())

    assert store.active_job_id == job.job_id, (
        "INV-7: 16 subscribe/unsubscribe cycles must leave slot ownership untouched"
    )
