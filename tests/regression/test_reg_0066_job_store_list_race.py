"""Regression test for JobStore.list race condition.

When another thread removes a job directory between iterdir() discovering
it and ``load_job`` reading ``meta.json`` (#451: ``JobMetadataStore.load_job``
delegates the read to ``_job_metadata.read_job_json``), the previous
implementation raised ``FileNotFoundError`` and bubbled a 500 to the
client. The fix must skip disappearing jobs and log a warning.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services import _job_metadata
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path)


def _make_job(store: JobStore, status: str = "completed") -> str:
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    job.status = status  # type: ignore[assignment]
    store.update(job)
    return job.job_id


def test_list_survives_missing_meta_file(job_store: JobStore) -> None:
    """Deleting meta.json mid-list must not crash the whole call."""
    good_id = _make_job(job_store)
    ghost_id = _make_job(job_store)

    # Simulate a concurrent delete by wiping meta.json of ghost_id
    (job_store.jobs_dir / ghost_id / "meta.json").unlink()

    # The ghost dir still exists, but meta.json does not. list() must
    # skip it and return the surviving job.
    # Also create a bare directory with no meta.json (never-completed
    # write) — must also be skipped.
    (job_store.jobs_dir / "orphan_dir").mkdir()

    jobs = job_store.list()
    ids = [j.job_id for j in jobs]
    assert good_id in ids
    assert ghost_id not in ids
    assert "orphan_dir" not in ids


def test_list_survives_corrupted_meta_json(job_store: JobStore) -> None:
    """A corrupted meta.json must be skipped, not raise."""
    good_id = _make_job(job_store)
    bad_id = _make_job(job_store)

    (job_store.jobs_dir / bad_id / "meta.json").write_text(
        "not json{", encoding="utf-8"
    )

    jobs = job_store.list()
    ids = [j.job_id for j in jobs]
    assert good_id in ids
    assert bad_id not in ids


def test_list_survives_meta_deleted_between_iterdir_and_load(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simulate the TOCTOU: iterdir sees meta.json, load fails."""
    good_id = _make_job(job_store)
    racing_id = _make_job(job_store)

    original_read = _job_metadata.read_job_json

    def _racing_read(path: Path):  # type: ignore[override]
        # The first time load_job reads racing_id's meta, delete it.
        if path.name == "meta.json" and racing_id in str(path):
            # Remove after the exists() check but before the read.
            path.unlink()
        return original_read(path)

    monkeypatch.setattr(_job_metadata, "read_job_json", _racing_read)

    jobs = job_store.list()
    ids = [j.job_id for j in jobs]
    assert good_id in ids
    assert racing_id not in ids
