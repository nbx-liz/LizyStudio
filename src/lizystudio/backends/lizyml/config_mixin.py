"""Config-related methods for LizyMLAdapter."""

from __future__ import annotations

import json
from typing import Any

import pandas as pd
import yaml

from lizystudio.backends.types import BackendInfo, ConfigSchema, IncompatibleMetric

from .config_compat import strip_internal_keys, task_params_compat_errors

# Regression metrics whose value is undefined / degenerate for certain target
# distributions. The Service layer used to hardcode this watchlist (Issue #394);
# P-0106 (#403) moved it here so the metric vocabulary stays owned by the
# backend — a second backend declares its own watchlist (or none).
_REGRESSION_METRIC_WATCHLIST = frozenset({"mape", "rmsle", "r2"})


class ConfigMixin:
    """Identification, schema, validation, and config file loading."""

    @property
    def info(self) -> BackendInfo:
        import lizyml

        return BackendInfo(name="lizyml", version=lizyml.__version__)

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
