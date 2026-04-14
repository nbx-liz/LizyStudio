"""Additional tests for training service to push coverage to 85%+.

Targets:
- _make_cancel_aware_cb: CancelledError path (lines 39-42)
- _run_job_core: cancelled and failed branches with broadcaster (lines 88-103)
- _run_job_core: log file written to disk after job (lines 108-110)
- start_fit_async: thread is spawned and workspace state updated
- start_tune_async: thread is spawned and workspace state updated
"""

from __future__ import annotations

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
    run_retune,
    run_tune,
    start_fit_async,
    start_retune_async,
    start_tune_async,
)
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster

pytestmark = pytest.mark.unit

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
        job.job_id,
        current=3,
        total=10,
        message="training",
        fold_results=None,
        trial_results=None,
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
    """start_fit_async sets job status to completed."""
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
    """start_tune_async sets job status to completed."""
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

    def tune_side_effect(
        model: Any, *, on_progress: Any, re_tune: Any = None, **_: Any
    ) -> TuningSummary:
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


def test_run_tune_multi_round_cancelled_between_rounds(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """Cancelling mid-round propagates through the next round-boundary callback."""
    call_count = {"n": 0}

    def tune_side_effect(
        model: Any, *, on_progress: Any, re_tune: Any = None, **_: Any
    ) -> TuningSummary:
        call_count["n"] += 1
        # First round completes normally
        if call_count["n"] == 1:
            on_progress(current=10, total=10, message="round 1 done")
            return TuningSummary(
                best_params={"lr": 0.1},
                best_score=0.9,
                trials=[],
                metric_name="auc",
                direction="maximize",
            )
        # Before second round starts, the cb call should raise CancelledError
        on_progress(current=0, total=0, message="starting round 2")
        raise AssertionError("should not reach here — cancellation should hit first")

    mock_backend.tune.side_effect = tune_side_effect

    job = job_store.create(
        backend_name="lizyml",
        config={"tuning": {"re_tune": {"n_rounds": 3}}},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    # Request cancel before the job starts so the first round's
    # progress cb fires the check.
    job_store.request_cancel(job.job_id)

    result = run_tune(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        config={"tuning": {"re_tune": {"n_rounds": 3}}},
        dataframe=sample_df,
    )

    assert result.status == "cancelled"


# ---------------------------------------------------------------------------
# Active job tracking (concurrency control)
# ---------------------------------------------------------------------------


def test_claim_active_prevents_second_job(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """Second job should fail when another job already holds the active slot."""
    job1 = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job2 = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    assert job_store.claim_active(job1.job_id) is True
    assert job_store.has_active_job() is True
    assert job_store.active_job_id == job1.job_id

    assert job_store.claim_active(job2.job_id) is False

    job_store.release_active(job1.job_id)
    assert job_store.has_active_job() is False
    assert job_store.claim_active(job2.job_id) is True
    job_store.release_active(job2.job_id)


def test_run_job_core_fails_when_active_slot_taken(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> None:
    """_run_job_core should fail the job if claim_active returns False."""
    from lizystudio.services.training import _run_job_core

    job_store.claim_active("blocker-job")

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def never_called(cb: Any) -> tuple[FitSummary, None, str]:
        raise AssertionError("Should not be called")

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=None,
        execute_fn=never_called,
    )

    assert result.status == "failed"
    assert "already running" in (result.error or "")
    assert job_store.active_job_id == "blocker-job"
    job_store.release_active("blocker-job")


def test_run_job_core_job_conflict_notifies_broadcaster(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_broadcaster: MagicMock,
) -> None:
    """_run_job_core: send_error with JOB_CONFLICT when slot taken."""
    job_store.claim_active("blocker-job")

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    def never_called(cb: Any) -> tuple[FitSummary, None, str]:
        raise AssertionError("Should not be called")

    result = _run_job_core(
        job=job,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        execute_fn=never_called,
    )

    assert result.status == "failed"
    mock_broadcaster.send_error.assert_called_once()
    call_args = mock_broadcaster.send_error.call_args
    assert call_args.kwargs.get("code") == "JOB_CONFLICT"
    job_store.release_active("blocker-job")


# ---------------------------------------------------------------------------
# _run_subprocess_job — no data_ref path
# ---------------------------------------------------------------------------


def test_run_subprocess_job_no_data_ref_sets_failed_status(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """_run_subprocess_job must set job status=failed when ws.data_ref is None."""
    from lizystudio.services.training import _run_subprocess_job
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=mock_backend)
    assert ws.data_ref is None  # no data loaded

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    _run_subprocess_job(ws, job, job_store, mock_broadcaster)

    assert job.status == "failed"
    assert "No data loaded" in (job.error or "")
    assert ws.current_job_id == job.job_id
    mock_broadcaster.send_error.assert_called_once_with(job.job_id, job.error)


# ---------------------------------------------------------------------------
# start_fit_async / start_tune_async — subprocess path
# ---------------------------------------------------------------------------


def test_start_fit_async_subprocess_path(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """start_fit_async calls _run_subprocess_job in subprocess mode."""
    import lizystudio.services.training as training_mod
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=mock_backend)
    ws.data_ref = sample_data_ref  # provide data ref so subprocess path succeeds

    called = {}

    def fake_subprocess_job(
        ws2: Any,
        job2: Any,
        job_store2: Any,
        broadcaster2: Any,
    ) -> None:
        called["invoked"] = True
        with ws2._lock:
            ws2.current_job_id = job2.job_id

    import lizystudio.services.openmp_detect as openmp_detect_mod

    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: True)
    monkeypatch.setattr(training_mod, "_run_subprocess_job", fake_subprocess_job)

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    start_fit_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={},
        dataframe=sample_df,
        job=job,
    )

    if ws._job_thread:
        ws._job_thread.join(timeout=5)

    assert called.get("invoked") is True


def test_start_tune_async_subprocess_path(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """start_tune_async calls _run_subprocess_job in subprocess mode."""
    import lizystudio.services.training as training_mod
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=mock_backend)
    ws.data_ref = sample_data_ref

    called = {}

    def fake_subprocess_job(
        ws2: Any,
        job2: Any,
        job_store2: Any,
        broadcaster2: Any,
    ) -> None:
        called["invoked"] = True
        with ws2._lock:
            ws2.current_job_id = job2.job_id

    import lizystudio.services.openmp_detect as openmp_detect_mod

    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: True)
    monkeypatch.setattr(training_mod, "_run_subprocess_job", fake_subprocess_job)

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )

    start_tune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        config={},
        dataframe=sample_df,
        job=job,
    )

    if ws._job_thread:
        ws._job_thread.join(timeout=5)

    assert called.get("invoked") is True


# ---------------------------------------------------------------------------
# _run_subprocess_job — success path (lines 234-245)
# ---------------------------------------------------------------------------


def test_run_subprocess_job_success_updates_workspace(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """_run_subprocess_job success updates workspace state."""
    from lizystudio.services.training import _run_subprocess_job
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=mock_backend)
    ws.data_ref = sample_data_ref  # data_ref with path set

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )

    fit_result = FitSummary(metrics={"auc": 0.88}, fold_count=3, params=[])
    finished_job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    finished_job.fit_result = fit_result
    finished_job.tune_result = None
    finished_job.status = "completed"

    import lizystudio.services.subprocess_runner as subprocess_runner_mod

    monkeypatch.setattr(
        subprocess_runner_mod,
        "run_job_in_subprocess",
        lambda **_kwargs: finished_job,
    )

    _run_subprocess_job(ws, job, job_store, mock_broadcaster)

    assert ws.workspace_fit_result is fit_result
    assert ws.workspace_tune_result is None
    assert ws.current_job_id == finished_job.job_id


# --- _prepare_tune_config tests ---


class TestPrepareTuneConfig:
    """Unit tests for _prepare_tune_config."""

    def test_merges_tuning_evaluation_to_top_level(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "evaluation": {"metrics": ["rmse"]},
            "tuning": {
                "optuna": {"params": {"n_trials": 50}, "space": {}},
                "evaluation": {"metrics": ["auc", "f1"]},
            },
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"] == {"metrics": ["auc", "f1"]}

    def test_merges_tuning_model_params(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"params": {"n_estimators": 1000}},
            "tuning": {
                "optuna": {"params": {}, "space": {}},
                "model_params": {"learning_rate": 0.01},
            },
        }
        result = _prepare_tune_config(config)
        assert result["model"]["params"]["n_estimators"] == 1000
        assert result["model"]["params"]["learning_rate"] == 0.01

    def test_strips_internal_keys_from_model_params(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "tuning": {
                "optuna": {"params": {}, "space": {}},
                "model_params": {"lr": 0.01, "_precision_at_k_k": 10},
            },
        }
        result = _prepare_tune_config(config)
        assert "_precision_at_k_k" not in result.get("model", {}).get("params", {})

    def test_merges_tuning_training(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "training": {"seed": 42},
            "tuning": {
                "optuna": {"params": {}, "space": {}},
                "training": {"validation_ratio": 0.2},
            },
        }
        result = _prepare_tune_config(config)
        assert result["training"]["seed"] == 42
        assert result["training"]["validation_ratio"] == 0.2

    def test_injects_default_metric_when_evaluation_empty(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "tuning": {"optuna": {"params": {"n_trials": 50}, "space": {}}},
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["auc"]

    def test_injects_default_metric_regression(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "regression",
            "tuning": {"optuna": {"params": {}, "space": {}}},
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["rmse"]

    def test_resolves_direction_maximize_for_auc(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "tuning": {
                "optuna": {"params": {"n_trials": 50}, "space": {}},
                "evaluation": {"metrics": ["auc"]},
            },
        }
        result = _prepare_tune_config(config)
        assert result["tuning"]["optuna"]["params"]["direction"] == "maximize"

    def test_resolves_direction_minimize_for_rmse(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "regression",
            "tuning": {
                "optuna": {"params": {}, "space": {}},
                "evaluation": {"metrics": ["rmse"]},
            },
        }
        result = _prepare_tune_config(config)
        assert result["tuning"]["optuna"]["params"]["direction"] == "minimize"

    def test_overwrites_inconsistent_direction(self) -> None:
        """Bug 2026-04-14: a stale ``direction`` that contradicts the
        evaluation metric must be normalized, not preserved.

        The previous behavior preserved any user-supplied direction
        (rmse + ``direction: maximize`` was kept as maximize). That
        sounded reasonable for a hypothetical "power user override"
        but in practice it let the workspace inject path's hardcoded
        ``direction: minimize`` slip through for AUC tuning, which
        produced silently wrong results. The new contract is "metric
        is the single source of truth" and ``_prepare_tune_config``
        always reconciles direction with the optimization metric.
        """
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "regression",
            "tuning": {
                "optuna": {
                    "params": {"n_trials": 50, "direction": "maximize"},
                    "space": {},
                },
                "evaluation": {"metrics": ["rmse"]},
            },
        }
        result = _prepare_tune_config(config)
        # rmse is naturally minimize -- the stale "maximize" is reconciled.
        assert result["tuning"]["optuna"]["params"]["direction"] == "minimize"

    def test_cleans_tuning_section(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "tuning": {
                "optuna": {"params": {}, "space": {}},
                "evaluation": {"metrics": ["auc"]},
                "model_params": {"lr": 0.01},
                "training": {"seed": 1},
            },
        }
        result = _prepare_tune_config(config)
        # Only optuna should remain in tuning
        assert set(result["tuning"].keys()) == {"optuna"}

    def test_no_tuning_section(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {"task": "binary"}
        result = _prepare_tune_config(config)
        # Should not crash; evaluation should get default metric
        assert result["evaluation"]["metrics"] == ["auc"]

    def test_unknown_task_uses_empty_default_metric(self) -> None:
        """Unknown task type must not inject a default metric."""
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "unknown_task",
            "tuning": {"optuna": {"params": {}, "space": {}}},
        }
        result = _prepare_tune_config(config)
        # No preferred metric → evaluation section should NOT be added
        assert "evaluation" not in result or result.get("evaluation") == {}

    def test_dict_form_metric_resolves_direction(self) -> None:
        """Direction resolved from first metric when it is a dict (not str)."""
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "binary",
            "tuning": {
                "optuna": {"params": {"n_trials": 10}, "space": {}},
                "evaluation": {"metrics": [{"auc": {}}]},
            },
        }
        result = _prepare_tune_config(config)
        # {"auc": {}} → first key is "auc" → maximize
        assert result["tuning"]["optuna"]["params"]["direction"] == "maximize"

    def test_multiclass_task_uses_auc_metric(self) -> None:
        from lizystudio.services.training import _prepare_tune_config

        config: dict[str, Any] = {
            "task": "multiclass",
            "tuning": {"optuna": {"params": {}, "space": {}}},
        }
        result = _prepare_tune_config(config)
        assert result["evaluation"]["metrics"] == ["auc"]


# ---------------------------------------------------------------------------
# _save_tuning_plot
# ---------------------------------------------------------------------------


class TestSaveTuningPlot:
    """Unit tests for _save_tuning_plot."""

    def test_saves_plot_json_to_disk(self, tmp_path: Path) -> None:
        """Successful call writes plotly_json to tuning_plot.json."""
        from unittest.mock import MagicMock

        from lizystudio.backends.types import PlotData
        from lizystudio.services.training import _save_tuning_plot

        backend = MagicMock()
        model = MagicMock()
        backend.plot.return_value = PlotData(plotly_json='{"data":[]}')

        job_dir = tmp_path / "job_abc"
        job_dir.mkdir()
        _save_tuning_plot(backend, model, job_dir)

        plot_path = job_dir / "tuning_plot.json"
        assert plot_path.exists()
        assert plot_path.read_text(encoding="utf-8") == '{"data":[]}'
        backend.plot.assert_called_once_with(model, "tuning")

    def test_logs_warning_on_backend_error(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        """When backend.plot raises, a warning is logged and no exception propagates."""
        import logging
        from unittest.mock import MagicMock

        from lizystudio.services.training import _save_tuning_plot

        backend = MagicMock()
        model = MagicMock()
        backend.plot.side_effect = RuntimeError("No study data")

        job_dir = tmp_path / "job_err"
        job_dir.mkdir()

        # Must NOT raise — _save_tuning_plot catches all exceptions (BLE001)
        with caplog.at_level(logging.WARNING, logger="lizystudio.services.training"):
            _save_tuning_plot(backend, model, job_dir)

        # Warning should have been emitted
        assert any("Failed to save tuning plot" in r.message for r in caplog.records)
        # File must not have been written
        assert not (job_dir / "tuning_plot.json").exists()

    def test_suppresses_backend_exception(self, tmp_path: Path) -> None:
        """_save_tuning_plot must suppress exceptions (BLE001 catch-all)."""
        from unittest.mock import MagicMock

        from lizystudio.services.training import _save_tuning_plot

        backend = MagicMock()
        model = MagicMock()
        backend.plot.side_effect = ValueError("oops")

        job_dir = tmp_path / "job_suppress"
        job_dir.mkdir()

        # No exception should propagate
        _save_tuning_plot(backend, model, job_dir)

        # File should not have been written
        assert not (job_dir / "tuning_plot.json").exists()


# ---------------------------------------------------------------------------
# _prepare_autofit_config
# ---------------------------------------------------------------------------


class TestPrepareAutofitConfig:
    """Unit tests for _prepare_autofit_config."""

    def test_merges_best_params_into_model_params(self) -> None:
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"name": "lgbm", "params": {"n_estimators": 1000}},
        }
        best_params = {"learning_rate": 0.05, "num_leaves": 64}
        result = _prepare_autofit_config(config, best_params)

        assert result["model"]["params"]["n_estimators"] == 1000
        assert result["model"]["params"]["learning_rate"] == 0.05
        assert result["model"]["params"]["num_leaves"] == 64

    def test_strips_tuning_section(self) -> None:
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"params": {}},
            "tuning": {"optuna": {"params": {"n_trials": 50}}},
        }
        result = _prepare_autofit_config(config, {})
        assert "tuning" not in result

    def test_does_not_mutate_original_config(self) -> None:
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"params": {"n_estimators": 100}},
        }
        original_params = dict(config["model"]["params"])  # type: ignore[index]
        _prepare_autofit_config(config, {"learning_rate": 0.01})

        assert config["model"]["params"] == original_params  # type: ignore[index]

    def test_empty_best_params(self) -> None:
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"params": {"n_estimators": 500}},
        }
        result = _prepare_autofit_config(config, {})
        assert result["model"]["params"] == {"n_estimators": 500}

    def test_no_model_section_in_config(self) -> None:
        """_prepare_autofit_config handles config with no model key."""
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {"task": "binary"}
        result = _prepare_autofit_config(config, {"lr": 0.1})
        assert result["model"]["params"] == {"lr": 0.1}

    def test_best_params_override_existing(self) -> None:
        """best_params must overwrite existing model.params values."""
        from lizystudio.services.training import _prepare_autofit_config

        config: dict[str, Any] = {
            "task": "binary",
            "model": {"params": {"learning_rate": 0.1, "n_estimators": 100}},
        }
        result = _prepare_autofit_config(config, {"learning_rate": 0.001})
        assert result["model"]["params"]["learning_rate"] == 0.001
        assert result["model"]["params"]["n_estimators"] == 100


# ---------------------------------------------------------------------------
# H-0062: run_retune + start_retune_async tests
# ---------------------------------------------------------------------------


def _make_tune_parent_with_checkpoint(
    job_store: JobStore,
    sample_data_ref: DataRef,
) -> Any:
    """Create a completed tune parent with a fake model.pkl + meta."""
    parent = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "model": {"name": "lgbm", "params": {}},
            "tuning": {"optuna": {"params": {"n_trials": 50}}},
        },
        data_ref=sample_data_ref,
        job_type="tune",
    )
    parent.status = "completed"
    job_store.update(parent)
    # Drop a fake checkpoint next to the meta.
    parent_dir = job_store.jobs_dir / parent.job_id
    (parent_dir / "model.pkl").write_bytes(b"fake")
    return parent


def test_run_retune_copies_checkpoint_and_returns_completed_job(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """run_retune must copy the parent checkpoint into the child dir,
    call adapter.load_checkpoint, run tune with resume=True, then
    auto-fit and export. On success the job status is "completed"."""
    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )

    # load_checkpoint returns a mock model used by the tune call.
    loaded_model = MagicMock(name="loaded_model")
    mock_backend.load_checkpoint.return_value = loaded_model

    result = run_retune(
        parent_job=parent,
        child_job=child,
        job_store=job_store,
        backend=mock_backend,
        dataframe=sample_df,
        n_trials=10,
        expand_boundary=True,
        boundary_threshold=0.05,
        broadcaster=None,
    )

    assert result.status == "completed"
    assert result.tune_result is not None
    assert result.fit_result is not None

    # Verify the adapter was called with resume=True and the child dir.
    mock_backend.load_checkpoint.assert_called_once()
    load_arg = mock_backend.load_checkpoint.call_args[0][0]
    assert load_arg == job_store.jobs_dir / child.job_id

    tune_calls = mock_backend.tune.call_args_list
    assert len(tune_calls) == 1
    tune_kwargs = tune_calls[0].kwargs
    assert tune_kwargs.get("resume") is True
    assert tune_kwargs.get("checkpoint_dir") == job_store.jobs_dir / child.job_id
    re_tune_block = tune_kwargs.get("re_tune")
    assert re_tune_block["n_rounds"] == 1
    assert re_tune_block["n_trials"] == 10
    assert re_tune_block["expand_boundary"] is True
    assert re_tune_block["boundary_threshold"] == 0.05

    # The child directory must now contain the copied model.pkl so a
    # subsequent load would succeed on its own.
    assert (job_store.jobs_dir / child.job_id / "model.pkl").exists()


def test_run_retune_marks_child_failed_when_load_checkpoint_raises(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
) -> None:
    """A PickleIncompatibleError bubbling up from load_checkpoint must
    be captured by _run_job_core and stored in child.error."""
    from lizystudio.backends.lizyml import PickleIncompatibleError

    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )

    mock_backend.load_checkpoint.side_effect = PickleIncompatibleError(
        "simulated version mismatch"
    )

    result = run_retune(
        parent_job=parent,
        child_job=child,
        job_store=job_store,
        backend=mock_backend,
        dataframe=sample_df,
        n_trials=10,
        expand_boundary=None,
        boundary_threshold=None,
        broadcaster=None,
    )

    assert result.status == "failed"
    assert result.error is not None
    assert "simulated version mismatch" in result.error


def test_start_retune_async_fails_fast_when_ws_dataframe_none(
    job_store: JobStore,
    sample_data_ref: DataRef,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """When ws.dataframe is None, start_retune_async must not spawn a
    thread — it marks the child as failed inline, releases the parent
    lock, and sets ws.current_job_id to the child."""
    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    # No dataframe loaded.
    assert ws.dataframe is None

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    returned_id = start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=5,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )

    assert returned_id == child.job_id
    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error is not None and "No data" in refreshed.error
    # Lock released, workspace selection on the child.
    assert job_store.get_locked_child(parent.job_id) is None
    assert ws.current_job_id == child.job_id
    mock_broadcaster.send_error.assert_called_once()


def test_start_retune_async_spawns_thread_and_updates_workspace(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """Full happy path: ws.dataframe is set, run_retune returns a
    completed child, workspace fit/tune results are updated, and the
    parent lock is released in the finally block."""
    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df

    loaded_model = MagicMock(name="loaded_model")
    mock_backend.load_checkpoint.return_value = loaded_model

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    returned_id = start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=10,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )
    assert returned_id == child.job_id

    # Wait for the background thread to finish; _JOIN_TIMEOUT is 30s
    # which is plenty for the mocked adapter path.
    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=15)
    assert not thread.is_alive(), "retune thread did not finish in time"

    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "completed"
    assert ws.current_job_id == child.job_id
    assert ws.workspace_fit_result is not None
    assert ws.workspace_tune_result is not None
    # Lock released in the finally block.
    assert job_store.get_locked_child(parent.job_id) is None


def test_start_retune_async_releases_lock_even_on_run_retune_error(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """If run_retune raises inside the worker thread, the finally
    block must still release the per-parent lock."""
    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df

    # Make load_checkpoint raise inside the thread; run_retune catches
    # it via _run_job_core and marks the child failed.
    mock_backend.load_checkpoint.side_effect = RuntimeError("boom")

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=5,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )
    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=15)
    assert not thread.is_alive()

    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert job_store.get_locked_child(parent.job_id) is None


# ---------------------------------------------------------------------------
# H-0062 Bugfix 2026-04-14: start_retune_async must honour OpenMP
# subprocess mode. Running lizyml tune in a daemon thread when OpenMP is
# present causes ~8-50× slowdown because the OpenMP thread pool binds to
# the first thread. start_fit_async / start_tune_async already dispatch
# to subprocess; retune was missing the same branch.
# ---------------------------------------------------------------------------


def test_start_retune_async_subprocess_path_when_openmp_present(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When should_use_subprocess() returns True, start_retune_async
    must invoke the subprocess runner instead of calling run_retune
    directly in a daemon thread."""
    import lizystudio.services.openmp_detect as openmp_detect_mod
    import lizystudio.services.training as training_mod

    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df
    # Retune subprocess mode requires a resolvable data_path. The fixture
    # sets path on the DataRef which is enough for the API layer.
    ws.data_ref = sample_data_ref

    called: dict[str, Any] = {}

    def fake_retune_subprocess(
        *,
        ws: Any,
        job_store: Any,
        broadcaster: Any,
        parent_job: Any,
        child_job: Any,
        n_trials: int,
        expand_boundary: Any,
        boundary_threshold: Any,
    ) -> Any:
        called["invoked"] = True
        called["parent_id"] = parent_job.job_id
        called["child_id"] = child_job.job_id
        called["n_trials"] = n_trials
        # Simulate a subprocess that completed the child job.
        child_job.status = "completed"
        child_job.fit_result = None
        child_job.tune_result = None
        job_store.update(child_job)
        with ws._lock:
            ws.current_job_id = child_job.job_id
        return child_job

    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: True)
    monkeypatch.setattr(
        training_mod, "_run_retune_subprocess", fake_retune_subprocess, raising=False
    )

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=7,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )

    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=15)
    assert not thread.is_alive()

    assert called.get("invoked") is True, (
        "start_retune_async did not dispatch to the subprocess path "
        "despite should_use_subprocess() returning True"
    )
    assert called["parent_id"] == parent.job_id
    assert called["child_id"] == child.job_id
    assert called["n_trials"] == 7
    assert mock_backend.load_checkpoint.call_count == 0, (
        "subprocess path must not call backend.load_checkpoint in the parent "
        "process — that work happens inside the child process"
    )
    # Lock released in the finally block.
    assert job_store.get_locked_child(parent.job_id) is None


def test_start_retune_async_rejects_in_memory_dataset_in_subprocess_mode(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """H-0062 Bugfix 2026-04-14: in subprocess mode the child reads the
    dataframe from disk, so a dataset without a path (in-memory upload)
    must fail inline with an explicit error instead of silently running
    in the thread path (which would still be ~8× slower)."""
    import lizystudio.services.openmp_detect as openmp_detect_mod

    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df
    # data_ref.path missing / empty — simulates the in-memory-upload case
    # that fails in the subprocess path because the child needs a file.
    from lizystudio.backends.types import DataRef

    ws.data_ref = DataRef(
        source_type="upload",
        path=None,
        filename="mem.csv",
        fingerprint="mem",
        shape=(10, 3),
    )

    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: True)

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    returned = start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=5,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )

    assert returned == child.job_id
    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error is not None
    assert "file-backed" in refreshed.error.lower()
    assert ws.current_job_id == child.job_id
    assert job_store.get_locked_child(parent.job_id) is None
    mock_broadcaster.send_error.assert_called_once()


def test_run_retune_subprocess_helper_fails_child_on_missing_data_ref_path(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
) -> None:
    """Direct unit test for _run_retune_subprocess: when the caller
    violates the contract by passing a ws with a missing data_ref.path,
    the helper must mark the child as ``failed`` via the shared
    ``_mark_retune_child_failed`` helper instead of raising
    AssertionError. H-0062 Bugfix 2026-04-14 (6): the old ``assert``
    left the child in ``pending`` forever inside the worker thread."""
    from lizystudio.backends.types import DataRef
    from lizystudio.services.training import _run_retune_subprocess

    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df
    ws.data_ref = DataRef(
        source_type="upload",
        path=None,
        filename="mem.csv",
        fingerprint="mem",
        shape=(10, 3),
    )

    returned = _run_retune_subprocess(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=5,
        expand_boundary=None,
        boundary_threshold=None,
    )

    # Returned job reflects the failed state (same instance mutated).
    assert returned.status == "failed"
    assert returned.error is not None and "file-backed" in returned.error
    # JobStore persisted the failure.
    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    # Broadcaster saw the error.
    mock_broadcaster.send_error.assert_called_once()
    # Workspace selection was repointed to the child.
    assert ws.current_job_id == child.job_id


def test_start_retune_async_worker_crash_transitions_child_to_failed(
    job_store: JobStore,
    sample_data_ref: DataRef,
    sample_df: pd.DataFrame,
    mock_backend: MagicMock,
    mock_broadcaster: MagicMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """H-0062 Bugfix 2026-04-14 (6): if an unexpected exception escapes
    the subprocess helper (or the thread path) inside the worker, the
    blanket exception handler must still transition the child job to
    ``failed`` so the UI never shows a permanent ``pending`` state.
    """
    import lizystudio.services.openmp_detect as openmp_detect_mod
    import lizystudio.services.training as training_mod

    parent = _make_tune_parent_with_checkpoint(job_store, sample_data_ref)
    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    ws = _make_workspace(mock_backend)
    ws.dataframe = sample_df
    ws.data_ref = sample_data_ref

    def boom(**_: Any) -> Any:
        raise RuntimeError("synthetic worker crash")

    monkeypatch.setattr(openmp_detect_mod, "should_use_subprocess", lambda: True)
    monkeypatch.setattr(training_mod, "_run_retune_subprocess", boom, raising=False)

    job_store.acquire_parent_lock(parent.job_id, "placeholder")

    start_retune_async(
        ws=ws,
        job_store=job_store,
        broadcaster=mock_broadcaster,
        parent_job=parent,
        child_job=child,
        n_trials=5,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )
    thread = ws._job_thread
    assert thread is not None
    thread.join(timeout=15)
    assert not thread.is_alive()

    refreshed = job_store.get(child.job_id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error is not None and "synthetic worker crash" in refreshed.error
    mock_broadcaster.send_error.assert_called()
    assert job_store.get_locked_child(parent.job_id) is None
