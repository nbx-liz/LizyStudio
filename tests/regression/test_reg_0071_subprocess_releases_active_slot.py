"""Regression test for CRITICAL-2 follow-up: subprocess must release slot.

``create_and_claim_active`` (introduced in Batch C) claims the active
slot in the parent process before kicking off a background thread.
When OpenMP routes the job through ``_run_subprocess_job``, the actual
execution happens in a child process that has its own ``JobStore``
instance — so the in-process ``_run_job_core.finally`` does not touch
the parent's ``_active_job_id``. Without an explicit release in the
subprocess path the slot stayed held forever and every subsequent
``/workspace/fit`` or ``/workspace/tune`` returned 409.

This test exercises the real ``_run_subprocess_job`` with
``run_job_in_subprocess`` monkeypatched to a no-op so it runs offline,
and verifies the active slot is empty afterwards.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _make_claimed_job(store: JobStore, job_type: str = "fit"):
    job = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type=job_type,
    )
    assert job is not None
    return job


def _make_ws_mock() -> MagicMock:
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


def test_subprocess_job_releases_slot_on_success(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from lizystudio.services import training as training_module

    ws = _make_ws_mock()
    job = _make_claimed_job(job_store)
    assert job_store.active_job_id == job.job_id

    def _fake_run_subprocess(**kwargs):  # type: ignore[no-untyped-def]
        finished = kwargs["job"]
        finished.status = "completed"
        return finished

    monkeypatch.setattr(
        "lizystudio.services.subprocess_runner.run_job_in_subprocess",
        _fake_run_subprocess,
    )

    training_module._run_subprocess_job(ws, job, job_store, broadcaster=MagicMock())

    assert job_store.active_job_id is None, (
        "subprocess success path must release the active slot"
    )


def test_subprocess_job_releases_slot_on_exception(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from lizystudio.services import training as training_module

    ws = _make_ws_mock()
    job = _make_claimed_job(job_store)

    def _boom(**kwargs):  # type: ignore[no-untyped-def]
        raise RuntimeError("simulated subprocess failure")

    monkeypatch.setattr(
        "lizystudio.services.subprocess_runner.run_job_in_subprocess",
        _boom,
    )

    with pytest.raises(RuntimeError, match="simulated"):
        training_module._run_subprocess_job(ws, job, job_store, broadcaster=MagicMock())

    assert job_store.active_job_id is None, (
        "subprocess failure path must still release the slot"
    )


def test_subprocess_job_releases_slot_when_data_ref_missing(
    job_store: JobStore,
) -> None:
    from lizystudio.services import training as training_module

    ws = _make_ws_mock()
    ws.data_ref = None
    job = _make_claimed_job(job_store)

    training_module._run_subprocess_job(ws, job, job_store, broadcaster=MagicMock())

    assert job_store.active_job_id is None
    reloaded = job_store.get(job.job_id)
    assert reloaded is not None
    assert reloaded.status == "failed"


def test_create_and_claim_active_reclaims_stale_slot(job_store: JobStore) -> None:
    """A terminal-state owner must not lock out future callers.

    Safety net for any subprocess / cancel path that fails to release
    the slot cleanly. Without this, the E2E "Delete running job" ->
    "Job export model" sequence left the slot held forever.
    """
    first = _make_claimed_job(job_store)
    # Simulate the runner thread crashing before release: mark the
    # job completed on disk but do not call release_active.
    first.status = "completed"
    job_store.update(first)
    assert job_store.active_job_id == first.job_id

    second = job_store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/y.csv",
            filename="y.csv",
            fingerprint="g",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    assert second is not None, "stale slot must be reclaimed for new callers"
    assert second.job_id != first.job_id
    assert job_store.active_job_id == second.job_id


def test_create_and_claim_active_refuses_when_holder_is_running(
    job_store: JobStore,
) -> None:
    """A genuinely running holder still blocks the new caller."""
    first = _make_claimed_job(job_store)
    first.status = "running"
    job_store.update(first)

    second = job_store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/y.csv",
            filename="y.csv",
            fingerprint="g",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    assert second is None
    assert job_store.active_job_id == first.job_id


def test_create_and_claim_active_reclaims_when_holder_meta_missing(
    job_store: JobStore,
) -> None:
    """If the on-disk meta is gone, the slot is reclaimable too."""
    first = _make_claimed_job(job_store)
    # Wipe the meta to simulate a concurrent delete / corruption.
    (job_store.jobs_dir / first.job_id / "meta.json").unlink()

    second = job_store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/y.csv",
            filename="y.csv",
            fingerprint="g",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    assert second is not None
    assert job_store.active_job_id == second.job_id
