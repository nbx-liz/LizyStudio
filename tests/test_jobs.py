"""Tests for JobStore disk persistence."""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.jobs import JobStore

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
    assert job_store.delete(job.job_id) == [job.job_id]
    assert job_store.get(job.job_id) is None
    assert job_store.delete(job.job_id) == []


# ---------------------------------------------------------------------------
# job_dir — path traversal guard (#451: implemented in JobMetadataStore,
# delegated through JobStore.job_dir)
# ---------------------------------------------------------------------------


def test_job_dir_traversal_guard_raises(job_store: JobStore) -> None:
    """job_dir must raise ValueError when job_id escapes jobs_dir."""
    with pytest.raises(ValueError, match="outside allowed root"):
        job_store.job_dir("../escape")


# ---------------------------------------------------------------------------
# list — empty jobs_dir branch (#451: lives in JobMetadataStore)
# ---------------------------------------------------------------------------


def test_list_returns_empty_when_jobs_dir_missing(tmp_path: Path) -> None:
    """list() must return [] when the jobs directory does not exist yet."""
    from lizystudio.services.jobs import JobMetadataStore

    jobs_dir = tmp_path / "missing_dir"
    # Do NOT create the directory — simulate a metadata store whose
    # jobs_dir vanished after construction.
    meta = JobMetadataStore.__new__(JobMetadataStore)
    meta.jobs_dir = jobs_dir
    assert meta.list() == []


# ---------------------------------------------------------------------------
# JobStore.load_model — no model_path raises ValueError (H-0084)
# ---------------------------------------------------------------------------


def test_job_store_load_model_raises_when_no_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """JobStore.load_model must raise ValueError when model_path is None."""
    from unittest.mock import MagicMock

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    assert job.model_path is None
    backend = MagicMock()

    with pytest.raises(ValueError, match="no saved model"):
        job_store.load_model(job, backend)


# ---------------------------------------------------------------------------
# _load_tuning_plot_from_file
# ---------------------------------------------------------------------------


def test_load_tuning_plot_from_file_returns_none_when_missing(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Returns None when tuning_plot.json does not exist."""
    from lizystudio.services.jobs import _load_tuning_plot_from_file

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    # Set model_path so _get_jobs_dir can derive jobs_dir
    model_dir = job_store.jobs_dir / job.job_id / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    job.model_path = str(model_dir)
    result = _load_tuning_plot_from_file(job)
    assert result is None


def test_load_tuning_plot_from_file_returns_none_when_no_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Returns None when job has no model_path."""
    from lizystudio.services.jobs import _load_tuning_plot_from_file

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    result = _load_tuning_plot_from_file(job)
    assert result is None


def test_load_tuning_plot_from_file_returns_plot_data(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Returns PlotData when tuning_plot.json exists."""
    from lizystudio.services.jobs import _load_tuning_plot_from_file

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    model_dir = job_store.jobs_dir / job.job_id / "model"
    model_dir.mkdir(parents=True, exist_ok=True)
    job.model_path = str(model_dir)

    plot_json = '{"data":[],"layout":{}}'
    plot_path = job_store.jobs_dir / job.job_id / "tuning_plot.json"
    plot_path.write_text(plot_json, encoding="utf-8")

    result = _load_tuning_plot_from_file(job)
    assert result is not None
    assert result.plotly_json == plot_json


# ---------------------------------------------------------------------------
# _get_jobs_dir
# ---------------------------------------------------------------------------


def test_get_jobs_dir_with_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """_get_jobs_dir returns parent.parent of model_path."""
    from pathlib import Path

    from lizystudio.services.jobs import _get_jobs_dir

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.model_path = "/tmp/jobs/job_abc123/model"
    result = _get_jobs_dir(job)
    assert result == Path("/tmp/jobs")


def test_get_jobs_dir_without_model_path(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """_get_jobs_dir returns None when model_path is None."""
    from lizystudio.services.jobs import _get_jobs_dir

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    assert job.model_path is None
    result = _get_jobs_dir(job)
    assert result is None


# ---------------------------------------------------------------------------
# get_job_plot — tuning fallback path
# ---------------------------------------------------------------------------


def test_get_job_plot_tuning_falls_back_to_file(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """get_job_plot falls back to saved file when backend raises for tuning."""
    from unittest.mock import MagicMock

    from lizystudio.backends.types import PlotData
    from lizystudio.services.jobs import get_job_plot

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.model_path = str(job_store.jobs_dir / job.job_id / "model")

    # Write tuning plot file
    plot_json = '{"data":[],"layout":{}}'
    plot_path = job_store.jobs_dir / job.job_id / "tuning_plot.json"
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    plot_path.write_text(plot_json, encoding="utf-8")

    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    # Backend raises when trying to get tuning plot from exported model
    backend.plot.side_effect = RuntimeError("No Optuna study data")

    result = get_job_plot(job, backend, job_store.model_cache, "tuning")
    assert isinstance(result, PlotData)
    assert result.plotly_json == plot_json


def test_get_job_plot_tuning_reraises_when_no_file(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """get_job_plot re-raises when backend raises and no fallback file exists."""
    from unittest.mock import MagicMock

    from lizystudio.services.jobs import get_job_plot

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.model_path = str(job_store.jobs_dir / job.job_id / "model")

    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.plot.side_effect = RuntimeError("No Optuna study data")

    with pytest.raises(RuntimeError, match="No Optuna study data"):
        get_job_plot(job, backend, job_store.model_cache, "tuning")


def test_get_job_plot_non_tuning_delegates_to_backend(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """get_job_plot delegates directly to backend for non-tuning plot types."""
    from unittest.mock import MagicMock

    from lizystudio.backends.types import PlotData
    from lizystudio.services.jobs import get_job_plot

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.model_path = str(job_store.jobs_dir / job.job_id / "model")

    expected = PlotData(plotly_json='{"data":[]}')
    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.plot.return_value = expected

    result = get_job_plot(job, backend, job_store.model_cache, "learning-curve")
    assert result is expected


# ---------------------------------------------------------------------------
# get_available_plots — tuning file fallback
# ---------------------------------------------------------------------------


def test_get_available_plots_adds_tuning_from_file(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """get_available_plots appends 'tuning' when file exists but backend lacks it."""
    from unittest.mock import MagicMock

    from lizystudio.services.jobs import get_available_plots

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.model_path = str(job_store.jobs_dir / job.job_id / "model")

    # Write tuning_plot.json
    plot_path = job_store.jobs_dir / job.job_id / "tuning_plot.json"
    plot_path.parent.mkdir(parents=True, exist_ok=True)
    plot_path.write_text("{}", encoding="utf-8")

    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.available_plots.return_value = ["learning-curve", "importance"]

    result = get_available_plots(job, backend, job_store.model_cache)
    assert "tuning" in result


def test_get_available_plots_no_tuning_when_file_absent(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """get_available_plots does NOT add 'tuning' when file is absent."""
    from unittest.mock import MagicMock

    from lizystudio.services.jobs import get_available_plots

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.model_path = str(job_store.jobs_dir / job.job_id / "model")

    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.available_plots.return_value = ["learning-curve"]

    result = get_available_plots(job, backend, job_store.model_cache)
    assert "tuning" not in result


# ---------------------------------------------------------------------------
# Job state management (#4)
# ---------------------------------------------------------------------------


def test_claim_active_blocks_second_job(
    job_store: JobStore,
) -> None:
    """claim_active returns False for a second caller."""
    assert job_store.claim_active("job_a") is True
    assert job_store.claim_active("job_b") is False
    job_store.release_active("job_a")


def test_release_active_allows_next(job_store: JobStore) -> None:
    """After release, next claim_active succeeds."""
    job_store.claim_active("job_a")
    job_store.release_active("job_a")
    assert job_store.claim_active("job_b") is True
    job_store.release_active("job_b")


def test_cancel_request_on_pending_job(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Cancel can be requested on a pending job."""
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job_store.request_cancel(job.job_id)
    assert job_store.is_cancel_requested(job.job_id) is True
    job_store.clear_cancel(job.job_id)
    assert job_store.is_cancel_requested(job.job_id) is False


def test_has_active_job(job_store: JobStore) -> None:
    """has_active_job reflects active state."""
    assert job_store.has_active_job() is False
    job_store.claim_active("job_x")
    assert job_store.has_active_job() is True
    job_store.release_active("job_x")
    assert job_store.has_active_job() is False


# ---------------------------------------------------------------------------
# Job directory corruption (#13)
# ---------------------------------------------------------------------------


def test_get_returns_none_for_missing_meta(
    job_store: JobStore,
) -> None:
    """get() returns None when job dir exists but meta.json is absent."""
    (job_store.jobs_dir / "job_orphan").mkdir(parents=True)
    assert job_store.get("job_orphan") is None


def test_load_job_corrupt_meta_raises(
    job_store: JobStore,
) -> None:
    """load_job raises on corrupt meta.json (#451: JobMetadataStore.load_job)."""
    import json

    job_dir = job_store.jobs_dir / "job_corrupt"
    job_dir.mkdir(parents=True)
    (job_dir / "meta.json").write_text("not json{{{", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        job_store._meta.load_job("job_corrupt")


def test_load_job_missing_field_raises(
    job_store: JobStore,
) -> None:
    """load_job raises KeyError when required fields are missing."""
    import json

    job_dir = job_store.jobs_dir / "job_partial"
    job_dir.mkdir(parents=True)
    (job_dir / "meta.json").write_text(
        json.dumps({"job_id": "job_partial", "status": "pending"}),
        encoding="utf-8",
    )
    with pytest.raises(KeyError):
        job_store._meta.load_job("job_partial")


def test_list_skips_dirs_without_meta(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """list() should skip subdirs that lack meta.json."""
    # Create a valid job
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    # Create an orphan dir (no meta.json)
    (job_store.jobs_dir / "orphan_dir").mkdir(parents=True)
    jobs = job_store.list()
    assert len(jobs) == 1
    assert jobs[0].job_id == job.job_id


def test_load_job_corrupt_fit_result(
    job_store: JobStore, sample_data_ref: DataRef
) -> None:
    """Corrupt fit_result.json should raise on load."""
    import json

    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    fit_path = job_store.jobs_dir / job.job_id / "fit_result.json"
    fit_path.write_text("not valid json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        job_store.get(job.job_id)
