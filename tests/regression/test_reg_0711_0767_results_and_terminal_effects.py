"""Regressions for Issues #711 and #767, re-checked against P-0119 (#768).

#711: a client polled ``GET /jobs/{id}`` and read ``completed`` with
``tune_result: null``. ``JobMetadataStore.update`` wrote ``meta.json`` (the
status) before the result sidecars, so a read between the two saw the status
without its results. P-0119 writes the results status-free first and lets
the primitive publish the status afterwards, in both process modes. The two
``test_results_are_on_disk_*`` tests pin that order at the moment the
``completed`` status is written.

#767: the terminal frame and the terminal metric were inferred from the
stored status, so a storage write that raised part-way could lose one of
them. P-0119 emits both from the commit that published the status. The
other tests pin the acceptance criteria of #767 in that shape:

- case 1: the completion's results write raises, so the outcome becomes
  ``failed``; one error frame and one ``failed`` metric, no completed frame;
- case 2: on the subprocess missing-data path the first ``failed`` status
  write raises before it lands; the guard's retry publishes it, with one
  error frame and one metric.

Case 3 stays pinned by
``test_reg_0612_pre_core_exception_releases_slot.py::test_a_failed_terminal_write_is_counted_and_broadcast_once``.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

import lizystudio.services._job_metadata as metadata_mod
import lizystudio.services.openmp_detect as openmp_detect_mod
from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services._job_lifecycle_types import Outcome
from lizystudio.services._job_metadata import JobMetadataStore
from lizystudio.services._job_outcome_file import write_outcome
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.subprocess_runner import _reconcile_subprocess_result
from lizystudio.services.training import start_fit_async, start_tune_async
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster
from tests.lifecycle_seed import admit_running, reserve_for_launch

pytestmark = pytest.mark.unit

_CONFIG: dict[str, Any] = {
    "task": "binary",
    "model": {"name": "lgbm", "params": {"n_estimators": 10}},
}
_FIT = FitSummary(metrics={"auc": 0.9}, fold_count=2, params=[{"n_estimators": 10}])
_TUNE = TuningSummary(
    best_params={"lr": 0.01},
    best_score=0.9,
    trials=[{"number": 0, "score": 0.9, "params": {"lr": 0.01}}],
    metric_name="auc",
    direction="maximize",
)


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def backend() -> MagicMock:
    backend = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.fit.return_value = _FIT
    backend.tune.return_value = _TUNE
    return backend


@pytest.fixture()
def use_subprocess(monkeypatch: pytest.MonkeyPatch) -> dict[str, bool]:
    mode = {"subprocess": False}
    monkeypatch.setattr(
        openmp_detect_mod, "should_use_subprocess", lambda: mode["subprocess"]
    )
    return mode


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
    counted: list[str] = []
    original = job_store.record_job_terminal

    def spy(job_type: str, outcome: str, **kwargs: Any) -> None:
        counted.append(outcome)
        original(job_type, outcome, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(job_store, "record_job_terminal", spy)
    return counted


def _results_at_completed_write(monkeypatch: pytest.MonkeyPatch) -> list[bool]:
    """Record, for the ``meta.json`` write that first publishes ``completed``,
    whether the job's result sidecars were already on disk.

    Every ``meta.json`` write goes through :meth:`JobMetadataStore.save_meta`
    (the primitive's ``write_status_locked`` and the status-free ``update``
    alike), so the spy sees the publication whichever writer makes it.
    """
    seen: list[bool] = []
    original = JobMetadataStore.save_meta

    def spy(store: JobMetadataStore, job: Job) -> None:
        meta = store.path_for(job.job_id, "meta")
        before = store.load_job(job.job_id).status if meta.exists() else None
        if job.status == "completed" and before != "completed":
            seen.append(store.path_for(job.job_id, "fit_result").exists())
            if job.job_type == "tune":
                seen.append(store.path_for(job.job_id, "tune_result").exists())
        original(store, job)

    monkeypatch.setattr(JobMetadataStore, "save_meta", spy)
    return seen


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
    return job


def _join(ws: WorkspaceState) -> None:
    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=30)
    assert not thread.is_alive()


def _frame_counts(broadcaster: MagicMock, job_id: str) -> tuple[int, int]:
    """(completed frames, error frames); every frame must target *job_id*."""
    for sent in (broadcaster.send_completed, broadcaster.send_error):
        for call in sent.call_args_list:
            assert call.args[0] == job_id
    return broadcaster.send_completed.call_count, broadcaster.send_error.call_count


# --- #711: results are on disk before ``completed`` is published -----------


@pytest.mark.parametrize("job_type", ["fit", "tune"])
def test_results_are_on_disk_before_completed_is_written_in_thread_mode(
    job_store: JobStore,
    backend: MagicMock,
    use_subprocess: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
    job_type: str,
) -> None:
    seen = _results_at_completed_write(monkeypatch)
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

    stored = job_store.get(job.job_id)
    assert stored is not None
    assert stored.status == "completed"
    # One ``completed`` write; a tune checks both sidecars at it.
    assert seen == ([True] if job_type == "fit" else [True, True])
    assert _frame_counts(broadcaster, job.job_id) == (1, 0)


def test_results_are_on_disk_before_completed_is_written_in_subprocess_mode(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    seen = _results_at_completed_write(monkeypatch)
    job = _claimed_job(job_store, "tune")
    token = admit_running(job_store, job)
    write_outcome(
        job_store.path_for(job.job_id, "outcome"),
        run_gen=token.run_gen,
        outcome=Outcome(status="completed"),
        fit_result=_FIT,
        tune_result=_TUNE,
        model_path=None,
    )
    broadcaster = MagicMock(spec=ProgressBroadcaster)

    _reconcile_subprocess_result(
        job=job,
        job_store=job_store,
        broadcaster=broadcaster,
        returncode=0,
        token=token,
    )

    stored = job_store.get(job.job_id)
    assert stored is not None
    assert stored.status == "completed"
    assert stored.tune_result is not None
    assert seen == [True, True]
    assert _frame_counts(broadcaster, job.job_id) == (1, 0)


# --- #767: one terminal frame and one metric when a write fails -------------


def test_a_failed_results_write_fails_the_job_with_one_frame_and_one_metric(
    job_store: JobStore,
    backend: MagicMock,
    use_subprocess: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """#767 case 1: the completion's ``fit_result.json`` sidecar write raises
    once, inside the real :meth:`JobMetadataStore.update`."""
    counted = _count_terminal(job_store, monkeypatch)
    original_write = metadata_mod.write_job_json
    failed = {"n": 0}

    def flaky_write_job_json(path: Path, payload: Any) -> None:
        if path.name == "fit_result.json" and failed["n"] == 0:
            failed["n"] += 1
            raise OSError("synthetic sidecar failure")
        original_write(path, payload)

    monkeypatch.setattr(metadata_mod, "write_job_json", flaky_write_job_json)
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

    assert failed["n"] == 1
    stored = job_store.get(job.job_id)
    assert stored is not None
    assert stored.status == "failed"
    assert "synthetic sidecar failure" in (stored.error or "")
    assert counted == ["failed"]
    assert _frame_counts(broadcaster, job.job_id) == (0, 1)
    assert job_store.active_job_id is None


def test_a_failed_missing_data_write_is_retried_with_one_frame_and_one_metric(
    job_store: JobStore,
    backend: MagicMock,
    use_subprocess: dict[str, bool],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """#767 case 2: subprocess mode, no data loaded, and the first ``failed``
    status write raises before it lands."""
    use_subprocess["subprocess"] = True
    counted = _count_terminal(job_store, monkeypatch)
    original_write = JobMetadataStore.write_status_locked
    failed = {"n": 0}

    def flaky_write(
        store: JobMetadataStore, job_id: str, status: str, **kwargs: Any
    ) -> None:
        if status == "failed" and failed["n"] == 0:
            failed["n"] += 1
            raise OSError("synthetic disk failure")
        original_write(store, job_id, status, **kwargs)

    monkeypatch.setattr(JobMetadataStore, "write_status_locked", flaky_write)
    broadcaster = MagicMock(spec=ProgressBroadcaster)
    job = _claimed_job(job_store, "fit")
    ws = WorkspaceState(backend=backend)
    assert ws.data_ref is None

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=broadcaster,
        config=_CONFIG,
        dataframe=None,
        job=job,
        reset_gen=reserve_for_launch(job_store, job),
    )
    _join(ws)

    assert failed["n"] == 1
    stored = job_store.get(job.job_id)
    assert stored is not None
    assert stored.status == "failed"
    assert counted == ["failed"]
    assert _frame_counts(broadcaster, job.job_id) == (0, 1)
    assert job_store.active_job_id is None
