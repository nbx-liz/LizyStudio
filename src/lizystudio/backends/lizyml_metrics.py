"""Eval-metrics registry lookup and metric direction helpers for LizyML."""

from __future__ import annotations

import threading

# --- Eval metrics registry lookup (cached) ---

_eval_metrics_cache: dict[str, list[str]] | None = None
_eval_metrics_lock: threading.Lock = threading.Lock()

# Preferred metric per task — shown first in UI (Widget conformance).
_PREFERRED_METRIC: dict[str, str] = {
    "binary": "auc",
    "regression": "rmse",
    "multiclass": "auc",
}


def _sort_with_preferred(metrics: list[str], task: str) -> list[str]:
    """Sort metrics alphabetically but place the preferred metric first."""
    preferred = _PREFERRED_METRIC.get(task)
    ordered = sorted(metrics)
    if preferred and preferred in ordered:
        ordered = [preferred, *(m for m in ordered if m != preferred)]
    return ordered


def get_eval_metrics_by_task() -> dict[str, list[str]]:
    """Query LizyML's metric registry for available evaluation metrics per task."""
    global _eval_metrics_cache  # noqa: PLW0603

    if _eval_metrics_cache is not None:
        return _eval_metrics_cache
    with _eval_metrics_lock:
        if _eval_metrics_cache is not None:
            return _eval_metrics_cache
        metrics: dict[str, list[str]]
        try:
            from lizyml.metrics.registry import _TASK_METRICS

            metrics = {
                task: _sort_with_preferred(list(ms), task)
                for task, ms in _TASK_METRICS.items()
            }
        except (ImportError, AttributeError, TypeError):
            # Fallback for older LizyML versions
            metrics = {
                "regression": _sort_with_preferred(
                    ["mae", "mape", "rmse", "huber", "r2", "rmsle"], "regression"
                ),
                "binary": _sort_with_preferred(
                    [
                        "auc",
                        "logloss",
                        "auc_pr",
                        "f1",
                        "accuracy",
                        "brier",
                        "ece",
                        "precision_at_k",
                    ],
                    "binary",
                ),
                "multiclass": _sort_with_preferred(
                    ["logloss", "f1", "accuracy", "auc", "auc_pr", "brier"],
                    "multiclass",
                ),
            }
        _eval_metrics_cache = metrics
        return metrics


# --- Metric direction lookup (cached) ---

_metric_direction_cache: dict[str, dict[str, str]] | None = None
_metric_direction_lock: threading.Lock = threading.Lock()


def get_metric_directions() -> dict[str, dict[str, str]]:
    """Return {task: {metric: 'minimize'|'maximize'}} from LizyML registry."""
    global _metric_direction_cache  # noqa: PLW0603

    if _metric_direction_cache is not None:
        return _metric_direction_cache
    with _metric_direction_lock:
        if _metric_direction_cache is not None:
            return _metric_direction_cache
        result: dict[str, dict[str, str]] = {}
        metrics_by_task = get_eval_metrics_by_task()
        try:
            from lizyml.metrics.registry import get_metric

            for task, metric_names in metrics_by_task.items():
                task_dirs: dict[str, str] = {}
                for name in metric_names:
                    try:
                        m = get_metric(name)
                        task_dirs[name] = (
                            "maximize" if m.greater_is_better else "minimize"
                        )
                    except Exception:  # noqa: BLE001
                        task_dirs[name] = "minimize"
                result[task] = task_dirs
        except (ImportError, AttributeError):
            # Fallback
            maximize = {"auc", "auc_pr", "r2", "accuracy", "f1", "auc_mu"}
            for task, metric_names in metrics_by_task.items():
                result[task] = {
                    m: "maximize" if m in maximize else "minimize" for m in metric_names
                }
        _metric_direction_cache = result
        return result
