"""LizyML backend adapter."""

from __future__ import annotations

import json
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


class LizyMLAdapter:
    """Adapter for the LizyML library."""

    # -- Identification --

    @property
    def info(self) -> BackendInfo:
        import lizyml

        return BackendInfo(name="lizyml", version=lizyml.__version__)

    # -- Config --

    def get_config_schema(self) -> ConfigSchema:
        from lizyml.config.schema import LizyMLConfig

        return ConfigSchema(json_schema=LizyMLConfig.model_json_schema())

    def validate_config(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        from lizyml.config.schema import LizyMLConfig
        from pydantic import ValidationError

        try:
            LizyMLConfig.model_validate(config)
            return []
        except ValidationError as exc:
            return exc.errors()  # type: ignore[return-value]

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

        return Model(config, data=dataframe)

    def fit(
        self,
        model: Any,
        *,
        params: dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> FitSummary:
        fit_result = model.fit(params=params)
        return self._convert_fit_result(model, fit_result)

    def tune(
        self,
        model: Any,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> TuningSummary:
        tune_result = model.tune()
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

    def plot(self, model: Any, plot_type: str) -> PlotData:
        method_name = self._PLOT_DISPATCH.get(plot_type)
        if method_name is None:
            msg = f"Unknown plot type: {plot_type!r}"
            raise ValueError(msg)
        fig = getattr(model, method_name)()
        return PlotData(plotly_json=fig.to_json())

    def available_plots(self, model: Any) -> list[str]:
        cfg = model.fit_result.run_meta.config_normalized
        task: str = str(cfg["task"])
        calibration_enabled = cfg.get("calibration") is not None
        plots = ["learning-curve", "oof-distribution", "importance"]
        if task == "regression":
            plots.append("residuals")
        if task == "binary":
            plots.append("roc-curve")
            plots.append("probability-histogram")
            if calibration_enabled:
                plots.append("calibration")
        if hasattr(model, "_tuning_result") and model._tuning_result is not None:  # noqa: SLF001
            plots.append("tuning")
        return plots

    # -- Persistence --

    def export_model(self, model: Any, path: str) -> str:
        exported: Path = model.export(path)
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
