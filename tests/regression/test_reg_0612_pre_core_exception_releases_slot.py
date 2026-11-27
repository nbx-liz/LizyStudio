"""Regression for Issue #612: an exception before ``_run_job_core`` leaks INV-1.

In thread mode, ``start_fit_async`` / ``start_tune_async`` ran ``run_fit`` /
``run_tune`` with no guard. ``run_tune`` performs the pickle preflight before
``_run_job_core``, so an exception there escaped the daemon thread: the job
stayed ``pending`` (or ``paused`` on the unpause path) and the active slot the
API claimed was never released, so every later ``/fit`` and ``/tune`` got
``JOB_CONFLICT`` until a reset or restart.

INV-1 (BLUEPRINT): the active slot is released on completion OR cancel OR
exception. Each test drives an exception through the worker thread body and
asserts the job is terminal ``failed``, the slot is free, a new job can claim
it, and the failure is broadcast exactly once.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

import lizystudio.services.openmp_detect as openmp_detect_mod
import lizystudio.services.training as training_mod
from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services._job_metadata import JobMetadataStore
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.training import start_fit_async, start_tune_async
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster
from tests.lifecycle_seed import admit_running, reserve_for_launch, seed_job

pytestmark = pytest.mark.unit

_CONFIG: dict[str, Any] = {
    "task": "binary",
    "model": {"name": "lgbm", "params": {"n_estimators": 10}},
}


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def backend() -> MagicMock:
    backend = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.fit.return_value = FitSummary(
        metrics={"auc": 0.9}, fold_count=2, params=[{"n_estimators": 10}]
    )
    backend.tune.return_value = TuningSummary(
        best_params={"lr": 0.01},
        best_score=0.9,
        trials=[{"number": 0, "score": 0.9, "params": {"lr": 0.01}}],
        metric_name="auc",
        direction="maximize",
    )
    return backend


@pytest.fixture(autouse=True)
def _thread_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: False)


@pytest.fixture(autouse=True)
def _no_thread_escapes(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Fail any test whose worker thread lets an exception escape."""
    escaped: list[BaseException | None] = []
    monkeypatch.setattr(
        threading, "excepthook", lambda args: escaped.append(args.exc_value)
    )
    yield
    assert escaped == []


def _count_terminal(job_store: JobStore, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record every terminal-metric outcome the store is asked to count."""
    counted: list[str] = []
    original = job_store.record_job_terminal

    def spy(job_type: str, outcome: str, **kwargs: Any) -> None:
        counted.append(outcome)
        original(job_type, outcome, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(job_store, "record_job_terminal", spy)
    return counted


def _data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(3, 2),
    )


def _claimed_job(job_store: JobStore, job_type: str) -> Job:
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config=_CONFIG,
        data_ref=_data_ref(),
        job_type=job_type,  # type: ignore[arg-type]
    )
    assert job is not None
    assert job_store.active_job_id == job.job_id
    return job


def _join(ws: WorkspaceState) -> None:
    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=15)
    assert not thread.is_alive()


def _assert_failed_and_released(
    job_store: JobStore, broadcaster: MagicMock, job_id: str, needle: str
) -> None:
    refreshed = job_store.get(job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error is not None and needle in refreshed.error
    assert refreshed.completed_at is not None
    assert job_store.active_job_id is None
    broadcaster.send_error.assert_called_once()
    assert broadcaster.send_error.call_args[0][0] == job_id
    # The slot is reusable: a new job claims it.
    assert (
        job_store.create_and_claim_active(
            backend_name="lizyml",
            config=_CONFIG,
            data_ref=_data_ref(),
            job_type="fit",
        )
        is not None
    )


def test_tune_preflight_exception_fails_job_and_releases_slot(
    job_store: JobStore, backend: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("synthetic preflight failure")

    monkeypatch.setattr(training_mod, "_run_pickle_preflight", boom)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "tune")
    ws = WorkspaceState(backend=backend)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    _assert_failed_and_released(
        job_store, broadcaster, job.job_id, "synthetic preflight failure"
    )
    backend.tune.assert_not_called()


def test_unpause_preflight_exception_fails_paused_job_and_releases_slot(
    job_store: JobStore, backend: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The unpause path starts from ``paused`` with the slot still held."""

    def boom(*_: Any, **__: Any) -> None:
        raise RuntimeError("synthetic preflight failure")

    monkeypatch.setattr(training_mod, "_run_pickle_preflight", boom)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "tune")
    job.status = "paused"
    seed_job(job_store, job)
    ws = WorkspaceState(backend=backend)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        resume_from_existing_study=True,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    _assert_failed_and_released(
        job_store, broadcaster, job.job_id, "synthetic preflight failure"
    )


@pytest.mark.parametrize("job_type", ["fit", "tune"])
def test_exception_escaping_run_job_core_fails_job_and_releases_slot(
    job_store: JobStore,
    backend: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
) -> None:
    """Defence in depth: anything raised around the core, not only the
    preflight, must still leave the job terminal and the slot free."""

    def boom(**_: Any) -> Any:
        raise RuntimeError("synthetic escape")

    monkeypatch.setattr(training_mod, "_run_job_core", boom)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, job_type)
    ws = WorkspaceState(backend=backend)
    start = start_fit_async if job_type == "fit" else start_tune_async

    start(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    _assert_failed_and_released(job_store, broadcaster, job.job_id, "synthetic escape")


def test_guard_does_not_overwrite_a_terminal_status(
    job_store: JobStore, backend: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A job already terminal when the exception escapes keeps its status
    (e.g. ``record_completion`` raising after the core stamped completed)."""

    def explode(*_: Any, **__: Any) -> None:
        raise RuntimeError("synthetic record_completion failure")

    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "fit")
    ws = WorkspaceState(backend=backend)
    monkeypatch.setattr(ws, "record_completion", explode)

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    refreshed = job_store.get(job.job_id)
    assert refreshed is not None
    assert refreshed.status == "completed"
    assert job_store.active_job_id is None
    broadcaster.send_error.assert_not_called()


def test_cleanup_runs_even_when_settling_the_job_raises(
    job_store: JobStore, backend: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The guard's own write fails too: the slot and the job's cancel and
    pause flags are still released, and nothing escapes the thread.

    P-0119 (#765 の片割れ; INV-LC-5): the release and the clears are now
    conditioned on the run's live token (``JobStore.abandon``), and the write
    failure is injected at the primitive's status writer
    (``JobMetadataStore.write_status_locked``), because ``update()`` no
    longer writes a status. The flags are set by the running worker (after
    admission), since a cancel accepted before admission settles the job.
    """

    def boom(**_: Any) -> Any:
        job_store.request_cancel(job.job_id)
        job_store.request_pause(job.job_id)
        monkeypatch.setattr(JobMetadataStore, "write_status_locked", broken_write)
        raise RuntimeError("synthetic escape")

    def broken_write(*_a: Any, **_k: Any) -> None:
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(training_mod, "_run_job_core", boom)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "tune")
    ws = WorkspaceState(backend=backend)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    assert job_store.active_job_id is None
    # Codex r1-3 (INV-LC-4 / Q6): no terminal was published, so the accepted
    # cancel stays durable (a restart's recover writes ``cancelled``); only
    # PAUSE is cleared. Before this fix the abandon cleared CANCEL too.
    assert job_store.is_cancel_requested(job.job_id) is True
    assert job_store.is_pause_requested(job.job_id) is False
    broadcaster.send_error.assert_not_called()


def test_a_failed_terminal_write_is_counted_and_broadcast_once(
    job_store: JobStore, backend: MagicMock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The core decides ``failed``, but persisting it raises. The guard
    persists and broadcasts the failure, and it is counted once.

    P-0119 §0.6: the injection moves from ``update()`` (which no longer
    writes a status) to the primitive's status writer; the one frame and
    the one metric now come from the commit that published the status.
    """
    backend.fit.side_effect = RuntimeError("synthetic fit failure")
    counted = _count_terminal(job_store, monkeypatch)
    original_write = JobMetadataStore.write_status_locked
    failed_writes = {"n": 0}

    def flaky_write(store: Any, job_id: str, status: str, **kwargs: Any) -> None:
        if status == "failed" and failed_writes["n"] == 0:
            failed_writes["n"] += 1
            raise OSError("synthetic disk failure")
        original_write(store, job_id, status, **kwargs)

    monkeypatch.setattr(JobMetadataStore, "write_status_locked", flaky_write)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "fit")
    ws = WorkspaceState(backend=backend)

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]}),
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    assert failed_writes["n"] == 1
    refreshed = job_store.get(job.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert counted == ["failed"]
    broadcaster.send_error.assert_called_once()
    assert broadcaster.send_error.call_args.args[0] == job.job_id
    # #767 case 3: exactly one terminal frame, so no completed frame either.
    broadcaster.send_completed.assert_not_called()
    assert job_store.active_job_id is None


def test_subprocess_reconcile_persists_before_broadcasting(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the reconcile write raises, no error frame has been sent yet, so
    the launcher's guard sends the only one.

    P-0119 §0.6: the reconcile is a commit of the run token; the injection
    moves to the primitive's status writer.
    """
    from lizystudio.services.subprocess_runner import _reconcile_subprocess_result

    job = _claimed_job(job_store, "fit")
    token = admit_running(job_store, job)
    broadcaster = MagicMock(spec=ProgressBroadcaster)

    def broken_write(*_a: Any, **_k: Any) -> None:
        raise OSError("synthetic disk failure")

    monkeypatch.setattr(JobMetadataStore, "write_status_locked", broken_write)
    with pytest.raises(OSError, match="synthetic disk failure"):
        _reconcile_subprocess_result(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            returncode=1,
            token=token,
        )
    broadcaster.send_error.assert_not_called()
