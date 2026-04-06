"""Tests for inference service (InferenceStore, run_inference)."""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.inference import (
    InferenceRecord,
    InferenceStore,
    get_comparison_stats,
)


@pytest.fixture()
def inf_store(tmp_path: Path) -> InferenceStore:
    return InferenceStore(tmp_path / "jobs")


@pytest.fixture()
def sample_record() -> InferenceRecord:
    return InferenceRecord(
        inf_id="inf_abc12345",
        job_id="job_test001",
        data_ref=DataRef(
            source_type="path",
            path="/data/test.csv",
            filename="test.csv",
            fingerprint="xyz789",
            shape=(50, 5),
        ),
        has_ground_truth=True,
        created_at="2026-01-01T00:00:00+00:00",
        row_count=50,
        warnings=[],
    )


@pytest.fixture()
def sample_predictions() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "pred": [0.1, 0.9, 0.3, 0.8, 0.5],
            "actual": [0, 1, 0, 1, 1],
        }
    )


# --- InferenceStore CRUD ---


def test_save_and_get(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    metrics = {"mae": 0.1, "r2": 0.9}
    inf_store.save(sample_record, sample_predictions, metrics)

    loaded = inf_store.get(sample_record.job_id, sample_record.inf_id)
    assert loaded is not None
    assert loaded.inf_id == sample_record.inf_id
    assert loaded.job_id == sample_record.job_id
    assert loaded.has_ground_truth is True
    assert loaded.row_count == 50
    assert loaded.data_ref.shape == (50, 5)


def test_get_nonexistent(inf_store: InferenceStore) -> None:
    assert inf_store.get("job_x", "inf_x") is None


def test_list_empty(inf_store: InferenceStore) -> None:
    assert inf_store.list("job_x") == []


def test_list_multiple(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    for i in range(3):
        record = InferenceRecord(
            inf_id=f"inf_{i:08d}",
            job_id="job_test001",
            data_ref=DataRef(
                source_type="path",
                path=f"/data/test{i}.csv",
                filename=f"test{i}.csv",
                fingerprint=f"fp{i}",
                shape=(10, 2),
            ),
            has_ground_truth=False,
            created_at=f"2026-01-0{i + 1}T00:00:00+00:00",
            row_count=10,
            warnings=[],
        )
        inf_store.save(record, sample_predictions)

    records = inf_store.list("job_test001")
    assert len(records) == 3
    # Newest first
    assert records[0].created_at > records[-1].created_at


# --- Predictions ---


def test_get_predictions(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    result = inf_store.get_predictions(
        sample_record.job_id, sample_record.inf_id, rows=3, offset=0
    )
    assert result["total_rows"] == 5
    assert len(result["data"]) == 3
    assert "pred" in result["columns"]


def test_get_predictions_with_offset(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    result = inf_store.get_predictions(
        sample_record.job_id, sample_record.inf_id, rows=10, offset=3
    )
    assert result["total_rows"] == 5
    assert len(result["data"]) == 2  # Only 2 remaining


def test_get_predictions_nonexistent(inf_store: InferenceStore) -> None:
    result = inf_store.get_predictions("job_x", "inf_x")
    assert result["total_rows"] == 0
    assert result["data"] == []


def test_get_predictions_df(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions)
    df = inf_store.get_predictions_df(sample_record.job_id, sample_record.inf_id)
    assert df is not None
    assert len(df) == 5


def test_get_predictions_df_nonexistent(inf_store: InferenceStore) -> None:
    assert inf_store.get_predictions_df("job_x", "inf_x") is None


# --- Metrics ---


def test_get_metrics(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    metrics = {"mae": 0.1, "r2": 0.9}
    inf_store.save(sample_record, sample_predictions, metrics)
    loaded = inf_store.get_metrics(sample_record.job_id, sample_record.inf_id)
    assert loaded is not None
    assert loaded["mae"] == 0.1


def test_get_metrics_no_ground_truth(
    inf_store: InferenceStore,
    sample_record: InferenceRecord,
    sample_predictions: pd.DataFrame,
) -> None:
    inf_store.save(sample_record, sample_predictions, None)
    assert inf_store.get_metrics(sample_record.job_id, sample_record.inf_id) is None


# --- Comparison ---


def test_comparison_stats(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    job_id = "job_cmp"
    for inf_id in ("inf_a", "inf_b"):
        record = InferenceRecord(
            inf_id=inf_id,
            job_id=job_id,
            data_ref=DataRef(
                source_type="path",
                path="/data/t.csv",
                filename="t.csv",
                fingerprint="fp",
                shape=(5, 2),
            ),
            has_ground_truth=False,
            created_at="2026-01-01T00:00:00+00:00",
            row_count=5,
            warnings=[],
        )
        inf_store.save(record, sample_predictions)

    result = get_comparison_stats(inf_store, job_id, "inf_a", "inf_b")
    assert "current" in result
    assert "other" in result
    assert "mean" in result["current"]
    assert "count" in result["current"]


def test_comparison_stats_not_found(inf_store: InferenceStore) -> None:
    with pytest.raises(ValueError, match="Predictions not found"):
        get_comparison_stats(inf_store, "job_x", "inf_a", "inf_b")


# =============================================================================
# Additional coverage: path-escape, list_all, run_inference,
# _compute_inference_metrics, get_inference_plot, binary comparison stats
# =============================================================================


from unittest.mock import MagicMock  # noqa: E402

from lizystudio.backends.types import FitSummary  # noqa: E402
from lizystudio.services.inference import (  # noqa: E402
    _compute_inference_metrics,
    get_inference_plot,
    run_inference,
)
from lizystudio.services.jobs import JobStore  # noqa: E402

# --- Path-escape guard ---


def test_inf_dir_path_escape_raises(tmp_path: Path) -> None:
    """_inf_dir raises ValueError when inf_id would escape jobs_dir."""
    # Create the jobs_dir so resolve() works correctly on disk
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir(parents=True)
    store = InferenceStore(jobs_dir)
    # Five levels of '../' escape from {jobs_dir}/job_x/inferences/../../../../../
    with pytest.raises(ValueError, match="outside allowed root"):
        store._inf_dir("job_x", "../../../../../etc/passwd")


# --- list_all ---


def test_list_all_across_jobs(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    """list_all() returns records from multiple jobs."""
    for job_id in ("job_A", "job_B", "job_C"):
        rec = InferenceRecord(
            inf_id=f"inf_{job_id}",
            job_id=job_id,
            data_ref=DataRef(
                source_type="path",
                path="/data/t.csv",
                filename="t.csv",
                fingerprint="fp",
                shape=(5, 2),
            ),
            has_ground_truth=False,
            created_at="2026-01-01T00:00:00Z",
            row_count=5,
            warnings=[],
        )
        inf_store.save(rec, sample_predictions)

    records = inf_store.list_all()
    assert len(records) == 3


def test_list_all_empty_jobs_dir(tmp_path: Path) -> None:
    """list_all() returns empty list when jobs_dir does not exist."""
    store = InferenceStore(tmp_path / "nonexistent_dir")
    assert store.list_all() == []


def test_list_all_skips_non_dirs(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    """list_all() handles jobs_dir that exists but contains only non-dir entries."""
    # Create the jobs root but put a plain file in it (should be skipped)
    inf_store.jobs_dir.mkdir(parents=True, exist_ok=True)
    (inf_store.jobs_dir / "not_a_dir.txt").write_text("junk")
    records = inf_store.list_all()
    assert records == []


# --- _compute_inference_metrics ---


def test_compute_metrics_regression_perfect() -> None:
    """_compute_inference_metrics: perfect regression gives MAE=0 and R2=1."""
    pred_df = pd.DataFrame({"pred": [1.0, 2.0, 3.0], "actual": [1.0, 2.0, 3.0]})
    result = _compute_inference_metrics(pred_df, {"task": "regression"})
    assert result["mae"] == pytest.approx(0.0)
    assert result["r2"] == pytest.approx(1.0)


def test_compute_metrics_regression_with_residuals() -> None:
    """_compute_inference_metrics: imperfect regression has non-zero errors."""
    pred_df = pd.DataFrame({"pred": [0.0, 0.0, 0.0], "actual": [1.0, 2.0, 3.0]})
    result = _compute_inference_metrics(pred_df, {"task": "regression"})
    assert result["mae"] > 0
    assert result["mse"] > 0
    assert result["rmse"] > 0
    assert result["r2"] < 1.0


def test_compute_metrics_regression_constant_actual() -> None:
    """_compute_inference_metrics: constant actual prevents division-by-zero (R2=0)."""
    pred_df = pd.DataFrame({"pred": [1.0, 2.0, 3.0], "actual": [5.0, 5.0, 5.0]})
    result = _compute_inference_metrics(pred_df, {"task": "regression"})
    # ss_tot == 0 -> R2 clamped to 0.0
    assert result["r2"] == pytest.approx(0.0)


def test_compute_metrics_classification_no_proba() -> None:
    """_compute_inference_metrics: binary without proba col => accuracy only."""
    pred_df = pd.DataFrame({"pred": [0, 1, 0, 1], "actual": [0, 1, 0, 1]})
    result = _compute_inference_metrics(pred_df, {"task": "binary"})
    assert result["accuracy"] == pytest.approx(1.0)
    assert "auc" not in result


def test_compute_metrics_classification_with_proba() -> None:
    """_compute_inference_metrics: binary with proba col => AUC + logloss."""
    pred_df = pd.DataFrame(
        {
            "pred": [0, 1, 0, 1],
            "proba": [0.1, 0.9, 0.2, 0.8],
            "actual": [0, 1, 0, 1],
        }
    )
    result = _compute_inference_metrics(pred_df, {"task": "binary"})
    assert result["accuracy"] == pytest.approx(1.0)
    assert result["auc"] == pytest.approx(1.0)
    assert "logloss" in result


def test_compute_metrics_with_job_nested_raw(tmp_path: Path) -> None:
    """Compute metrics returns IS/OOS/Inf with nested raw."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(2, 2),
    )
    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"raw": {"oof": {"auc": 0.88}, "if_mean": {"auc": 0.93}}},
        fold_count=5,
        params=[],
    )
    job_store.update(job)

    pred_df = pd.DataFrame({"pred": [0, 1], "proba": [0.1, 0.9], "actual": [0, 1]})
    result = _compute_inference_metrics(pred_df, {"task": "binary"}, job=job)
    assert "inf" in result
    assert result["oos"]["auc"] == 0.88
    assert result["is"]["auc"] == 0.93


def test_compute_metrics_with_job_flat_metrics(tmp_path: Path) -> None:
    """_compute_inference_metrics falls back to flat metrics when no raw nested."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(2, 2),
    )
    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"auc": 0.77, "logloss": 0.4},
        fold_count=3,
        params=[],
    )
    job_store.update(job)

    pred_df = pd.DataFrame({"pred": [0, 1], "actual": [0, 1]})
    result = _compute_inference_metrics(pred_df, {"task": "binary"}, job=job)
    assert "inf" in result
    assert result["is"]["auc"] == 0.77
    assert result["oos"]["auc"] == 0.77


# --- run_inference ---


def test_run_inference_success(tmp_path: Path) -> None:
    """run_inference creates an InferenceRecord with correct row_count."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(3, 2),
    )
    data_csv = tmp_path / "infer.csv"
    pd.DataFrame({"feat1": [1, 2, 3], "feat2": [4, 5, 6]}).to_csv(data_csv, index=False)

    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "label"}},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = str(tmp_path / "model")
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    job_store.update(job)

    fake_pred = MagicMock()
    fake_pred.predictions = pd.DataFrame({"pred": [0, 1, 0], "proba": [0.1, 0.9, 0.2]})
    fake_pred.warnings = []

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.model_info.return_value = {"target": None, "task": "binary"}
    mock_backend.predict.return_value = fake_pred

    record = run_inference(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        data_path=str(data_csv),
        return_shap=False,
        evaluate=False,
    )

    assert record.job_id == job.job_id
    assert record.row_count == 3
    assert record.has_ground_truth is False
    assert record.inf_id.startswith("inf_")


def test_run_inference_detects_ground_truth(tmp_path: Path) -> None:
    """run_inference sets has_ground_truth=True when target col is present."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(2, 2),
    )
    data_csv = tmp_path / "data_with_target.csv"
    pd.DataFrame({"feat": [1, 2], "label": [0, 1]}).to_csv(data_csv, index=False)

    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "label"}},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = str(tmp_path / "model")
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    job_store.update(job)

    fake_pred = MagicMock()
    fake_pred.predictions = pd.DataFrame({"pred": [0, 1], "proba": [0.1, 0.9]})
    fake_pred.warnings = []

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.model_info.return_value = {"target": "label", "task": "binary"}
    mock_backend.predict.return_value = fake_pred

    record = run_inference(
        job=job,
        job_store=job_store,
        backend=mock_backend,
        data_path=str(data_csv),
        return_shap=False,
        evaluate=True,
    )

    assert record.has_ground_truth is True


def test_run_inference_no_model_path_raises(tmp_path: Path) -> None:
    """run_inference raises ValueError when job.model_path is None."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(1, 1),
    )
    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml", config={}, data_ref=data_ref, job_type="fit"
    )
    job.model_path = None
    job_store.update(job)

    data_csv = tmp_path / "data.csv"
    pd.DataFrame({"x": [1]}).to_csv(data_csv, index=False)

    with pytest.raises(ValueError, match="no saved model"):
        run_inference(
            job=job,
            job_store=job_store,
            backend=MagicMock(),
            data_path=str(data_csv),
        )


# --- get_inference_plot ---


def test_get_inference_plot_success(tmp_path: Path) -> None:
    """get_inference_plot calls backend.plot and returns its result."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(1, 1),
    )
    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml", config={}, data_ref=data_ref, job_type="fit"
    )
    job.status = "completed"
    job.model_path = str(tmp_path / "model")
    job_store.update(job)

    fake_plot = MagicMock()
    fake_plot.plotly_json = '{"data":[]}'

    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.plot.return_value = fake_plot

    result = get_inference_plot(job, mock_backend, "roc")
    assert result.plotly_json == '{"data":[]}'
    mock_backend.load_model.assert_called_once_with(job.model_path)


def test_get_inference_plot_no_model_path_raises(tmp_path: Path) -> None:
    """get_inference_plot raises ValueError when job has no model_path."""
    jobs_dir = tmp_path / "jobs"
    data_ref = DataRef(
        source_type="path",
        path="/d.csv",
        filename="d.csv",
        fingerprint="x",
        shape=(1, 1),
    )
    job_store = JobStore(jobs_dir)
    job = job_store.create(
        backend_name="lizyml", config={}, data_ref=data_ref, job_type="fit"
    )
    job.model_path = None

    with pytest.raises(ValueError, match="no saved model"):
        get_inference_plot(job, MagicMock(), "roc")


# --- get_comparison_stats binary positive_pct ---


def test_list_all_skips_job_dirs_without_inferences(tmp_path: Path) -> None:
    """list_all() skips job directories that have no 'inferences' subdirectory."""
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir()
    # A job directory with no 'inferences' subdir
    (jobs_dir / "job_no_infer").mkdir()
    store = InferenceStore(jobs_dir)
    assert store.list_all() == []


def test_compute_metrics_auc_logloss_error_handled() -> None:
    """_compute_inf_metrics silently handles sklearn errors (single-class actual).

    When actual has only one class, roc_auc_score warns (returns NaN) and
    log_loss raises ValueError.  The except block catches the log_loss failure,
    so accuracy is always present but logloss is absent.
    """
    import warnings

    from lizystudio.services.inference import _compute_inf_metrics

    # Only one distinct class in 'actual' causes log_loss to raise ValueError
    pred_df = pd.DataFrame(
        {
            "pred": [0, 0, 0],
            "proba": [0.1, 0.2, 0.3],
            "actual": [0, 0, 0],  # single class — log_loss will raise
        }
    )
    model_info = {"task": "binary"}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        result = _compute_inf_metrics(pred_df, model_info)

    # Accuracy is always computed; logloss is absent (exception caught)
    assert "accuracy" in result
    assert "logloss" not in result


def test_comparison_stats_binary_positive_pct(
    inf_store: InferenceStore,
    sample_predictions: pd.DataFrame,
) -> None:
    """get_comparison_stats binary task includes positive_pct."""
    job_id = "job_bin"
    for inf_id, preds in (
        ("inf_x", [0.0, 0.0, 1.0, 1.0]),
        ("inf_y", [0.0, 0.0, 0.0, 1.0]),
    ):
        rec = InferenceRecord(
            inf_id=inf_id,
            job_id=job_id,
            data_ref=DataRef(
                source_type="path",
                path="/t.csv",
                filename="t.csv",
                fingerprint="fp",
                shape=(4, 1),
            ),
            has_ground_truth=False,
            created_at="2026-01-01T00:00:00Z",
            row_count=4,
            warnings=[],
        )
        inf_store.save(rec, pd.DataFrame({"pred": preds}))

    result = get_comparison_stats(inf_store, job_id, "inf_x", "inf_y", task="binary")
    assert "positive_pct" in result["current"]
    assert result["current"]["positive_pct"] == pytest.approx(50.0)
    assert result["other"]["positive_pct"] == pytest.approx(25.0)


# ---------------------------------------------------------------------------
# Path traversal edge cases (#10)
# ---------------------------------------------------------------------------


def test_inf_dir_traversal_with_dot_dot_job_id(tmp_path: Path) -> None:
    """_inf_dir rejects job_id containing path traversal."""
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir(parents=True)
    store = InferenceStore(jobs_dir)
    with pytest.raises(ValueError, match="outside allowed root"):
        store._inf_dir("../../../etc", "inf_001")


def test_inf_dir_traversal_with_absolute_inf_id(
    tmp_path: Path,
) -> None:
    """_inf_dir rejects absolute path in inf_id."""
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir(parents=True)
    store = InferenceStore(jobs_dir)
    with pytest.raises(ValueError, match="outside allowed root"):
        store._inf_dir("job_ok", "/etc/passwd")


def test_save_with_traversal_inf_id_raises(
    tmp_path: Path,
    sample_predictions: pd.DataFrame,
) -> None:
    """save() with traversal inf_id should raise ValueError."""
    jobs_dir = tmp_path / "jobs"
    jobs_dir.mkdir(parents=True)
    store = InferenceStore(jobs_dir)
    record = InferenceRecord(
        inf_id="../../../escape",
        job_id="job_ok",
        data_ref=DataRef(
            source_type="path",
            path="/d.csv",
            filename="d.csv",
            fingerprint="fp",
            shape=(5, 2),
        ),
        has_ground_truth=False,
        created_at="2026-01-01T00:00:00Z",
        row_count=5,
        warnings=[],
    )
    with pytest.raises(ValueError, match="outside allowed root"):
        store.save(record, sample_predictions)
