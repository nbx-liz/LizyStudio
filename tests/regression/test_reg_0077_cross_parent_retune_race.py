"""Regression test for cross-parent retune race (Issue #116).

Verify that two independent parents can each have a retune child
created concurrently without corrupting lineage metadata or causing
a deadlock. The per-parent lock (_parent_locks) is keyed by parent
job id, so two different parents should never contend.
"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit

_DATA_REF = DataRef(
    source_type="path",
    path="/data/x.csv",
    filename="x.csv",
    fingerprint="f",
    shape=(10, 2),
)


def _make_completed_parent(store: JobStore) -> str:
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_DATA_REF,
        job_type="tune",
    )
    job.status = "completed"
    store.update(job)
    return job.job_id


def test_concurrent_retune_from_different_parents(tmp_path: Path) -> None:
    """Two different parents acquiring retune locks concurrently must
    both succeed — they should never contend."""
    store = JobStore(tmp_path / "jobs")
    parent_a = _make_completed_parent(store)
    parent_b = _make_completed_parent(store)

    results: dict[str, bool] = {}
    errors: list[Exception] = []

    def _acquire(parent_id: str, label: str) -> None:
        try:
            child = store.create(
                backend_name="lizyml",
                config={"task": "binary"},
                data_ref=_DATA_REF,
                job_type="tune",
                parent_job_id=parent_id,
            )
            got = store.acquire_parent_lock(parent_id, child.job_id)
            results[label] = got
        except Exception as exc:
            errors.append(exc)

    t1 = threading.Thread(target=_acquire, args=(parent_a, "a"))
    t2 = threading.Thread(target=_acquire, args=(parent_b, "b"))
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not errors, f"Unexpected errors: {errors}"
    assert results.get("a") is True, "Parent A lock should succeed"
    assert results.get("b") is True, "Parent B lock should succeed"

    # Both parent locks are now held by different children
    assert store.get_locked_child(parent_a) is not None
    assert store.get_locked_child(parent_b) is not None
    assert store.get_locked_child(parent_a) != store.get_locked_child(parent_b)


def test_same_parent_second_retune_is_rejected(tmp_path: Path) -> None:
    """The PARENT_LOCKED guard must prevent a second retune on the
    same parent even when the requests arrive from different threads."""
    store = JobStore(tmp_path / "jobs")
    parent_id = _make_completed_parent(store)

    results: list[bool] = []
    barrier = threading.Barrier(2, timeout=5)

    def _acquire() -> None:
        child = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_DATA_REF,
            job_type="tune",
            parent_job_id=parent_id,
        )
        barrier.wait()
        got = store.acquire_parent_lock(parent_id, child.job_id)
        results.append(got)

    t1 = threading.Thread(target=_acquire)
    t2 = threading.Thread(target=_acquire)
    t1.start()
    t2.start()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert len(results) == 2
    assert results.count(True) == 1, "Exactly one lock should succeed"
    assert results.count(False) == 1, "Second attempt should be rejected"


def test_active_slot_serializes_cross_parent_retune(tmp_path: Path) -> None:
    """Even though parent locks are independent, the single active
    slot (_active_job_id) still serializes execution. A second
    create_and_claim_active from a different parent must wait or be
    rejected by the active slot guard."""
    store = JobStore(tmp_path / "jobs")
    parent_a = _make_completed_parent(store)
    parent_b = _make_completed_parent(store)

    child_a = store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_DATA_REF,
        job_type="tune",
        parent_job_id=parent_a,
    )
    # Simulate child_a claiming the active slot (as create_and_claim_active does)
    claimed_a = store.claim_active(child_a.job_id)
    assert claimed_a is True

    child_b = store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_DATA_REF,
        job_type="tune",
        parent_job_id=parent_b,
    )
    # child_b tries to claim — should fail because child_a holds the slot
    claimed_b = store.claim_active(child_b.job_id)
    assert claimed_b is False

    # Release child_a
    store.release_active(child_a.job_id)
    # Now child_b can claim
    claimed_b2 = store.claim_active(child_b.job_id)
    assert claimed_b2 is True
