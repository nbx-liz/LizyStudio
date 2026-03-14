"""Inference service — run predictions and manage inference records (H-0003).

Persistence layout::

    {jobs_dir}/{job_id}/inferences/{inf_id}/
    ├── meta.json
    ├── predictions.parquet
    └── metrics.json          (ground truth only)
"""

from __future__ import annotations

import builtins
import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import DataRef
from lizystudio.services.data import load_dataframe, make_data_ref
from lizystudio.services.jobs import Job, JobStore


@dataclass
class InferenceRecord:
    """Persisted inference metadata."""

    inf_id: str
    job_id: str
    data_ref: DataRef
    has_ground_truth: bool
    created_at: str  # ISO-8601
    row_count: int
    warnings: list[str]


class InferenceStore:
    """Disk-backed inference record store."""

    def __init__(self, jobs_dir: Path) -> None:
        self.jobs_dir = jobs_dir

    def _inf_dir(self, job_id: str, inf_id: str) -> Path:
        return self.jobs_dir / job_id / "inferences" / inf_id

    # --- CRUD ---

    def save(
        self,
        record: InferenceRecord,
        predictions: pd.DataFrame,
        metrics: dict[str, Any] | None = None,
    ) -> None:
        """Persist an inference record with its predictions."""
        d = self._inf_dir(record.job_id, record.inf_id)
        d.mkdir(parents=True, exist_ok=True)

        # meta.json
        meta = asdict(record)
        meta["data_ref"]["shape"] = list(meta["data_ref"]["shape"])
        (d / "meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, default=str), encoding="utf-8"
        )

        # predictions.parquet
        predictions.to_parquet(d / "predictions.parquet", index=False)

        # metrics.json (ground truth only)
        if metrics is not None:
            (d / "metrics.json").write_text(
                json.dumps(metrics, ensure_ascii=False, default=str), encoding="utf-8"
            )

    def get(self, job_id: str, inf_id: str) -> InferenceRecord | None:
        """Load an inference record by ID."""
        meta_path = self._inf_dir(job_id, inf_id) / "meta.json"
        if not meta_path.exists():
            return None
        return self._load_record(meta_path)

    def list(self, job_id: str) -> list[InferenceRecord]:
        """List all inferences for a job, newest first."""
        inf_base = self.jobs_dir / job_id / "inferences"
        if not inf_base.exists():
            return []
        records: list[InferenceRecord] = []
        for d in inf_base.iterdir():
            mp = d / "meta.json"
            if d.is_dir() and mp.exists():
                records.append(self._load_record(mp))
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records

    def list_all(self) -> builtins.list[InferenceRecord]:
        """List all inferences across all jobs, newest first (H-0010)."""
        records: builtins.list[InferenceRecord] = []
        if not self.jobs_dir.exists():
            return records
        for job_dir in self.jobs_dir.iterdir():
            if not job_dir.is_dir():
                continue
            inf_base = job_dir / "inferences"
            if not inf_base.exists():
                continue
            for d in inf_base.iterdir():
                mp = d / "meta.json"
                if d.is_dir() and mp.exists():
                    records.append(self._load_record(mp))
        records.sort(key=lambda r: r.created_at, reverse=True)
        return records

    def get_predictions(
        self, job_id: str, inf_id: str, *, rows: int = 50, offset: int = 0
    ) -> dict[str, Any]:
        """Return paginated predictions."""
        pq = self._inf_dir(job_id, inf_id) / "predictions.parquet"
        if not pq.exists():
            return {"columns": [], "data": [], "total_rows": 0}
        df = pd.read_parquet(pq)
        total = len(df)
        page = df.iloc[offset : offset + rows]
        return {
            "columns": list(page.columns),
            "data": page.fillna("").to_dict("records"),
            "total_rows": total,
        }

    def get_metrics(self, job_id: str, inf_id: str) -> dict[str, Any] | None:
        """Return inference metrics (None if no ground truth)."""
        mp = self._inf_dir(job_id, inf_id) / "metrics.json"
        if not mp.exists():
            return None
        return json.loads(mp.read_text(encoding="utf-8"))  # type: ignore[no-any-return]

    def get_predictions_df(self, job_id: str, inf_id: str) -> pd.DataFrame | None:
        """Return full predictions DataFrame."""
        pq = self._inf_dir(job_id, inf_id) / "predictions.parquet"
        if not pq.exists():
            return None
        return pd.read_parquet(pq)

    # --- Internal ---

    @staticmethod
    def _load_record(meta_path: Path) -> InferenceRecord:
        raw = json.loads(meta_path.read_text(encoding="utf-8"))
        dr = raw["data_ref"]
        dr["shape"] = tuple(dr["shape"])
        return InferenceRecord(
            inf_id=raw["inf_id"],
            job_id=raw["job_id"],
            data_ref=DataRef(**dr),
            has_ground_truth=raw["has_ground_truth"],
            created_at=raw["created_at"],
            row_count=raw["row_count"],
            warnings=raw.get("warnings", []),
        )


# --- Run inference ---


def run_inference(
    *,
    job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    data_path: str,
    return_shap: bool = False,
    evaluate: bool = True,
) -> InferenceRecord:
    """Run prediction on new data using a completed job's model.

    When *evaluate* is True (default), ground truth is detected automatically
    and metrics are computed.  When False, metrics are skipped even if the
    target column exists in the data (H-0009).
    """
    # Load model
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)
    model = backend.load_model(job.model_path)

    # Load inference data
    df = load_dataframe(data_path)
    data_ref = make_data_ref(
        df, source_type="path", path=data_path, filename=Path(data_path).name
    )

    # Detect ground truth — check if training target column is in inference data
    model_info = backend.model_info(model)
    target_col: str | None = model_info.get("target")
    # Fallback: resolve target from stored job config
    if target_col is None and job.config:
        target_col = job.config.get("data", {}).get("target")

    has_ground_truth = evaluate and target_col is not None and target_col in df.columns

    # Run prediction
    pred_result = backend.predict(model, df, return_shap=return_shap)
    pred_df = pred_result.predictions

    # Add actual column if ground truth available
    if has_ground_truth and target_col is not None:
        pred_df["actual"] = df[target_col].values

    # Compute inference metrics if ground truth
    metrics: dict[str, Any] | None = None
    if has_ground_truth:
        metrics = _compute_inference_metrics(pred_df, model_info, job=job)

    # Create record
    inf_id = f"inf_{uuid4().hex[:8]}"
    record = InferenceRecord(
        inf_id=inf_id,
        job_id=job.job_id,
        data_ref=data_ref,
        has_ground_truth=has_ground_truth,
        created_at=datetime.now(timezone.utc).isoformat(),
        row_count=len(df),
        warnings=pred_result.warnings,
    )

    # Persist
    inf_store = InferenceStore(job_store.jobs_dir)
    inf_store.save(record, pred_df, metrics)

    return record


def _compute_inference_metrics(
    pred_df: pd.DataFrame,
    model_info: dict[str, Any],
    *,
    job: Job | None = None,
) -> dict[str, Any]:
    """Compute metrics and return IS/OOS/Inf 3-column structure.

    When a ``job`` with ``fit_result`` is available, the returned dict has
    the shape ``{"inf": {...}, "is": {...}, "oos": {...}}``.  Otherwise a
    flat dict of inference metrics is returned for backward compatibility.
    """
    inf_metrics = _compute_inf_metrics(pred_df, model_info)

    if job is None or job.fit_result is None:
        return inf_metrics

    # Extract IS / OOS from job's fit_result.metrics
    raw = job.fit_result.metrics
    raw_nested = raw.get("raw", {})
    if raw_nested:
        is_metrics: dict[str, Any] = dict(raw_nested.get("if_mean", {}))
        oos_metrics: dict[str, Any] = dict(raw_nested.get("oof", {}))
    else:
        # Flat metrics fallback — use same values for both IS and OOS
        is_metrics = {k: v for k, v in raw.items() if isinstance(v, (int, float))}
        oos_metrics = dict(is_metrics)

    return {"inf": inf_metrics, "is": is_metrics, "oos": oos_metrics}


def _compute_inf_metrics(
    pred_df: pd.DataFrame, model_info: dict[str, Any]
) -> dict[str, Any]:
    """Compute basic inference metrics from predictions vs actuals."""
    actual = pred_df["actual"]
    pred = pred_df["pred"]
    task = model_info.get("task", "regression")

    metrics: dict[str, Any] = {}

    if task == "regression":
        residuals = actual - pred
        metrics["mae"] = float(residuals.abs().mean())
        metrics["mse"] = float((residuals**2).mean())
        metrics["rmse"] = float((residuals**2).mean() ** 0.5)
        ss_res = float((residuals**2).sum())
        ss_tot = float(((actual - actual.mean()) ** 2).sum())
        metrics["r2"] = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0
    else:
        # Classification
        pred_labels = pred
        metrics["accuracy"] = float((pred_labels == actual).mean())
        if "proba" in pred_df.columns:
            try:
                from sklearn.metrics import (  # type: ignore[import-untyped]
                    log_loss,
                    roc_auc_score,
                )

                proba = pred_df["proba"]
                metrics["auc"] = float(roc_auc_score(actual, proba))
                metrics["logloss"] = float(log_loss(actual, proba))
            except Exception:  # noqa: BLE001
                logging.getLogger("lizystudio.inference").warning(
                    "Failed to compute AUC/logloss", exc_info=True
                )

    return metrics


def get_comparison_stats(
    inf_store: InferenceStore,
    job_id: str,
    inf_id: str,
    other_inf_id: str,
    *,
    task: str = "regression",
) -> dict[str, Any]:
    """Compare two inference runs on the same job.

    Returns base statistics for both runs, plus task-specific extras:
    - regression: ``median``
    - binary: ``positive_pct`` (percentage of predictions > 0.5)
    """
    df1 = inf_store.get_predictions_df(job_id, inf_id)
    df2 = inf_store.get_predictions_df(job_id, other_inf_id)
    if df1 is None or df2 is None:
        missing = inf_id if df1 is None else other_inf_id
        msg = f"Predictions not found for inference {missing}"
        raise ValueError(msg)

    def _stats(s: pd.Series[Any]) -> dict[str, float]:
        base: dict[str, float] = {
            "mean": float(s.mean()),
            "std": float(s.std()),
            "min": float(s.min()),
            "max": float(s.max()),
            "count": int(len(s)),
        }
        if task == "regression":
            base["median"] = float(s.median())
        elif task == "binary":
            base["positive_pct"] = float((s > 0.5).mean() * 100)
        return base

    result: dict[str, Any] = {
        "current": _stats(df1["pred"]),
        "other": _stats(df2["pred"]),
    }

    # Add proba stats if available
    if "proba" in df1.columns and "proba" in df2.columns:
        result["current_proba"] = _stats(df1["proba"])
        result["other_proba"] = _stats(df2["proba"])

    return result


def get_inference_plot(job: Job, backend: BackendAdapter, plot_type: str) -> Any:
    """Get a plot from the model used for an inference's parent job."""
    if job.model_path is None:
        msg = f"Job {job.job_id} has no saved model"
        raise ValueError(msg)
    model = backend.load_model(job.model_path)
    return backend.plot(model, plot_type)
