"""Config-related methods for LizyMLAdapter."""

from __future__ import annotations

import json
from typing import Any, Literal

import pandas as pd
import yaml

from lizystudio.backends.lizyml_metrics import get_metric_directions
from lizystudio.backends.lizyml_ui_schema import _SEARCH_SPACE_CATALOG
from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    IncompatibleMetric,
    TuningConfig,
    TuningDefaults,
    TuningOverrides,
)

from .config_compat import strip_internal_keys, task_params_compat_errors

# Regression metrics whose value is undefined / degenerate for certain target
# distributions. The Service layer used to hardcode this watchlist (Issue #394);
# P-0106 (#403) moved it here so the metric vocabulary stays owned by the
# backend — a second backend declares its own watchlist (or none).
_REGRESSION_METRIC_WATCHLIST = frozenset({"mape", "rmsle", "r2"})


# P-0109 PR-3 / Issue #517 follow-up: per-task canonical default evaluation
# metric list. Was previously a frontend-only constant
# (``TASK_DEFAULT_METRICS`` in ``TuneEvaluationSection.tsx``); moved here so
# the backend owns the SSOT and the frontend no longer needs adapter-specific
# branches (INV-T5). Multiclass / regression defaults remain deferred —
# see P-0104 Wave 2.3 (Issue #459) for the scope statement.
_TASK_DEFAULT_METRICS: dict[str, list[str]] = {
    "binary": ["auc", "auc_pr", "brier", "logloss"],
}

# P-0109 PR-3: tasks the lizyml catalog defaults apply to. Anything outside
# this set (``""`` / unknown) yields an empty :class:`TuningDefaults` —
# the adapter cannot propose canonical Tune defaults without a task.
_KNOWN_TASKS: frozenset[str] = frozenset({"binary", "multiclass", "regression"})


def _catalog_default_space() -> dict[str, dict[str, Any]]:
    """Project the lizyml UI catalog into Optuna SpaceEntry dicts (P-0109 PR-3).

    Only entries declaring ``default_mode = "range"`` or
    ``default_mode = "choice"`` contribute — ``"fixed"`` entries have no
    canonical search space, they are just fixed values. The resulting
    dict matches the shape ``lizyml.tuning.parse_space()`` accepts.

    Returns a fresh dict on each call so callers may safely keep the
    result inside an otherwise-frozen ``TuningDefaults`` snapshot.
    """
    out: dict[str, dict[str, Any]] = {}
    for entry in _SEARCH_SPACE_CATALOG:
        mode = entry.get("default_mode")
        key = entry["key"]
        if mode == "range":
            r = entry.get("default_range", {})
            param_type = "int" if entry.get("paramType") == "integer" else "float"
            out[key] = {
                "type": param_type,
                "low": r.get("low"),
                "high": r.get("high"),
                "log": bool(r.get("log", False)),
            }
        elif mode == "choice":
            out[key] = {
                "type": "categorical",
                "choices": list(entry.get("default_choices", [])),
            }
    return out


class ConfigMixin:
    """Identification, schema, validation, and config file loading."""

    @property
    def info(self) -> BackendInfo:
        import lizyml

        return BackendInfo(name="lizyml", version=lizyml.__version__)

    def get_tuning_defaults(self, task: str) -> TuningDefaults:
        """Catalog-aware Tune defaults for the lizyml backend (P-0109 PR-3).

        Implements :meth:`BackendCore.get_tuning_defaults` for lizyml by
        projecting three SSOTs that already live inside the adapter:

        * ``lizyml_ui_schema._SEARCH_SPACE_CATALOG`` (via
          :func:`_catalog_default_space`) — the catalog rows with
          ``default_mode = "range" | "choice"`` define the per-key search
          space defaults.
        * ``_TASK_DEFAULT_METRICS`` — the per-task canonical evaluation
          metric list (Studio-side; binary only as of P-0104 Wave 2.3 /
          Issue #459).
        * ``lizyml_metrics.get_metric_directions`` — the optimisation
          direction implied by the first canonical metric, derived from
          lizyml's metric registry (single SSOT, INV-T3).

        Tasks outside ``{"binary", "multiclass", "regression"}`` (and the
        empty string) yield an empty :class:`TuningDefaults` — the
        adapter cannot propose canonical defaults without a task.
        """
        if task not in _KNOWN_TASKS:
            return TuningDefaults()
        space = _catalog_default_space()
        metrics: list[Any] = list(_TASK_DEFAULT_METRICS.get(task, []))
        direction: Literal["maximize", "minimize"] | None = None
        if metrics:
            task_dirs = get_metric_directions().get(task, {})
            canonical = task_dirs.get(str(metrics[0]))
            if canonical == "maximize":
                direction = "maximize"
            elif canonical == "minimize":
                direction = "minimize"
        return TuningDefaults(
            space=space,
            evaluation_metrics=metrics,
            direction=direction,
        )

    def compute_effective_tuning(
        self, task: str, overrides: TuningOverrides
    ) -> TuningConfig:
        """Merge :meth:`get_tuning_defaults` for *task* with *overrides*.

        Catalog-aware as of P-0109 PR-3: defaults are sourced from
        :func:`_catalog_default_space` + :data:`_TASK_DEFAULT_METRICS` +
        ``lizyml_metrics.get_metric_directions``. ``ConfigMixin`` does
        not inherit from ``BackendCore`` (the adapter satisfies the
        Protocol via duck typing), so the merge logic is inlined here
        instead of delegating via ``super()``.

        Direction semantics (P-0109 PR-6b refinement, INV-T3): the
        ``direction`` field is now derived from the *effective* first
        evaluation metric — meaning when *overrides* override the
        ``evaluation_metrics`` list, the direction follows the new
        metric, not the catalog's canonical direction. Previously the
        method returned ``defaults.direction`` whenever the user did
        not set ``overrides.direction`` explicitly, which let a user
        flip from ``auc`` (maximize) to ``logloss`` (minimize) while
        leaving ``effective.direction = "maximize"`` — a stale value
        that ``services/training.py::_prepare_tune_config`` used to
        silently correct via a hardcoded ``maximize_metrics`` set.
        PR-6b deletes that downstream re-resolve in favour of doing
        the right thing here.
        """
        defaults = self.get_tuning_defaults(task)
        fields_set = overrides.model_fields_set
        user_set: list[str] = [
            name
            for name in ("n_trials", "timeout", "direction", "evaluation_metrics")
            if name in fields_set
        ]
        user_set.extend(f"space.{key}" for key in overrides.space)
        merged_space = {**defaults.space, **overrides.space}
        merged_metrics = (
            overrides.evaluation_metrics
            if overrides.evaluation_metrics is not None
            else defaults.evaluation_metrics
        )
        direction: Literal["maximize", "minimize"]
        if overrides.direction is not None:
            direction = overrides.direction
        else:
            derived = self._direction_from_metrics(task, merged_metrics)
            if derived is not None:
                direction = derived
            elif defaults.direction is not None:
                direction = defaults.direction
            else:
                direction = "minimize"
        return TuningConfig(
            n_trials=overrides.n_trials if overrides.n_trials is not None else 50,
            timeout=overrides.timeout if "timeout" in fields_set else None,
            direction=direction,
            space=merged_space,
            evaluation_metrics=merged_metrics,
            user_set_paths=user_set,
        )

    @staticmethod
    def _direction_from_metrics(
        task: str, metrics: list[Any]
    ) -> Literal["maximize", "minimize"] | None:
        """Look up the lizyml metric registry direction for *metrics[0]*.

        Returns ``None`` when *task* / *metrics* / the metric name are
        unknown to the registry. The caller falls back to
        :attr:`TuningDefaults.direction` (catalog canonical) and then to
        ``"minimize"`` as the final safe default.

        MetricEntry inputs accept both the bare ``"auc"`` string form
        and the dict form ``{"precision_at_k": {"k": 10}}`` — the
        registry is keyed by metric name so the dict's first key is
        extracted.
        """
        if not metrics:
            return None
        first = metrics[0]
        if isinstance(first, str):
            name = first
        elif isinstance(first, dict) and first:
            name = next(iter(first))
        else:
            return None
        canonical = get_metric_directions().get(task, {}).get(name)
        if canonical == "maximize":
            return "maximize"
        if canonical == "minimize":
            return "minimize"
        return None

    def get_ui_schema(self) -> dict[str, Any]:
        from lizystudio.backends.lizyml_ui_schema import build_ui_schema

        return build_ui_schema()

    def get_config_schema(self) -> ConfigSchema:
        from lizyml.config.schema import LizyMLConfig

        return ConfigSchema(json_schema=LizyMLConfig.model_json_schema())

    def get_default_config(self, task: str, target: str) -> dict[str, Any]:
        from lizyml.config.schema import LizyMLConfig

        is_classification = task in ("binary", "multiclass")
        split_method = "stratified_kfold" if is_classification else "kfold"
        # P-0104 Wave 2.2 / Issue #459: Studio overrides the library default
        # ``TrainingConfig.seed = 42`` with 1120 at the default-config layer.
        # This keeps fresh Fit-tab configs aligned with the Tune-tab seed
        # default already at 1120 (see ``lizyml_ui_schema.search_space_catalog``)
        # so the Fit / Tune split is reproducible without manual override.
        minimal = {
            "config_version": 1,
            "task": task,
            "data": {"target": target},
            "model": {"name": "lgbm"},
            "split": {"method": split_method},
            "training": {"seed": 1120},
        }
        validated = LizyMLConfig.model_validate(minimal)
        return validated.model_dump(mode="json")

    def validate_config(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        from lizyml.config.schema import LizyMLConfig
        from pydantic import ValidationError

        clean = self._strip_internal_keys(config)
        errors: list[dict[str, Any]] = []
        try:
            LizyMLConfig.model_validate(clean)
        except ValidationError as exc:
            errors.extend(exc.errors())  # type: ignore[arg-type]

        errors.extend(task_params_compat_errors(clean))
        return errors

    def get_incompatible_metrics(
        self,
        task: str,
        target_series: pd.Series,
        metric_names: set[str],
    ) -> list[IncompatibleMetric]:
        """Regression metrics whose preconditions ``target_series`` violates.

        Implements :meth:`BackendCore.get_incompatible_metrics` for lizyml.
        The watchlist is regression-specific (lizyml/metrics/regression.py
        raises mid-fit for these), so non-regression tasks and non-numeric
        targets short-circuit to ``[]``:

        * ``mape``  — undefined when ``y_true`` contains zeros
        * ``rmsle`` — undefined when ``y_true`` contains negative values
        * ``r2``    — degenerate (NaN / +/-inf) when the target is constant
                      (variance == 0, or < 2 non-null observations)

        Each entry's ``suggested_fix`` names the metric to drop and, for
        ``mape``, points at lizyml >= 0.11.0's zero-tolerant ``smape`` /
        ``wape`` as alternatives.
        """
        if task != "regression":
            return []
        if not pd.api.types.is_numeric_dtype(target_series):
            return []
        watched = metric_names & _REGRESSION_METRIC_WATCHLIST
        if not watched:
            return []

        col = str(target_series.name)
        out: list[IncompatibleMetric] = []
        if "mape" in watched and bool((target_series == 0).any()):
            out.append(
                IncompatibleMetric(
                    metric="mape",
                    message=(
                        f"MAPE is undefined when target column '{col}' contains zeros."
                    ),
                    suggested_fix=(
                        "Remove 'mape' from evaluation.metrics — or replace it "
                        "with 'smape' / 'wape' which tolerate zero targets "
                        "(lizyml >= 0.11.0)."
                    ),
                )
            )
        if "rmsle" in watched and bool((target_series < 0).any()):
            out.append(
                IncompatibleMetric(
                    metric="rmsle",
                    message=(
                        f"RMSLE is undefined when target column '{col}' "
                        f"contains negative values."
                    ),
                    suggested_fix="Remove 'rmsle' from evaluation.metrics.",
                )
            )
        if "r2" in watched:
            # Constant target → variance == 0. ``std(skipna=True)`` returns
            # NaN for < 2 non-null observations, which we also treat as
            # "cannot compute R²".
            std = target_series.std(skipna=True)
            if pd.isna(std) or float(std) == 0.0:
                out.append(
                    IncompatibleMetric(
                        metric="r2",
                        message=(
                            f"R² is undefined when target column '{col}' is "
                            f"constant (variance == 0)."
                        ),
                        suggested_fix="Remove 'r2' from evaluation.metrics.",
                    )
                )
        return out

    def validate_search_space(self, space: dict[str, Any]) -> list[dict[str, Any]]:
        """Structural validation of ``tuning.optuna.space`` for lizyml.

        Implements :meth:`BackendCore.validate_search_space` (P-0108,
        Issue #474). The two structurally-broken cases that
        ``parse_space()`` rejects are exposed here at the run-gate so
        the user sees "Fix validation errors first" with a concrete
        suggested_fix instead of "All tuning trials failed" deep in the
        Optuna loop.

        Out of scope (mirrored from the Protocol docstring): empty
        categorical ``choices``. The frontend's ``empty-choice-banner``
        already owns that UX, so we tolerate / drop the
        empty-categorical entries before calling ``parse_space()``
        (which itself rejects them with a CONFIG_INVALID error). This
        keeps ``PUT /config`` permissive for in-progress edits — the
        save gate (P-0089) is permissive; only the run-gate is strict.

        The function evaluates each entry independently so a single
        broken row does not mask drift in the rest of the space.
        """
        from lizyml.core.exceptions import LizyMLError
        from lizyml.tuning import parse_space

        if not isinstance(space, dict) or not space:
            return []

        out: list[dict[str, Any]] = []
        for name, raw in space.items():
            if not isinstance(raw, dict):
                continue
            # Filter out the frontend-owned empty-choices state. lizyml's
            # parse_space() would reject this, but the Studio gate must
            # not — see the docstring + PR #473 post-mortem.
            if (
                raw.get("type") == "categorical"
                and isinstance(raw.get("choices"), list)
                and len(raw["choices"]) == 0
            ):
                continue
            try:
                parse_space({name: raw})
            except LizyMLError as exc:
                # Only structural CONFIG_INVALID rejections belong on the
                # run-gate envelope. Anything else propagates so the API
                # layer wraps it as 500 (a lizyml-internal bug must not
                # be misreported as a user input error).
                if getattr(exc.code, "value", None) != "CONFIG_INVALID":
                    raise
                out.append(
                    {
                        "path": f"tuning.optuna.space.{name}",
                        "message": exc.user_message,
                        "severity": "error",
                        "suggested_fix": _suggested_fix_for_space_error(name, raw),
                    }
                )
        return out

    @staticmethod
    def _strip_internal_keys(config: dict[str, Any]) -> dict[str, Any]:
        """Thin shim around :func:`strip_internal_keys` kept for backward
        compatibility — older tests reach into ``LizyMLAdapter._strip_internal_keys``
        directly."""
        return strip_internal_keys(config)

    def load_config_from_file(self, content: bytes, filename: str) -> dict[str, Any]:
        text = content.decode("utf-8")
        if filename.endswith((".yaml", ".yml")):
            data: Any = yaml.safe_load(text)
        elif filename.endswith(".json"):
            data = json.loads(text)
        else:
            try:
                data = yaml.safe_load(text)
            except yaml.YAMLError:
                data = json.loads(text)
        if not isinstance(data, dict):
            msg = f"Expected a mapping, got {type(data).__name__}"
            raise ValueError(msg)
        return data


def _suggested_fix_for_space_error(name: str, raw: dict[str, Any]) -> str:
    """Concrete remediation text for the two structural errors we surface.

    Lives at module scope so the prose stays out of ``ConfigMixin`` and
    a second backend (or a future helper) can reuse the strings.
    """
    log = bool(raw.get("log"))
    low = raw.get("low")
    high = raw.get("high")
    if (
        log
        and isinstance(low, int | float)
        and not isinstance(low, bool)
        and float(low) <= 0
    ):
        return (
            f"Either disable log distribution on '{name}', or raise Min above "
            f"zero (Min={low}). Log distributions require a strictly positive "
            f"lower bound."
        )
    if (
        isinstance(low, int | float)
        and isinstance(high, int | float)
        and not isinstance(low, bool)
        and not isinstance(high, bool)
        and float(low) >= float(high)
    ):
        return (
            f"Swap Min and Max for '{name}' (current Min={low}, Max={high}). "
            f"The lower bound must be strictly less than the upper bound."
        )
    return (
        f"Review the '{name}' search space entry — Min must be < Max, and "
        f"log distributions require Min > 0."
    )
