"""Regression test for child JobStore cancel visibility (Issue #152).

In subprocess mode, ``_child_main`` constructs a fresh ``JobStore``
whose ``_cancel_requested`` set is an in-memory Python object disjoint
from the parent's. Without the file-flag mechanism added here,
``_make_cancel_aware_cb`` polls the child's fresh instance and never
sees the parent's ``request_cancel()`` — cooperative cancel designed
in H-0011 silently breaks for subprocess-mode jobs.

## Invariants

- INV-6: after ``request_cancel(job_id)`` on a parent-side JobStore,
  any fresh JobStore constructed on the same ``jobs_dir`` observes
  the cancel through ``is_cancel_requested``.
- INV-9: the cancel-flag file is written atomically, polled without
  partial-read hazards, and removed by ``clear_cancel``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import CANCEL_FLAG_FILENAME, JobStore

pytestmark = pytest.mark.unit


_DATA_REF = DataRef(
    source_type="path",
    path="/data/x.csv",
    filename="x.csv",
    fingerprint="f",
    shape=(10, 2),
)


def _make_job(store: JobStore) -> str:
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_DATA_REF,
        job_type="tune",
    )
    return job.job_id


def test_request_cancel_writes_flag_file(tmp_path: Path) -> None:
    """INV-9: request_cancel writes <job_dir>/CANCEL atomically."""
    store = JobStore(tmp_path)
    job_id = _make_job(store)
    store.request_cancel(job_id)

    flag_path = tmp_path / job_id / CANCEL_FLAG_FILENAME
    assert flag_path.exists(), f"expected CANCEL flag at {flag_path}, missing"


def test_fresh_store_sees_parent_cancel(tmp_path: Path) -> None:
    """INV-6: a JobStore constructed after request_cancel sees it.

    This is the core subprocess scenario: parent calls request_cancel,
    child process constructs `JobStore(jobs_dir)` from scratch, and the
    child's is_cancel_requested must return True — otherwise cooperative
    cancel in training.py never fires.
    """
    parent = JobStore(tmp_path)
    job_id = _make_job(parent)
    parent.request_cancel(job_id)

    # Fresh JobStore — simulates the child subprocess's _child_main
    # constructing JobStore(jobs_dir) with no shared in-memory state.
    child = JobStore(tmp_path)
    assert child.is_cancel_requested(job_id) is True


def test_clear_cancel_removes_flag_file(tmp_path: Path) -> None:
    """INV-9: clear_cancel removes the flag file so a stale flag does
    not bleed into a subsequent job run on the same job_dir.
    """
    store = JobStore(tmp_path)
    job_id = _make_job(store)
    store.request_cancel(job_id)
    flag_path = tmp_path / job_id / CANCEL_FLAG_FILENAME
    assert flag_path.exists()

    store.clear_cancel(job_id)
    assert not flag_path.exists()
    assert store.is_cancel_requested(job_id) is False


def test_clear_cancel_is_idempotent(tmp_path: Path) -> None:
    """clear_cancel must not raise when the flag was never written."""
    store = JobStore(tmp_path)
    job_id = _make_job(store)
    store.clear_cancel(job_id)  # Should not raise.
    assert store.is_cancel_requested(job_id) is False


def test_request_cancel_is_idempotent(tmp_path: Path) -> None:
    """request_cancel called twice leaves the flag file present."""
    store = JobStore(tmp_path)
    job_id = _make_job(store)
    store.request_cancel(job_id)
    store.request_cancel(job_id)
    flag_path = tmp_path / job_id / CANCEL_FLAG_FILENAME
    assert flag_path.exists()


def test_cancel_is_per_job_not_global(tmp_path: Path) -> None:
    """Cancelling job A does not affect job B, even in a fresh store."""
    parent = JobStore(tmp_path)
    job_a = _make_job(parent)
    job_b = _make_job(parent)
    parent.request_cancel(job_a)

    child = JobStore(tmp_path)
    assert child.is_cancel_requested(job_a) is True
    assert child.is_cancel_requested(job_b) is False


def test_fresh_store_without_cancel_returns_false(tmp_path: Path) -> None:
    """No request_cancel → fresh store reports not cancelled."""
    parent = JobStore(tmp_path)
    job_id = _make_job(parent)

    child = JobStore(tmp_path)
    assert child.is_cancel_requested(job_id) is False


def test_in_memory_fast_path_still_works(tmp_path: Path) -> None:
    """Same-process call path is unchanged: the in-memory set wins
    before the file is consulted (cheap poll in hot cancel loop).
    """
    store = JobStore(tmp_path)
    job_id = _make_job(store)
    store.request_cancel(job_id)
    # Remove the flag file to prove the in-memory path still works.
    (tmp_path / job_id / CANCEL_FLAG_FILENAME).unlink()
    assert store.is_cancel_requested(job_id) is True
