"""Tests for JobStore disk persistence."""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.jobs import JobStore


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


def test_create_and_get(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    assert job.status == "pending"
    assert job.job_id.startswith("job_")

    loaded = job_store.get(job.job_id)
    assert loaded is not None
    assert loaded.job_id == job.job_id
    assert loaded.config == {"task": "binary"}
    assert loaded.data_ref.shape == (100, 10)


def test_get_nonexistent(job_store: JobStore) -> None:
    assert job_store.get("nonexistent") is None


def test_list_empty(job_store: JobStore) -> None:
    assert job_store.list() == []


def test_list_with_filter(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)

    job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )

    all_jobs = job_store.list()
    assert len(all_jobs) == 2

    completed = job_store.list(status="completed")
    assert len(completed) == 1
    assert completed[0].job_id == job.job_id


def test_update_with_results(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"auc": 0.95},
        fold_count=5,
        params=[{"n_estimators": 100}],
    )
    job_store.update(job)

    loaded = job_store.get(job.job_id)
    assert loaded is not None
    assert loaded.fit_result is not None
    assert loaded.fit_result.metrics["auc"] == 0.95
    assert loaded.fit_result.fold_count == 5


def test_delete(job_store: JobStore, sample_data_ref: DataRef) -> None:
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    assert job_store.delete(job.job_id) is True
    assert job_store.get(job.job_id) is None
    assert job_store.delete(job.job_id) is False
