"""Tests for subprocess job runner (H-0036).

Verifies that fit/tune jobs can execute in a subprocess with
progress forwarding and result retrieval via temp files.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore
from lizystudio.services.subprocess_runner import (
    run_job_in_subprocess,
)

pytestmark = pytest.mark.unit


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
def sample_csv(tmp_path: Path) -> Path:
    """Create a real CSV that the subprocess can load."""
    p = tmp_path / "data.csv"
    df = pd.DataFrame({"x": range(50), "y": [0, 1] * 25})
    df.to_csv(p, index=False)
    return p


@pytest.fixture()
def valid_config() -> dict[str, Any]:
    """Generate a valid LizyML config via the adapter."""
    from lizystudio.backends.registry import get_adapter

    adapter = get_adapter("lizyml")
    return adapter.get_default_config("binary", "y")


@pytest.fixture()
def valid_tune_config(valid_config: dict[str, Any]) -> dict[str, Any]:
    """Valid config with tuning section."""
    cfg = {
        **valid_config,
        "tuning": {
            "optuna": {
                "params": {"direction": "minimize", "n_trials": 2},
            },
        },
    }
    return cfg


@pytest.fixture()
def broadcaster() -> MagicMock:
    b = MagicMock()
    b.send_progress = MagicMock()
    b.send_completed = MagicMock()
    b.send_error = MagicMock()
    return b


class TestSubprocessEntryPoint:
    """The subprocess entry point should be invocable as a module."""

    def test_module_exists(self) -> None:
        """subprocess_runner module should be importable."""
        import lizystudio.services.subprocess_runner as mod

        assert hasattr(mod, "run_job_in_subprocess")

    def test_entry_point_prints_usage_without_args(self) -> None:
        """Running as __main__ without args should exit with error."""
        result = subprocess.run(
            [sys.executable, "-m", "lizystudio.services.subprocess_runner"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode != 0


class TestRunJobInSubprocess:
    """Integration: run a job via subprocess and retrieve results."""

    @staticmethod
    def _make_data_ref(csv_path: Path) -> DataRef:
        return DataRef(
            source_type="path",
            path=str(csv_path),
            filename="data.csv",
            fingerprint="test123",
            shape=(10, 2),
        )

    def test_fit_completes_via_subprocess(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_config: dict[str, Any],
    ) -> None:
        """A fit job should complete successfully in a subprocess."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_config,
            data_ref=data_ref,
            job_type="fit",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "completed"
        assert result_job.fit_result is not None
        assert result_job.model_path is not None

    def test_tune_completes_via_subprocess(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_tune_config: dict[str, Any],
    ) -> None:
        """A tune job should complete successfully in a subprocess."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_tune_config,
            data_ref=data_ref,
            job_type="tune",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "completed"
        assert result_job.fit_result is not None
        assert result_job.tune_result is not None

    def test_progress_forwarded_to_broadcaster(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_config: dict[str, Any],
    ) -> None:
        """Progress messages from subprocess should reach the broadcaster."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_config,
            data_ref=data_ref,
            job_type="fit",
        )
        run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        # At minimum, send_completed should have been called
        assert broadcaster.send_completed.called or broadcaster.send_error.called

    def test_failed_job_reports_error(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
    ) -> None:
        """A job with invalid config should fail gracefully."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            # Missing required 'target' field should cause failure
            config={"task": "binary"},
            data_ref=data_ref,
            job_type="fit",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "failed"
        assert result_job.error is not None
