"""UI schema for the LizyML backend (H-0026).

Ported from LizyML-Widget's adapter_contract.py.
Contains only static data structures — no ML logic.
"""

from __future__ import annotations

import threading
from typing import Any

# --- Eval metrics registry lookup (cached) ---

_eval_metrics_cache: dict[str, list[str]] | None = None
_eval_metrics_lock: threading.Lock = threading.Lock()


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

            metrics = {task: sorted(ms) for task, ms in _TASK_METRICS.items()}
        except (ImportError, AttributeError, TypeError):
            # Fallback for older LizyML versions
            metrics = {
                "regression": sorted(["mae", "mape", "rmse", "huber", "r2", "rmsle"]),
                "binary": sorted(
                    [
                        "auc",
                        "logloss",
                        "auc_pr",
                        "f1",
                        "accuracy",
                        "brier",
                        "ece",
                        "precision_at_k",
                    ]
                ),
                "multiclass": sorted(
                    ["logloss", "f1", "accuracy", "auc", "auc_pr", "brier"]
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


# --- UI schema builder ---


def build_ui_schema(
    all_metrics_by_task: dict[str, list[str]],
) -> dict[str, Any]:
    """Build the full UI schema for the LizyML backend contract."""
    metric_directions = get_metric_directions()
    return {
        "sections": [
            {"key": "model", "title": "Model"},
            {"key": "training", "title": "Training"},
            {"key": "calibration", "title": "Calibration"},
            {"key": "evaluation", "title": "Evaluation"},
        ],
        "option_sets": {
            "objective": {
                "regression": [
                    "huber",
                    "mse",
                    "mae",
                    "quantile",
                    "mape",
                    "cross_entropy",
                ],
                "binary": [
                    "binary",
                    "cross_entropy",
                    "cross_entropy_lambda",
                ],
                "multiclass": [
                    "multiclass",
                    "softmax",
                    "multiclassova",
                ],
            },
            "metric": dict(all_metrics_by_task),
            "model_metric": {
                "regression": [
                    "huber",
                    "mae",
                    "mape",
                    "rmse",
                    "r2",
                    "rmsle",
                ],
                "binary": [
                    "auc",
                    "logloss",
                    "auc_pr",
                    "f1",
                    "accuracy",
                    "brier",
                    "ece",
                    "precision_at_k",
                ],
                "multiclass": [
                    "logloss",
                    "auc",
                    "auc_pr",
                    "f1",
                    "accuracy",
                    "brier",
                ],
            },
        },
        "metric_direction": metric_directions,
        "n_trials_presets": [10, 50, 100, 200, 500],
        "parameter_hints": [
            {
                "key": "objective",
                "label": "Objective",
                "kind": "objective",
                "default": {
                    "regression": "huber",
                    "binary": "binary",
                    "multiclass": "multiclass",
                },
            },
            {
                "key": "metric",
                "label": "Metric",
                "kind": "model_metric",
                "default": {
                    "regression": "rmse",
                    "binary": "auc",
                    "multiclass": "multi_logloss",
                },
            },
            {
                "key": "n_estimators",
                "label": "N Estimators",
                "kind": "integer",
                "step": 100,
                "default": 1000,
            },
            {
                "key": "learning_rate",
                "label": "Learning Rate",
                "kind": "number",
                "step": 0.001,
                "default": 0.1,
            },
            {
                "key": "max_depth",
                "label": "Max Depth",
                "kind": "integer",
                "step": 1,
                "default": -1,
            },
            {
                "key": "max_bin",
                "label": "Max Bin",
                "kind": "integer",
                "step": 1,
                "default": 255,
            },
            {
                "key": "feature_fraction",
                "label": "Feature Fraction",
                "kind": "number",
                "step": 0.05,
                "default": 1.0,
            },
            {
                "key": "bagging_fraction",
                "label": "Bagging Fraction",
                "kind": "number",
                "step": 0.05,
                "default": 1.0,
            },
            {
                "key": "bagging_freq",
                "label": "Bagging Freq",
                "kind": "integer",
                "step": 1,
                "default": 0,
            },
            {
                "key": "lambda_l1",
                "label": "Lambda L1",
                "kind": "number",
                "step": 0.0001,
                "default": 0.0,
            },
            {
                "key": "lambda_l2",
                "label": "Lambda L2",
                "kind": "number",
                "step": 0.0001,
                "default": 0.0,
            },
            {
                "key": "first_metric_only",
                "label": "First Metric Only",
                "kind": "boolean",
                "default": False,
            },
        ],
        "search_space_catalog": [
            {
                "key": "objective",
                "title": "Objective",
                "paramType": "string",
                "modes": ["fixed", "choice"],
                "group": "model_params",
                "default": {
                    "regression": "huber",
                    "binary": "binary",
                    "multiclass": "multiclass",
                },
            },
            {
                "key": "metric",
                "title": "Metric",
                "paramType": "string",
                "modes": ["fixed", "choice"],
                "group": "model_params",
                "default": {
                    "regression": "rmse",
                    "binary": "auc",
                    "multiclass": "multi_logloss",
                },
            },
            {
                "key": "n_estimators",
                "title": "N Estimators",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 1000,
            },
            {
                "key": "learning_rate",
                "title": "Learning Rate",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.1,
            },
            {
                "key": "max_depth",
                "title": "Max Depth",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": -1,
            },
            {
                "key": "max_bin",
                "title": "Max Bin",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 255,
            },
            {
                "key": "feature_fraction",
                "title": "Feature Fraction",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 1.0,
            },
            {
                "key": "bagging_fraction",
                "title": "Bagging Fraction",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 1.0,
            },
            {
                "key": "bagging_freq",
                "title": "Bagging Freq",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0,
            },
            {
                "key": "lambda_l1",
                "title": "Lambda L1",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.0,
            },
            {
                "key": "lambda_l2",
                "title": "Lambda L2",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.0,
            },
            {
                "key": "first_metric_only",
                "title": "First Metric Only",
                "paramType": "boolean",
                "modes": ["fixed", "choice"],
                "group": "model_params",
                "default": False,
            },
            {
                "key": "auto_num_leaves",
                "title": "Auto Num Leaves",
                "paramType": "boolean",
                "modes": ["fixed", "choice"],
                "group": "smart_params",
                "default": True,
            },
            {
                "key": "num_leaves_ratio",
                "title": "Num Leaves Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 1.0,
            },
            {
                "key": "min_data_in_leaf_ratio",
                "title": "Min Data in Leaf Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 0.01,
            },
            {
                "key": "min_data_in_bin_ratio",
                "title": "Min Data in Bin Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 0.01,
            },
            # ── Training group ──
            {
                "key": "seed",
                "title": "Seed",
                "paramType": "integer",
                "modes": ["fixed"],
                "group": "training",
                "default": 42,
            },
            {
                "key": "early_stopping.enabled",
                "title": "Early Stopping",
                "paramType": "boolean",
                "modes": ["fixed"],
                "group": "training",
                "default": True,
            },
            {
                "key": "early_stopping.rounds",
                "title": "Early Stopping Rounds",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "training",
                "default": 150,
            },
            {
                "key": "validation_ratio",
                "title": "Validation Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "training",
                "default": 0.1,
            },
            {
                "key": "inner_valid",
                "title": "Inner Validation",
                "paramType": "string",
                "modes": ["fixed"],
                "group": "training",
                "default": "holdout",
            },
        ],
        "step_map": {
            "n_estimators": 100,
            "learning_rate": 0.001,
            "max_depth": 1,
            "max_bin": 1,
            "feature_fraction": 0.05,
            "bagging_fraction": 0.05,
            "bagging_freq": 1,
            "lambda_l1": 0.0001,
            "lambda_l2": 0.0001,
            "num_leaves_ratio": 0.05,
            "num_leaves": 1,
            "min_data_in_leaf_ratio": 0.001,
            "min_data_in_bin_ratio": 0.001,
            "early_stopping.rounds": 50,
            "validation_ratio": 0.05,
            "seed": 1,
        },
        "conditional_visibility": {
            "calibration": {"task": ["binary"]},
            "num_leaves_ratio": {"auto_num_leaves": True},
            "num_leaves": {"auto_num_leaves": False},
            "early_stopping.rounds": {"early_stopping.enabled": True},
            "validation_ratio": {"early_stopping.enabled": True},
            "inner_valid": {"early_stopping.enabled": True},
        },
        "defaults": {
            "calibration": {
                "method": "platt",
                "n_splits": 5,
                "params": {},
            },
        },
        "inner_valid_options": [
            "holdout",
            "group_holdout",
            "time_holdout",
        ],
        "capabilities": {
            "cv_strategies": [
                "kfold",
                "stratified_kfold",
                "group_kfold",
                "stratified_group_kfold",
                "time_series",
                "purged_time_series",
                "group_time_series",
                "blocked_group_kfold",
            ],
            "tune": {"allow_empty_space": True},
        },
        "calibration_methods": ["platt", "isotonic", "beta"],
        "additional_params": [
            "min_child_weight",
            "min_split_gain",
            "subsample",
            "colsample_bytree",
            "scale_pos_weight",
            "cat_smooth",
            "cat_l2",
            "max_cat_threshold",
            "path_smooth",
            "extra_trees",
            "num_leaves",
            "log_output",
        ],
    }
