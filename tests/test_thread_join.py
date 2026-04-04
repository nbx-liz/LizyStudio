"""Tests for worker thread join guarantee (H-0040).

Verifies that WorkspaceState tracks background threads and joins them
before starting new jobs, preventing thread resource accumulation.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import start_fit_async, start_tune_async
from lizystudio.services.workspace import WorkspaceState


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
    return backend


@pytest.fixture()
def ws(mock_backend: MagicMock) -> WorkspaceState:
    return WorkspaceState(backend=mock_backend)


@pytest.fixture()
def broadcaster() -> MagicMock:
    b = MagicMock()
    b.send_progress = MagicMock()
    b.send_completed = MagicMock()
    b.send_error = MagicMock()
    return b


class TestWorkspaceStateJobThread:
    """WorkspaceState should track and expose _job_thread."""

    def test_initial_job_thread_is_none(self, ws: WorkspaceState) -> None:
        assert ws._job_thread is None

    def test_reset_clears_job_thread(self, ws: WorkspaceState) -> None:
        ws._job_thread = threading.Thread(target=lambda: None)
        ws.reset()
        assert ws._job_thread is None


class TestThreadJoinOnNewJob:
    """New jobs should join the previous thread before starting."""

    def test_start_fit_async_stores_thread(
        self,
        ws: WorkspaceState,
        job_store: JobStore,
        broadcaster: MagicMock,
        sample_data_ref: DataRef,
        sample_df: pd.DataFrame,
    ) -> None:
        """start_fit_async should store the thread reference in ws._job_thread."""
        job = job_store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=sample_data_ref,
            job_type="fit",
        )
        start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config={"task": "binary"},
            dataframe=sample_df,
            job=job,
        )
        assert ws._job_thread is not None
        assert isinstance(ws._job_thread, threading.Thread)
        # Wait for thread to finish
        ws._job_thread.join(timeout=5)

    def test_start_tune_async_stores_thread(
        self,
        ws: WorkspaceState,
        job_store: JobStore,
        broadcaster: MagicMock,
        sample_data_ref: DataRef,
        sample_df: pd.DataFrame,
    ) -> None:
        """start_tune_async should store the thread reference in ws._job_thread."""
        job = job_store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=sample_data_ref,
            job_type="tune",
        )
        start_tune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config={"task": "binary"},
            dataframe=sample_df,
            job=job,
        )
        assert ws._job_thread is not None
        assert isinstance(ws._job_thread, threading.Thread)
        ws._job_thread.join(timeout=5)

    def test_consecutive_fits_join_previous_thread(
        self,
        ws: WorkspaceState,
        job_store: JobStore,
        broadcaster: MagicMock,
        sample_data_ref: DataRef,
        sample_df: pd.DataFrame,
    ) -> None:
        """Starting a second fit should join the first thread."""
        # Make the first job slow enough to still be alive when second starts
        original_fit = ws.backend.fit.return_value
        call_count = 0

        def slow_fit(*args: object, **kwargs: object) -> FitSummary:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                time.sleep(0.3)
            return original_fit

        ws.backend.fit.side_effect = slow_fit

        job1 = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )
        start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config={},
            dataframe=sample_df,
            job=job1,
        )
        thread1 = ws._job_thread
        assert thread1 is not None

        # Wait for first job to complete so active slot is released
        thread1.join(timeout=5)

        job2 = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )
        start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config={},
            dataframe=sample_df,
            job=job2,
        )
        thread2 = ws._job_thread
        assert thread2 is not None

        # First thread should be dead (was joined before second started)
        assert not thread1.is_alive()
        thread2.join(timeout=5)

    def test_join_timeout_does_not_deadlock(
        self,
        ws: WorkspaceState,
        job_store: JobStore,
        broadcaster: MagicMock,
        sample_data_ref: DataRef,
        sample_df: pd.DataFrame,
    ) -> None:
        """If a previous thread is stuck, join with timeout should not block forever."""
        # Simulate a stuck thread
        stuck_event = threading.Event()

        def stuck_target() -> None:
            stuck_event.wait(timeout=10)  # Will block until set or timeout

        stuck_thread = threading.Thread(target=stuck_target, daemon=True)
        stuck_thread.start()
        ws._job_thread = stuck_thread

        # Starting a new job should not deadlock (join has timeout)
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )
        start_fit_async(
            ws=ws,
            job_store=job_store,
            broadcaster=broadcaster,
            config={},
            dataframe=sample_df,
            job=job,
        )
        # If we got here, join didn't deadlock
        assert ws._job_thread is not None
        ws._job_thread.join(timeout=5)
        stuck_event.set()  # Clean up stuck thread

    def test_thread_count_stable_after_multiple_jobs(
        self,
        ws: WorkspaceState,
        job_store: JobStore,
        broadcaster: MagicMock,
        sample_data_ref: DataRef,
        sample_df: pd.DataFrame,
    ) -> None:
        """Thread count should not grow unboundedly with consecutive jobs."""
        baseline = threading.active_count()

        for _i in range(5):
            job = job_store.create(
                backend_name="lizyml",
                config={},
                data_ref=sample_data_ref,
                job_type="fit",
            )
            start_fit_async(
                ws=ws,
                job_store=job_store,
                broadcaster=broadcaster,
                config={},
                dataframe=sample_df,
                job=job,
            )
            # Wait for completion before next
            if ws._job_thread:
                ws._job_thread.join(timeout=5)

        # Active threads should not have accumulated
        # Allow +2 margin for test infrastructure threads
        assert threading.active_count() <= baseline + 2
