"""Evaluation, prediction, plots, and persistence methods for LizyMLAdapter."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import pandas as pd

from lizystudio.backends.exceptions import PlotNotAvailableError
from lizystudio.backends.types import PlotData, PredictionSummary

logger = logging.getLogger(__name__)


class EvaluationMixin:
    """Prediction, evaluation, plots, importance, and model export."""

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

    def learning_curve_metrics(self, model: Any) -> list[str]:
        """Return metric names actually recorded in the learning curve history."""
        fit_result = getattr(model, "fit_result", None)
        if fit_result is None:
            return []
        history = getattr(fit_result, "history", None) or []
        seen: set[str] = set()
        ordered: list[str] = []
        for fold_hist in history:
            eval_hist = (
                fold_hist.get("eval_history") if isinstance(fold_hist, dict) else None
            )
            if not eval_hist:
                continue
            for ds_metrics in eval_hist.values():
                if not isinstance(ds_metrics, dict):
                    continue
                for metric_name in ds_metrics:
                    if metric_name not in seen:
                        seen.add(metric_name)
                        ordered.append(metric_name)
        return ordered

    def confusion_matrix(self, model: Any, threshold: float = 0.5) -> dict[str, Any]:
        result = model.confusion_matrix(threshold=threshold)
        return {
            k: v.to_dict() if isinstance(v, pd.DataFrame) else v
            for k, v in result.items()
        }

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
            # Issue #355: typed error so the API layer can map this to
            # HTTP 404 (client asked for an unsupported plot) instead
            # of letting a bare ValueError bubble up as a 500.
            raise PlotNotAvailableError(plot_type, list(self._PLOT_DISPATCH))
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

    def export_model(self, model: Any, path: str) -> str:
        exported: Path = model.export(path)
        return str(exported)

    def export_code(self, model: Any, path: str) -> str:
        """Generate standalone Python code from *model* into *path*."""
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
