"""Additional tests for training service to push coverage to 85%+.

Targets:
- _make_cancel_aware_cb: CancelledError path (lines 39-42)
- _run_job_core: cancelled and failed branches with broadcaster (lines 88-103)
- _run_job_core: log file written to disk after job (lines 108-110)
- start_fit_async: thread is spawned and workspace state updated
- start_tune_async: thread is spawned and workspace state updated
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import (
    CancelledError,
    _make_cancel_aware_cb,
    _run_job_core,
    run_fit,
    run_tune,
    start_fit_async,
    start_tune_async,
)
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


@pytest.fixture()
def sample_df() -> pd.DataFrame:
    return pd.DataFrame({"x": [1, 2, 3], "y": [0, 1, 0]})


@pytest.fixture()
def mock_backend() -> MagicMock:
    backend = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.info.name = "lizyml"
    backend.fit.return_value = FitSummary(
        metrics={"auc": 0.9}, fold_count=5, params=[{"n_estimators": 100}]
    )
    backend.tune.return_value = TuningSummary(
        best_params={"lr": 0.01},
        best_score=0.95,
        trials=[{"number": 1, "score": 0.95, "params": {"lr": 0.01}}],
        metric_name="auc",
        direction="maximize",
    )
    backend.export_model.return_value = "/tmp/model"
    backend.validate_config.return_value = []
    return backend


@pytest.fixture()
def mock_broadcaster() -> MagicMock:
    return MagicMock(spec=ProgressBroadcaster)


# ---------------------------------------------------------------------------
# _make_cancel_aware_cb — CancelledError path
# ---------------------------------------------------------------------------


def test_cancel_aware_cb_raises_cancelled_error_when_cancel_requested(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """Callback must raise CancelledError when cancellation is requested."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job_store.request_cancel(job.job_id)

    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster=None)

    with pytest.raises(CancelledError):
        cb(current=1, total=10, message="step")


def test_cancel_aware_cb_forwards_progress_when_no_cancel(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_broadcaster: MagicMock,
) -> None:
    """Callback must call broadcaster.send_progress when no cancellation."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster=mock_broadcaster)
    cb(current=3, total=10, message="training")

    mock_broadcaster.send_progress.assert_called_once_with(
        job.job_id, current=3, total=10, message="training"
    )


def test_cancel_aware_cb_no_broadcaster_no_error(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """Callback must not raise when broadcaster is None and no cancel."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    cb = _make_cancel_aware_cb(job.job_id, job_store, broadcaster=None)
    # Should not raise
    cb(current=1, total=5, message="ok")


# ---------------------------------------------------------------------------
# _run_job_core — cancelled path (execute_fn raises CancelledError)
# ---------------------------------------------------------------------------


def test_run_job_core_cancelled_sets_status(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """When execute_fn raises CancelledError the job status becomes 'cancelled'."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def execute_fn(cb: Any) -> Any:
        raise CancelledError

    finished = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )

    assert finished.status == "cancelled"
    assert finished.completed_at is not None

    # Persisted state must reflect cancellation
    persisted = job_store.get(job.job_id)
    assert persisted is not None
    assert persisted.status == "cancelled"


def test_run_job_core_cancelled_notifies_broadcaster(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_broadcaster: MagicMock,
) -> None:
    """Broadcaster receives send_error with JOB_CANCELLED code on cancellation."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def execute_fn(cb: Any) -> Any:
        raise CancelledError

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        execute_fn=execute_fn,
    )

    mock_broadcaster.send_error.assert_called_once()
    call_kwargs = mock_broadcaster.send_error.call_args
    assert call_kwargs.kwargs.get("code") == "JOB_CANCELLED" or (
        len(call_kwargs.args) >= 3 and call_kwargs.args[2] == "JOB_CANCELLED"
    )


def test_run_job_core_failed_notifies_broadcaster(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_broadcaster: MagicMock,
) -> None:
    """Broadcaster receives send_error with sanitized message on generic failure."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def execute_fn(cb: Any) -> Any:
        raise RuntimeError("something went wrong")

    finished = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        execute_fn=execute_fn,
    )

    assert finished.status == "failed"
    mock_broadcaster.send_error.assert_called_once()
    # Sanitized message must contain the exception type but NOT the full traceback
    error_message = mock_broadcaster.send_error.call_args.args[1]
    assert "RuntimeError" in error_message
    assert "something went wrong" in error_message


def test_run_job_core_success_notifies_broadcaster(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_broadcaster: MagicMock,
) -> None:
    """Broadcaster receives send_completed on successful job."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    fit_result = FitSummary(metrics={"auc": 0.8}, fold_count=3, params=[])

    def execute_fn(cb: Any) -> Any:
        return fit_result, None, "/model"

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        execute_fn=execute_fn,
    )

    mock_broadcaster.send_completed.assert_called_once_with(job.job_id)


# ---------------------------------------------------------------------------
# Log file written after job
# ---------------------------------------------------------------------------


def test_run_job_core_writes_log_file_on_success(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """execution.log must be created inside {jobs_dir}/{job_id}/ after the job."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    fit_result = FitSummary(metrics={}, fold_count=1, params=[])

    def execute_fn(cb: Any) -> Any:
        return fit_result, None, "/model"

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )

    log_path = job_store.jobs_dir / job.job_id / "execution.log"
    assert log_path.exists(), "execution.log must exist after job completion"


def test_run_job_core_writes_log_file_on_failure(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """execution.log must be created even when the job fails."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def execute_fn(cb: Any) -> Any:
        raise ValueError("boom")

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )

    log_path = job_store.jobs_dir / job.job_id / "execution.log"
    assert log_path.exists(), "execution.log must exist even after job failure"


def test_run_job_core_writes_log_file_on_cancel(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """execution.log must be created even when the job is cancelled."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def execute_fn(cb: Any) -> Any:
        raise CancelledError

    _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=execute_fn,
    )

    log_path = job_store.jobs_dir / job.job_id / "execution.log"
    assert log_path.exists(), "execution.log must exist even after cancellation"


# ---------------------------------------------------------------------------
# start_fit_async — thread spawned and workspace state updated
# ---------------------------------------------------------------------------


def _make_workspace(backend: MagicMock) -> WorkspaceState:
    ws = WorkspaceState(backend=backend)
    return ws


def test_start_fit_async_returns_job_id(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """start_fit_async must return the job_id string immediately."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    ws = _make_workspace(mock_backend)

    returned_id = start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={"task": "binary"},
        dataframe=sample_df,
        job=job,
    )

    assert returned_id == job.job_id


def test_start_fit_async_updates_workspace_on_completion(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """After the background thread finishes, workspace_fit_result must be set."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    ws = _make_workspace(mock_backend)

    # Track when the thread writes the result
    result_written = threading.Event()
    original_fit = mock_backend.fit.return_value

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={"task": "binary"},
        dataframe=sample_df,
        job=job,
    )

    # Wait for the background thread to complete (up to 5 seconds)
    deadline = time.monotonic() + 5.0
    while ws.workspace_fit_result is None and time.monotonic() < deadline:
        time.sleep(0.05)

    assert ws.workspace_fit_result is not None
    assert ws.workspace_fit_result.metrics["auc"] == 0.9
    assert ws.workspace_tune_result is None
    assert ws.current_job_id == job.job_id


def test_start_fit_async_job_completed_in_store(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """After start_fit_async finishes, the job in the store must have status completed."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    ws = _make_workspace(mock_backend)

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={},
        dataframe=sample_df,
        job=job,
    )

    deadline = time.monotonic() + 5.0
    stored_status = "pending"
    while stored_status != "completed" and time.monotonic() < deadline:
        time.sleep(0.05)
        j = job_store.get(job.job_id)
        if j is not None:
            stored_status = j.status

    assert stored_status == "completed"


# ---------------------------------------------------------------------------
# start_tune_async — thread spawned and workspace state updated
# ---------------------------------------------------------------------------


def test_start_tune_async_returns_job_id(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """start_tune_async must return the job_id string immediately."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    ws = _make_workspace(mock_backend)

    returned_id = start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={"task": "binary"},
        dataframe=sample_df,
        job=job,
    )

    assert returned_id == job.job_id


def test_start_tune_async_updates_workspace_on_completion(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """After the background thread finishes, workspace_tune_result must be set."""
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    ws = _make_workspace(mock_backend)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={"task": "binary"},
        dataframe=sample_df,
        job=job,
    )

    deadline = time.monotonic() + 5.0
    while ws.workspace_tune_result is None and time.monotonic() < deadline:
        time.sleep(0.05)

    assert ws.workspace_tune_result is not None
    assert ws.workspace_tune_result.best_score == 0.95
    assert ws.workspace_fit_result is not None
    assert ws.current_job_id == job.job_id


def test_start_tune_async_job_completed_in_store(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """After start_tune_async finishes, the job in the store must have status completed."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    ws = _make_workspace(mock_backend)

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={},
        dataframe=sample_df,
        job=job,
    )

    deadline = time.monotonic() + 5.0
    stored_status = "pending"
    while stored_status != "completed" and time.monotonic() < deadline:
        time.sleep(0.05)
        j = job_store.get(job.job_id)
        if j is not None:
            stored_status = j.status

    assert stored_status == "completed"


# ---------------------------------------------------------------------------
# run_fit / run_tune cancel via callback (integration of cancel mechanism)
# ---------------------------------------------------------------------------


def test_run_fit_cancelled_via_cancel_flag(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """If cancellation is requested before fit is called, job ends as cancelled."""

    def fit_side_effect(model: Any, *, params: Any, on_progress: Any) -> FitSummary:
        # Invoke the callback — it should raise CancelledError
        on_progress(current=0, total=10, message="starting")
        return FitSummary(metrics={}, fold_count=1, params=[])  # never reached

    mock_backend.fit.side_effect = fit_side_effect

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job_store.request_cancel(job.job_id)

    result = run_fit(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
    )

    assert result.status == "cancelled"


def test_run_tune_cancelled_via_cancel_flag(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """If cancellation is requested before tune is called, job ends as cancelled."""

    def tune_side_effect(model: Any, *, on_progress: Any) -> TuningSummary:
        on_progress(current=0, total=50, message="tuning")
        return MagicMock()  # never reached

    mock_backend.tune.side_effect = tune_side_effect

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job_store.request_cancel(job.job_id)

    result = run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={},
        dataframe=sample_df,
    )

    assert result.status == "cancelled"
