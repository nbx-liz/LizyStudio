"""LizyML backend adapter."""

from __future__ import annotations

import json
import logging  # noqa: F401
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

from lizystudio.backends.base import ProgressCallback
from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    FitSummary,
    PlotData,
    PredictionSummary,
    TuningSummary,
)

logger = logging.getLogger(__name__)


class LizyMLAdapter:
    """Adapter for the LizyML library."""

    # -- Identification --

    @property
    def info(self) -> BackendInfo:
        import lizyml

        return BackendInfo(name="lizyml", version=lizyml.__version__)

    # -- Config --

    def get_ui_schema(self) -> dict[str, Any]:
        from lizystudio.backends.lizyml_ui_schema import (
            build_ui_schema,
            get_eval_metrics_by_task,
        )

        return build_ui_schema(get_eval_metrics_by_task())

    def get_config_schema(self) -> ConfigSchema:
        from lizyml.config.schema import LizyMLConfig

        return ConfigSchema(json_schema=LizyMLConfig.model_json_schema())

    def get_default_config(self, task: str, target: str) -> dict[str, Any]:
        from lizyml.config.schema import LizyMLConfig

        is_classification = task in ("binary", "multiclass")
        split_method = "stratified_kfold" if is_classification else "kfold"
        minimal = {
            "config_version": 1,
            "task": task,
            "data": {"target": target},
            "model": {"name": "lgbm"},
            "split": {"method": split_method},
        }
        validated = LizyMLConfig.model_validate(minimal)
        return validated.model_dump(mode="json")

    def validate_config(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        from lizyml.config.schema import LizyMLConfig
        from pydantic import ValidationError

        clean = self._strip_internal_keys(config)
        try:
            LizyMLConfig.model_validate(clean)
            return []
        except ValidationError as exc:
            return exc.errors()  # type: ignore[return-value]

    @staticmethod
    def _strip_internal_keys(config: dict[str, Any]) -> dict[str, Any]:
        """Remove UI-internal keys (prefixed with _) and tune-only sections
        that LizyML's Pydantic schema doesn't accept."""
        import copy

        result = copy.deepcopy(config)
        # Strip _ keys from model.params
        model_params = (result.get("model") or {}).get("params")
        if isinstance(model_params, dict):
            result["model"]["params"] = {
                k: v for k, v in model_params.items() if not k.startswith("_")
            }
        # Strip tune-only keys from tuning (evaluation, model_params, training)
        tuning = result.get("tuning")
        if isinstance(tuning, dict):
            result["tuning"] = {k: v for k, v in tuning.items() if k in ("optuna",)}
        return result

    def load_config_from_file(self, content: bytes, filename: str) -> dict[str, Any]:
        text = content.decode("utf-8")
        if filename.endswith((".yaml", ".yml")):
            data: Any = yaml.safe_load(text)
        elif filename.endswith(".json"):
            data = json.loads(text)
        else:
            # Try YAML first, fall back to JSON
            try:
                data = yaml.safe_load(text)
            except yaml.YAMLError:
                data = json.loads(text)
        if not isinstance(data, dict):
            msg = f"Expected a mapping, got {type(data).__name__}"
            raise ValueError(msg)
        return data

    # -- Model lifecycle --

    def create_model(self, config: dict[str, Any], dataframe: pd.DataFrame) -> Any:
        from lizyml import Model

        clean = self._strip_internal_keys(config)
        return Model(clean, data=dataframe)

    def fit(
        self,
        model: Any,
        *,
        params: dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> FitSummary:
        if on_progress is not None:
            # total=0 signals indeterminate progress (lizyml fit
            # does not provide intermediate progress callbacks).
            on_progress(current=0, total=0, message="Fitting model...")
        fit_result = model.fit(params=params)
        if on_progress is not None:
            on_progress(current=1, total=1, message="Fit complete.")
        return self._convert_fit_result(model, fit_result)

    def tune(
        self,
        model: Any,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> TuningSummary:
        lizyml_callback: Any = None
        if on_progress is not None:
            from lizyml import TuneProgressInfo

            accumulated_trials: list[dict[str, Any]] = []

            def _bridge(info: TuneProgressInfo) -> None:
                msg = f"Trial {info.current_trial}/{info.total_trials}"
                if info.best_score is not None:
                    msg += f" | Best: {info.best_score:.4f}"
                if info.latest_score is not None:
                    msg += f" | Latest: {info.latest_score:.4f} ({info.latest_state})"
                # Accumulate all trial results (including pruned/failed)
                accumulated_trials.append(
                    {
                        "number": info.current_trial - 1,
                        "score": float(info.latest_score)
                        if info.latest_score is not None
                        else None,
                        "state": info.latest_state,
                        "best_score": float(info.best_score)
                        if info.best_score is not None
                        else None,
                    }
                )
                try:
                    on_progress(
                        current=info.current_trial,
                        total=info.total_trials,
                        message=msg,
                        trial_results=list(accumulated_trials),
                    )
                except Exception:
                    # CancelledError from _make_cancel_aware_cb is caught by
                    # Optuna internally.  Re-raise as KeyboardInterrupt which
                    # Optuna honours to abort the study gracefully.
                    raise KeyboardInterrupt from None

            lizyml_callback = _bridge
            # total=0 signals indeterminate until first trial callback
            # provides the real total.
            on_progress(current=0, total=0, message="Starting tuning...")

        tune_result = model.tune(progress_callback=lizyml_callback)

        if on_progress is not None:
            total = len(tune_result.trials) or 1
            on_progress(current=total, total=total, message="Tuning complete.")
        return TuningSummary(
            best_params=dict(tune_result.best_params),
            best_score=float(tune_result.best_score),
            trials=[
                {
                    "number": t.number,
                    "params": dict(t.params),
                    "score": float(t.score),
                    "state": t.state,
                }
                for t in tune_result.trials
            ],
            metric_name=tune_result.metric_name,
            direction=tune_result.direction,
        )

    def predict(
        self,
        model: Any,
        data: pd.DataFrame,
        *,
        return_shap: bool = False,
    ) -> PredictionSummary:
        result = model.predict(data, return_shap=return_shap)
        df = pd.DataFrame({"idx": range(len(result.pred)), "pred": result.pred})
        if result.proba is not None:
            df["proba"] = result.proba
        return PredictionSummary(predictions=df, warnings=list(result.warnings))

    # -- Evaluation --

    def evaluate_table(self, model: Any) -> list[dict[str, Any]]:
        df: pd.DataFrame = model.evaluate_table()
        return df.reset_index().to_dict("records")  # type: ignore[return-value]

    def split_summary(self, model: Any) -> list[dict[str, Any]]:
        fr = model.fit_result
        summary: list[dict[str, Any]] = []
        for i, (train_idx, valid_idx) in enumerate(fr.splits.outer):
            summary.append(
                {"fold": i, "train_size": len(train_idx), "valid_size": len(valid_idx)}
            )
        return summary

    def importance(self, model: Any, kind: str = "split") -> dict[str, float]:
        result: dict[str, float] = model.importance(kind=kind)
        return result

    def importance_kinds(self, model: Any) -> list[str]:
        """Return valid importance kinds for LizyML models."""
        return ["split", "gain", "shap"]

    def confusion_matrix(self, model: Any, threshold: float = 0.5) -> dict[str, Any]:
        result = model.confusion_matrix(threshold=threshold)
        return {
            k: v.to_dict() if isinstance(v, pd.DataFrame) else v
            for k, v in result.items()
        }

    # -- Plots --

    _PLOT_DISPATCH: dict[str, str] = {
        "learning-curve": "plot_learning_curve",
        "oof-distribution": "plot_oof_distribution",
        "importance": "importance_plot",
        "residuals": "residuals_plot",
        "roc-curve": "roc_curve_plot",
        "calibration": "calibration_plot",
        "probability-histogram": "probability_histogram_plot",
        "tuning": "tuning_plot",
    }

    def plot(self, model: Any, plot_type: str, **kwargs: Any) -> PlotData:
        method_name = self._PLOT_DISPATCH.get(plot_type)
        if method_name is None:
            msg = f"Unknown plot type: {plot_type!r}"
            raise ValueError(msg)
        # Forward supported kwargs to the underlying plot method
        call_kwargs: dict[str, Any] = {}
        if plot_type == "learning-curve" and "metrics" in kwargs:
            call_kwargs["metrics"] = kwargs["metrics"]
        if plot_type == "importance" and "kind" in kwargs:
            call_kwargs["kind"] = kwargs["kind"]
        fig = getattr(model, method_name)(**call_kwargs)
        return PlotData(plotly_json=fig.to_json())

    def available_plots(self, model: Any) -> list[str]:
        cfg = model.fit_result.run_meta.config_normalized
        task: str = str(cfg["task"])
        calibration_enabled = cfg.get("calibration") is not None
        plots: list[str] = ["learning-curve"]
        if task == "binary":
            plots.append("roc-curve")
        if task == "regression":
            plots.append("residuals")
        plots.append("importance")
        plots.append("oof-distribution")
        if task == "binary" and calibration_enabled:
            plots.append("probability-histogram")
            plots.append("calibration")
        try:
            model.tuning_plot()
            plots.append("tuning")
        except Exception:  # noqa: BLE001
            logger.debug("tuning_plot not available", exc_info=True)
        return plots

    # -- Persistence --

    def export_model(self, model: Any, path: str) -> str:
        exported: Path = model.export(path)
        return str(exported)

    def export_code(self, model: Any, path: str) -> str:
        """Generate standalone Python code from *model* into *path*.

        Return the resolved path.
        """
        exported: Path = model.export_code(path)
        return str(exported)

    def load_model(self, path: str) -> Any:
        from lizyml import Model

        return Model.load(path)

    def model_info(self, model: Any) -> dict[str, Any]:
        cfg = model.fit_result.run_meta.config_normalized
        model_cfg = cfg.get("model", {})
        data_cfg = cfg.get("data", {})
        return {
            "task": str(cfg["task"]),
            "model_name": (
                model_cfg.get("name", "") if isinstance(model_cfg, dict) else ""
            ),
            "target": data_cfg.get("target") if isinstance(data_cfg, dict) else None,
            "feature_count": len(model.fit_result.feature_names),
        }

    # -- Internal helpers --

    @staticmethod
    def _convert_fit_result(model: Any, fit_result: Any) -> FitSummary:
        params_df: pd.DataFrame = model.params_table()
        params: list[dict[str, Any]] = params_df.reset_index().to_dict(  # type: ignore[assignment]
            "records"
        )
        return FitSummary(
            metrics=fit_result.metrics,
            fold_count=len(fit_result.splits.outer),
            params=params,
        )
