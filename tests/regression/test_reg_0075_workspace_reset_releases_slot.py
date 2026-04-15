"""Regression test: ``POST /workspace/reset`` must free the active job slot.

H-0063 / Issue #99: previously ``workspace_reset`` only cleared the
``WorkspaceState`` and never touched ``JobStore._active_job_id``. A
fit / tune that was still running from a previous session remained in
the slot, so the next click on Fit / Tune got a 409 JOB_CONFLICT —
directly contradicting the user's expectation that "reset" yields a
clean slate.

This test locks the fix contract:

1. If an active job is present when reset is invoked, the reset must
   cancel it (via ``request_cancel`` — the same path as the existing
   ``POST /jobs/{id}/cancel`` endpoint) before returning.
2. The slot must be empty after the call, within a short timeout.
3. The endpoint must still return 200 even if the cancel does not land
   before the timeout (degraded but forward-progress semantics — the
   next fit / tune may still 409 once, which frontend clients already
   handle).
4. The no-active-job path must be unaffected so existing callers that
   reset an idle workspace see identical behaviour.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


def _get_job_store(client: TestClient) -> JobStore:
    """Pull the app's live JobStore from FastAPI state."""
    store = client.app.state.job_store  # type: ignore[attr-defined]
    assert isinstance(store, JobStore)
    return store


def _seed_running_active_job(store: JobStore) -> str:
    """Create a job, flip its disk status to ``running``, claim the slot.

    Mirrors the shape of `_seed_running_holder` from
    ``test_workspace_coverage.py`` — a real job directory on disk so
    the JobStore's stale-slot auto-reclaim does not treat it as
    terminal and release the slot prematurely.
    """
    data_ref = DataRef(
        source_type="path",
        path="/tmp/dummy.csv",
        filename="dummy.csv",
        fingerprint="abc",
        shape=(10, 2),
    )
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "running"
    store.update(job)
    assert store.claim_active(job.job_id), "baseline precondition: slot free"
    return job.job_id


def test_reset_without_active_job_is_noop_for_slot(client: TestClient) -> None:
    """Existing happy path: reset on an idle workspace behaves exactly as
    before — slot stays empty, response is 200, no cancel side effects.
    """
    store = _get_job_store(client)
    assert store.active_job_id is None

    res = client.post("/api/workspace/reset")

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    assert store.active_job_id is None


def test_reset_cancels_and_releases_active_job(client: TestClient) -> None:
    """The core fix. A running job holds the slot; reset must cancel it
    and the slot must be empty afterwards.
    """
    store = _get_job_store(client)
    job_id = _seed_running_active_job(store)
    assert store.active_job_id == job_id
    assert store.has_active_job()
    assert not store.is_cancel_requested(job_id)

    res = client.post("/api/workspace/reset")

    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    # The cancel flag must have been set. The real runner thread (which
    # is not present in this unit test) is what would drain the slot
    # normally, so the implementation must also release the slot
    # directly when it observes that there is no live runner — see
    # H-0063 for the degraded-path semantics.
    assert store.is_cancel_requested(job_id) or not store.has_active_job(), (
        "reset must either request cancel (live runner drains slot) or "
        "directly release the slot (no runner present)"
    )
    assert not store.has_active_job(), (
        "after reset completes, the active slot must be empty so a "
        "subsequent fit / tune does not 409"
    )


def test_reset_with_completed_slot_holder_releases_slot(
    client: TestClient,
) -> None:
    """Degraded / stale path: the slot holder is already terminal on disk
    (e.g. the runner crashed before calling ``release_active``). Reset
    must still free the slot rather than leaving the stale id behind.
    """
    store = _get_job_store(client)
    data_ref = DataRef(
        source_type="path",
        path="/tmp/dummy.csv",
        filename="dummy.csv",
        fingerprint="abc",
        shape=(10, 2),
    )
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=data_ref,
        job_type="fit",
    )
    # Deliberately set the on-disk status to ``completed`` but keep the
    # slot claimed — this is exactly the leak shape PR #96 / #97 fixed
    # in the runner finally, so it should not happen in the happy path,
    # but reset must be robust against it.
    job.status = "completed"
    store.update(job)
    store.claim_active(job.job_id)
    assert store.has_active_job()

    res = client.post("/api/workspace/reset")

    assert res.status_code == 200
    assert not store.has_active_job()


def test_force_release_active_if_atomic_compare_and_release(
    client: TestClient,
) -> None:
    """Unit guard for ``JobStore.force_release_active_if``.

    The reset flow relies on this helper to avoid the TOCTOU hole
    where a naive ``active_job_id`` read + ``release_active`` could
    release a new claim that landed between the two steps. The
    helper must release only the exact id the caller observed, and
    no-op if the slot has been re-claimed by someone else in the
    meantime.
    """
    store = _get_job_store(client)
    first = _seed_running_active_job(store)
    assert store.active_job_id == first

    # Simulate the race: a concurrent writer re-claims the slot
    # with a different id in between our observation and release.
    store.release_active(first)
    second = _seed_running_active_job(store)
    assert store.active_job_id == second

    # Force-releasing the OLD observed id must no-op — the slot
    # belongs to a different job now.
    released = store.force_release_active_if(first)
    assert released is False
    assert store.active_job_id == second

    # Force-releasing the CURRENT id succeeds exactly once.
    released = store.force_release_active_if(second)
    assert released is True
    assert store.active_job_id is None

    # A second attempt is a safe no-op, not a crash.
    released = store.force_release_active_if(second)
    assert released is False


def test_reset_preserves_jobs_on_disk(client: TestClient, tmp_path: Path) -> None:
    """Reset clears workspace state and releases the slot, but the
    historical job directory must survive — the Jobs page and lineage
    features still rely on it.
    """
    store = _get_job_store(client)
    job_id = _seed_running_active_job(store)
    job_dir = store.jobs_dir / job_id
    assert job_dir.exists()

    res = client.post("/api/workspace/reset")

    assert res.status_code == 200
    assert job_dir.exists(), (
        "reset must not delete job directories; only the active-slot "
        "pointer and workspace state are cleared"
    )
