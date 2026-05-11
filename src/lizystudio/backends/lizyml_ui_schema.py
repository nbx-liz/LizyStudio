"""UI schema for the LizyML backend (H-0026).

Ported from LizyML-Widget's adapter_contract.py.
Contains only static data structures — no ML logic, except for the
``option_sets.objective`` / ``option_sets.metric`` / ``parameter_bounds``
blocks which are sourced from LizyML's ``LGBMProvider`` (P-0104 Wave
3.1a / 3.1b) so the Studio UI always reflects the canonical objective
list / model-metric choices / hyper-parameter bounds shipped with the
installed LizyML version. The ``option_sets.eval_metric`` block is the
eval-metrics registry list (LizyML post-hoc reporting metrics, distinct
from the LightGBM ``metric`` param) used by the Tune Evaluation section.
"""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any, Literal

from lizystudio.backends.lizyml_constants import _build_additional_params
from lizystudio.backends.lizyml_metrics import (
    get_eval_metrics_by_task as get_eval_metrics_by_task,
)
from lizystudio.backends.lizyml_metrics import (
    get_metric_directions,
)

if TYPE_CHECKING:
    from lizyml.estimators.lgbm.provider import LGBMProvider

# --- LizyML EstimatorProvider (SSOT for objective / parameter bounds) ---

_Task = Literal["regression", "binary", "multiclass"]

_provider_cache: LGBMProvider | None = None
_provider_lock: threading.Lock = threading.Lock()

# Tasks the LizyML LGBM provider recognises, in canonical UI order.
_TASKS: tuple[_Task, ...] = ("regression", "binary", "multiclass")


def _get_lgbm_provider() -> LGBMProvider:
    """Return a process-wide cached ``LGBMProvider`` instance.

    ``build_ui_schema`` is invoked per ``GET /ui-schema`` request; the
    provider is stateless and cheap to keep alive, so a singleton avoids
    re-instantiating it on every call.
    """
    global _provider_cache  # noqa: PLW0603
    if _provider_cache is not None:
        return _provider_cache
    with _provider_lock:
        if _provider_cache is not None:
            return _provider_cache
        from lizyml.estimators.lgbm.provider import LGBMProvider

        _provider_cache = LGBMProvider()
        return _provider_cache


def _build_objective_option_sets() -> dict[str, list[str]]:
    """``{task: [objective, ...]}`` straight from LizyML canonical list."""
    provider = _get_lgbm_provider()
    return {task: list(provider.objective_choices(task)) for task in _TASKS}


def _build_metric_option_sets() -> dict[str, dict[str, list[str]]]:
    """``{task: {"native": [...], "feval": [...]}}`` from the provider.

    ``native`` are LightGBM's built-in ``metric`` names; ``feval`` are
    LizyML's custom feval implementations (slower — they re-evaluate the
    model in Python on every boosting round). The UI shows both as
    model-metric (``model.params.metric``) options and badges the feval
    ones as "Custom (slow)" so the speed trade-off is visible (P-0104 Q2).
    """
    provider = _get_lgbm_provider()
    out: dict[str, dict[str, list[str]]] = {}
    for task in _TASKS:
        choices = provider.metric_choices(task)
        out[task] = {
            "native": list(choices["native"]),
            "feval": list(choices["feval"]),
        }
    return out


def _build_eval_metric_option_sets() -> dict[str, list[str]]:
    """``{task: [metric, ...]}`` from LizyML's eval-metrics registry.

    These are the post-hoc reporting metrics LizyML computes after a fit
    / tune (``auc_pr``, ``logloss``, ...), *not* the LightGBM ``metric``
    param. Used by the Tune Evaluation section (Optimization Metric /
    Additional Metrics).
    """
    return {task: list(ms) for task, ms in get_eval_metrics_by_task().items()}


def _build_parameter_bounds() -> dict[str, dict[str, dict[str, float | int]]]:
    """``{task: {param: {"min": ..., "max": ...}}}`` from the provider.

    Keys use LizyML's canonical parameter names (e.g. ``early_stopping_rounds``);
    the frontend maps the dotted ``search_space_catalog`` key
    (``early_stopping.rounds``) onto the underscored bound key.
    """
    provider = _get_lgbm_provider()
    return {task: dict(provider.parameter_bounds(task)) for task in _TASKS}


# --- UI schema builder ---


def build_ui_schema() -> dict[str, Any]:
    """Build the full UI schema for the LizyML backend contract."""
    metric_directions = get_metric_directions()
    return {
        "sections": [
            {"key": "model", "title": "Model"},
            {"key": "training", "title": "Training"},
            {"key": "calibration", "title": "Calibration"},
            {"key": "evaluation", "title": "Evaluation"},
        ],
        # P-0104 Wave 3.1b / Issue #461 (Q3): ``option_sets.model_metric``
        # was removed and folded into ``option_sets.metric``. ``metric`` is
        # now the nested ``{task: {native, feval}}`` shape sourced straight
        # from ``LGBMProvider.metric_choices(task)`` — the LightGBM
        # ``model.params.metric`` options. The eval-metrics registry list
        # (post-hoc reporting metrics) moved to ``option_sets.eval_metric``.
        "option_sets": {
            "objective": _build_objective_option_sets(),
            "metric": _build_metric_option_sets(),
            "eval_metric": _build_eval_metric_option_sets(),
        },
        "metric_direction": metric_directions,
        # P-0104 Wave 3.1a / Issue #461: hyper-parameter bounds straight
        # from LizyML's ``LGBMProvider.parameter_bounds(task)``. The
        # frontend clamps SearchSpace Range Min/Max inputs to these.
        # Keys are LizyML's canonical names (``early_stopping_rounds``);
        # the dotted ``search_space_catalog`` key (``early_stopping.rounds``)
        # is mapped onto it client-side.
        "parameter_bounds": _build_parameter_bounds(),
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
                "kind": "metric",
                "default": {
                    "regression": ["huber", "mae", "mape"],
                    "binary": ["auc", "binary_logloss"],
                    "multiclass": ["auc_mu", "multi_logloss"],
                },
            },
            {
                "key": "n_estimators",
                "label": "N Estimators",
                "kind": "integer",
                "step": 100,
                "default": 1500,
            },
            {
                "key": "learning_rate",
                "label": "Learning Rate",
                "kind": "number",
                "step": 0.001,
                "default": 0.001,
            },
            {
                "key": "max_depth",
                "label": "Max Depth",
                "kind": "integer",
                "step": 1,
                "default": 5,
            },
            {
                "key": "max_bin",
                "label": "Max Bin",
                "kind": "integer",
                "step": 1,
                "default": 511,
            },
            {
                "key": "feature_fraction",
                "label": "Feature Fraction",
                "kind": "number",
                "step": 0.05,
                "default": 0.7,
            },
            {
                "key": "bagging_fraction",
                "label": "Bagging Fraction",
                "kind": "number",
                "step": 0.05,
                "default": 0.7,
            },
            {
                "key": "bagging_freq",
                "label": "Bagging Freq",
                "kind": "integer",
                "step": 1,
                "default": 10,
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
                "default": 0.000001,
            },
            {
                "key": "first_metric_only",
                "label": "First Metric Only",
                "kind": "boolean",
                "default": False,
            },
            {
                "key": "verbose",
                "label": "Log Output",
                "kind": "integer",
                "step": 1,
                "default": -1,
            },
            {
                "key": "num_leaves",
                "label": "Num Leaves",
                "kind": "integer",
                "step": 1,
                "default": 256,
            },
        ],
        "search_space_catalog": [
            # ── Smart Params group (Widget order: Smart first) ──
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
                "default_mode": "range",
                "default_range": {"low": 0.4, "high": 1.0, "log": False},
            },
            {
                "key": "num_leaves",
                "title": "Num Leaves",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 256,
            },
            {
                "key": "min_data_in_leaf_ratio",
                "title": "Min Data in Leaf Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 0.01,
                "default_mode": "range",
                "default_range": {"low": 0.01, "high": 0.2, "log": False},
            },
            {
                "key": "min_data_in_bin_ratio",
                "title": "Min Data in Bin Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "smart_params",
                "default": 0.01,
                "default_mode": "range",
                "default_range": {"low": 0.01, "high": 0.2, "log": False},
            },
            {
                "key": "feature_weights",
                "title": "Feature Weights",
                "paramType": "object",
                "modes": ["fixed"],
                "group": "smart_params",
                "default": None,
            },
            {
                "key": "balanced",
                "title": "Balanced",
                "paramType": "boolean",
                "modes": ["fixed", "choice"],
                "group": "smart_params",
                "default": True,
            },
            # ── Model Params group ──
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
                "key": "first_metric_only",
                "title": "First Metric Only",
                "paramType": "boolean",
                "modes": ["fixed", "choice"],
                "group": "model_params",
                "default": True,
            },
            {
                "key": "n_estimators",
                "title": "N Estimators",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 1500,
                "default_mode": "range",
                "default_range": {"low": 500, "high": 2000, "log": False},
            },
            {
                "key": "learning_rate",
                "title": "Learning Rate",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.001,
                "default_mode": "range",
                "default_range": {"low": 0.0001, "high": 0.01, "log": True},
            },
            {
                "key": "max_depth",
                "title": "Max Depth",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 5,
                "default_mode": "range",
                "default_range": {"low": 3, "high": 9, "log": False},
            },
            {
                "key": "max_bin",
                "title": "Max Bin",
                "paramType": "integer",
                "modes": ["fixed", "choice"],
                "group": "model_params",
                "default": 511,
                "default_mode": "choice",
                "default_choices": [15, 63, 127, 255, 511],
            },
            {
                "key": "feature_fraction",
                "title": "Feature Fraction",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.7,
                "default_mode": "range",
                "default_range": {"low": 0.5, "high": 1.0, "log": False},
            },
            {
                "key": "bagging_fraction",
                "title": "Bagging Fraction",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.7,
                "default_mode": "range",
                "default_range": {"low": 0.5, "high": 1.0, "log": False},
            },
            {
                "key": "bagging_freq",
                "title": "Bagging Freq",
                "paramType": "integer",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 10,
                "default_mode": "range",
                "default_range": {"low": 1, "high": 10, "log": False},
            },
            {
                "key": "lambda_l1",
                "title": "Lambda L1",
                "paramType": "number",
                "modes": ["fixed"],
                "group": "model_params",
                "default": 0.0,
            },
            {
                "key": "lambda_l2",
                "title": "Lambda L2",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "model_params",
                "default": 0.000001,
                "default_mode": "range",
                "default_range": {"low": 1e-6, "high": 1e-2, "log": True},
            },
            {
                "key": "verbose",
                "title": "Log Output",
                "paramType": "integer",
                "modes": ["fixed"],
                "group": "model_params",
                "default": -1,
            },
            # ── Training group ──
            {
                "key": "seed",
                "title": "Seed",
                "paramType": "integer",
                "modes": ["fixed"],
                "group": "training",
                "default": 1120,
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
                "default_mode": "range",
                "default_range": {"low": 50, "high": 200, "log": False},
            },
            {
                "key": "validation_ratio",
                "title": "Validation Ratio",
                "paramType": "number",
                "modes": ["fixed", "range"],
                "group": "training",
                "default": 0.1,
                "default_mode": "range",
                "default_range": {"low": 0.1, "high": 0.3, "log": False},
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
            "min_data_in_leaf_ratio": 0.01,
            "min_data_in_bin_ratio": 0.01,
            "early_stopping.rounds": 50,
            "validation_ratio": 0.05,
            "seed": 1,
            # Additional params step values
            "min_child_weight": 0.001,
            "min_split_gain": 0.001,
            "scale_pos_weight": 0.1,
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
                "method": "isotonic",
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
            # H-0076 (C-5b Part 2): this map is the SSOT for the
            # frontend CV-section conditional-field rendering AND for
            # the values the UI writes into ``split`` / ``data``. Field
            # names match the LizyConfig schema (e.g. ``train_size_max``,
            # not the splitter's kwarg ``max_train_size``); ``time_col``
            # / ``group_col`` are UI-level inputs that land in
            # ``data`` rather than ``split``.
            #
            # Field ordering within each list is UI-presentation order
            # (top-to-bottom in the form). Consumers treat the list as
            # a set via ``.includes(...)`` / ``in`` — order has no
            # semantic effect on the wire payload.
            # Issue #258 / #259: every field must exist on the matching
            # Pydantic variant (or on DataConfig for target/time_col/
            # group_col). The contract test
            # ``tests/contract/test_ui_schema_matches_pydantic.py``
            # locks this invariant. Do not add a field here without
            # extending the corresponding Pydantic model first.
            "cv_strategy_fields": {
                "kfold": ["n_splits", "random_state", "shuffle"],
                "stratified_kfold": ["n_splits", "random_state"],
                "group_kfold": ["n_splits", "group_col"],
                "stratified_group_kfold": [
                    "n_splits",
                    "random_state",
                    "shuffle",
                    "group_col",
                ],
                "time_series": [
                    "n_splits",
                    "time_col",
                    "gap",
                    "train_size_max",
                    "test_size_max",
                ],
                "purged_time_series": [
                    "n_splits",
                    "time_col",
                    "purge_gap",
                    "embargo",
                    "train_size_max",
                    "test_size_max",
                ],
                "group_time_series": [
                    "n_splits",
                    "time_col",
                    "group_col",
                    "gap",
                    "train_size_max",
                    "test_size_max",
                ],
                # blocked_group_kfold has no `n_splits` — the two axes
                # (period blocks, group KFold) are configured via
                # ``blocks`` / ``groups`` sub-objects on the Pydantic
                # model. The UI renders those via a dedicated editor.
                "blocked_group_kfold": [
                    "time_col",
                    "group_col",
                    "min_train_rows",
                    "min_valid_rows",
                ],
            },
            "cv_defaults": {
                "n_splits": 5,
                "shuffle": True,
                "random_state": 42,
                "gap": 0,
            },
            "cv_default_strategy": {
                "binary": "stratified_kfold",
                "multiclass": "stratified_kfold",
                "regression": "kfold",
            },
        },
        "calibration_methods": ["platt", "isotonic", "beta"],
        "additional_params": _build_additional_params(),
        "special_search_space_fields": {
            "objective": "objective",
            "metric": "metric",
            "inner_valid": "inner_valid_picker",
        },
    }
