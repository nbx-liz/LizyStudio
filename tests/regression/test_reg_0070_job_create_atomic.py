"""Regression test for CRITICAL-2: atomic job creation.

The workspace_fit / workspace_tune routers previously performed:

    if job_store.has_active_job(): raise
    job = job_store.create(...)
    start_*_async(...)  # claims the slot inside _run_job_core

Two concurrent requests could both pass the ``has_active_job`` check
and both reach ``create``. Only one would ultimately grab the active
slot in ``_run_job_core``; the other ended up as an orphan "failed"
job on disk, cluttering the job list.

The fix exposes ``create_and_claim_active`` on JobStore — a single
critical section that checks the slot, creates the job, and claims
the slot in one step. When a second caller races in the API layer,
``has_active_job`` already blocks them; when they race at the
JobStore level, the second caller gets ``None`` back and must not
have produced a meta.json on disk.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


def _data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )


def test_create_and_claim_active_returns_job_on_empty_slot(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path)
    job = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert job is not None
    assert store.active_job_id == job.job_id
    # Job directory and meta.json exist.
    assert (tmp_path / job.job_id / "meta.json").exists()


def test_create_and_claim_active_refuses_second_caller(tmp_path: Path) -> None:
    store = JobStore(tmp_path)
    first = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert first is not None

    # Count job dirs before the second attempt.
    before = sorted(p.name for p in tmp_path.iterdir())

    second = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert second is None, (
        "second caller must not receive a job while another is active"
    )

    # No new job directory was created for the refused caller.
    after = sorted(p.name for p in tmp_path.iterdir())
    assert before == after, (
        f"refused call must not leave orphan job dirs: before={before} after={after}"
    )
    assert store.active_job_id == first.job_id


def test_release_active_allows_next_create_and_claim(tmp_path: Path) -> None:
    store = JobStore(tmp_path)
    first = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert first is not None
    store.release_active(first.job_id)

    second = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert second is not None
    assert second.job_id != first.job_id
    assert store.active_job_id == second.job_id
