"""Tests for export service (export_model, export_report)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef, FitSummary, PlotData
from lizystudio.services.export import export_model, export_report
from lizystudio.services.jobs import Job, JobStore


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def completed_job(job_store: JobStore) -> Job:
    data_ref = DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = "/tmp/fake_model"
    job.fit_result = FitSummary(
        metrics={"auc": 0.95},
        fold_count=5,
        params=[{"n_estimators": 100}],
    )
    job_store.update(job)
    return job


@pytest.fixture()
def mock_backend() -> MagicMock:
    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.export_model.return_value = "/tmp/exported"
    backend.evaluate_table.return_value = [{"metric": "auc", "IS": 0.95, "OOS": 0.90}]
    backend.model_info.return_value = {
        "task": "binary",
        "model_name": "LightGBM",
    }
    backend.available_plots.return_value = ["learning_curve"]
    backend.plot.return_value = PlotData(plotly_json='{"data": [], "layout": {}}')
    return backend


def test_export_model_success(completed_job: Job, mock_backend: MagicMock) -> None:
    result = export_model(
        job=completed_job,
        backend=mock_backend,
        output_path="/tmp/export_dir",
    )
    assert result == "/tmp/exported"
    mock_backend.load_model.assert_called_once_with(completed_job.model_path)
    mock_backend.export_model.assert_called_once()


def test_export_model_no_model_path(mock_backend: MagicMock) -> None:
    job = Job(
        job_id="job_nomodel",
        backend_name="lizyml",
        config={},
        data_ref=DataRef(
            source_type="path",
            path="/data/t.csv",
            filename="t.csv",
            fingerprint="fp",
            shape=(10, 2),
        ),
        job_type="fit",
        status="completed",
        created_at="2026-01-01T00:00:00",
    )
    with pytest.raises(ValueError, match="no saved model"):
        export_model(job=job, backend=mock_backend, output_path="/tmp/x")


def test_export_report_success(
    completed_job: Job, mock_backend: MagicMock, tmp_path: Path
) -> None:
    out = str(tmp_path / "report.html")
    result = export_report(
        job=completed_job,
        backend=mock_backend,
        output_path=out,
    )
    assert result == out
    assert Path(out).exists()
    content = Path(out).read_text()
    assert "LightGBM" in content
    assert "auc" in content
    assert "plotly" in content.lower()


def test_export_report_to_directory(
    completed_job: Job, mock_backend: MagicMock, tmp_path: Path
) -> None:
    """When output_path is a directory, should auto-generate filename."""
    result = export_report(
        job=completed_job,
        backend=mock_backend,
        output_path=str(tmp_path),
    )
    assert Path(result).exists()
    assert completed_job.job_id in result
    assert result.endswith(".html")


def test_export_report_no_model_path(mock_backend: MagicMock) -> None:
    job = Job(
        job_id="job_nomodel",
        backend_name="lizyml",
        config={},
        data_ref=DataRef(
            source_type="path",
            path="/data/t.csv",
            filename="t.csv",
            fingerprint="fp",
            shape=(10, 2),
        ),
        job_type="fit",
        status="completed",
        created_at="2026-01-01T00:00:00",
    )
    with pytest.raises(ValueError, match="no saved model"):
        export_report(job=job, backend=mock_backend, output_path="/tmp/x")


# --- export_code_as_zip ---


def test_export_code_as_zip_returns_zip_path(
    completed_job: Job, mock_backend: MagicMock, tmp_path: Path
) -> None:
    """export_code_as_zip() must return a Path pointing to a .zip file."""
    from lizystudio.services.export import export_code_as_zip

    # Mock backend.export_code to create a directory with a file in it
    def fake_export_code(model: object, path: str) -> str:
        code_dir = Path(path)
        code_dir.mkdir(parents=True, exist_ok=True)
        (code_dir / "train.py").write_text("# train")
        (code_dir / "predict.py").write_text("# predict")
        return str(code_dir)

    mock_backend.export_code.side_effect = fake_export_code

    result = export_code_as_zip(job=completed_job, backend=mock_backend)
    assert isinstance(result, Path)
    assert result.suffix == ".zip"
    assert result.exists()


def test_export_code_as_zip_zip_contains_files(
    completed_job: Job, mock_backend: MagicMock
) -> None:
    """The returned ZIP must contain the exported code files."""
    import zipfile

    from lizystudio.services.export import export_code_as_zip

    def fake_export_code(model: object, path: str) -> str:
        code_dir = Path(path)
        code_dir.mkdir(parents=True, exist_ok=True)
        (code_dir / "train.py").write_text("# train script")
        (code_dir / "requirements.txt").write_text("scikit-learn\n")
        return str(code_dir)

    mock_backend.export_code.side_effect = fake_export_code

    zip_path = export_code_as_zip(job=completed_job, backend=mock_backend)

    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
    assert any("train.py" in n for n in names)
    assert any("requirements.txt" in n for n in names)


def test_export_code_as_zip_no_model_path_raises(mock_backend: MagicMock) -> None:
    """export_code_as_zip() raises ValueError when the job has no model_path."""
    from lizystudio.services.export import export_code_as_zip

    job_no_model = Job(
        job_id="job_nomodel",
        backend_name="lizyml",
        config={},
        data_ref=DataRef(
            source_type="path",
            path="/data/t.csv",
            filename="t.csv",
            fingerprint="fp",
            shape=(10, 2),
        ),
        job_type="fit",
        status="completed",
        created_at="2026-01-01T00:00:00",
    )

    with pytest.raises(ValueError, match="no saved model"):
        export_code_as_zip(job=job_no_model, backend=mock_backend)
