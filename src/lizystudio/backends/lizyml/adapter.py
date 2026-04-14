"""LizyML backend adapter — main class.

Extracted from the monolithic ``lizyml.py`` (H-0062 cleanup). Helper
modules in this package handle pickle compatibility, serialization,
and config compat checks; this file owns the lifecycle methods that
talk to lizyml directly (fit / tune / predict / evaluate / plot).
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from pickle import PicklingError
from typing import Any

import cloudpickle
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

from .config_compat import (
    parse_re_tune,
    strip_internal_keys,
    task_params_compat_errors,
)
from .pickle_compat import (
    MODEL_META,
    MODEL_META_TMP,
    MODEL_PKL,
    MODEL_PKL_TMP,
    PICKLE_SCHEMA_VERSION,
    PickleIncompatibleError,
    collect_pickle_versions,
    verify_pickle_compatibility,
)
from .serialization import serialize_tuning_result

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
        errors: list[dict[str, Any]] = []
        try:
            LizyMLConfig.model_validate(clean)
        except ValidationError as exc:
            errors.extend(exc.errors())  # type: ignore[arg-type]

        # H-0062 Bugfix 2026-04-14 (3): catch task <-> model.params
        # inconsistency up-front. The original user-facing symptom was
        # "LizyMLError: [TUNING_FAILED] All tuning trials failed. Check
        # parameter ranges." -- technically correct but misleading when
        # the real cause was an obsolete `objective=multiclass` left on
        # a `task=binary` config after the user briefly switched tasks.
        errors.extend(task_params_compat_errors(clean))
        return errors

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
        re_tune: dict[str, Any] | None = None,
        checkpoint_dir: Path | None = None,
        resume: bool = False,
    ) -> TuningSummary:
        """Run hyperparameter tuning via lizyml's Model.tune().

        When *resume* is True (H-0062 Phase B), the first round is
        started with ``resume=True`` so the provided *model* continues
        its existing Optuna study instead of throwing it away. The
        ``re_tune`` kwargs (n_trials, expand_boundary, boundary_threshold)
        are applied to the first round as well in that case.
        """
        n_rounds, extra_kwargs = parse_re_tune(re_tune)

        lizyml_callback: Any = None
        accumulated_trials: list[dict[str, Any]] = []
        current_round = 1

        # H-0062 Bugfix 2026-04-14: when resume=True and the loaded Model
        # already carries a prior ``_tuning_result``, seed the bridge's
        # accumulated_trials with the parent's trial history. Without
        # this, the Running view table and LiveTrialChart start empty on
        # every Re-tune so the user sees only the *new* trials and the
        # Best column begins from the first new trial -- giving the
        # false impression that the parent results were thrown away.
        # The seeded entries carry the parent's best_score as the
        # per-row best so the chart's "Best" trace is flat across the
        # parent portion until a new trial beats it.
        if resume:
            prior_result = getattr(model, "_tuning_result", None)
            if prior_result is not None and getattr(prior_result, "trials", None):
                prior_best = (
                    float(prior_result.best_score)
                    if getattr(prior_result, "best_score", None) is not None
                    else None
                )
                for t in prior_result.trials:
                    accumulated_trials.append(
                        {
                            "number": getattr(t, "number", len(accumulated_trials)),
                            "round": getattr(t, "round", 1),
                            "score": (
                                float(t.score)
                                if getattr(t, "score", None) is not None
                                else None
                            ),
                            "state": str(getattr(t, "state", "complete")),
                            "best_score": prior_best,
                        }
                    )

        need_bridge = on_progress is not None or checkpoint_dir is not None

        if need_bridge:
            from lizyml import TuneProgressInfo

            # Imported inline to avoid a circular import with services.training
            # at module load (adapter is pulled in via backends/__init__).
            from lizystudio.services.training import CancelledError

            def _bridge(info: TuneProgressInfo) -> None:
                # H-0062: persist an incremental checkpoint BEFORE calling
                # the user-supplied progress callback so a crash during
                # the UI push still leaves the trial we just finished on
                # disk.  save_checkpoint is resilient on its own; we wrap
                # in try/except anyway so that any latent bug in the
                # persistence layer cannot abort the in-flight tune.
                if checkpoint_dir is not None:
                    try:
                        self.save_checkpoint(model, checkpoint_dir)
                    except Exception:  # noqa: BLE001 - intentionally broad
                        logger.warning(
                            "checkpoint save raised unexpectedly; tune continues",
                            exc_info=True,
                        )

                if on_progress is None:
                    return

                msg = f"Round {current_round}/{n_rounds} · "
                msg += f"Trial {info.current_trial}/{info.total_trials}"
                if info.best_score is not None:
                    msg += f" | Best: {info.best_score:.4f}"
                if info.latest_score is not None:
                    msg += f" | Latest: {info.latest_score:.4f} ({info.latest_state})"
                accumulated_trials.append(
                    {
                        "number": len(accumulated_trials),
                        "round": current_round,
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
                        round=current_round,
                        total_rounds=n_rounds,
                        trial_results=list(accumulated_trials),
                    )
                except CancelledError:
                    # CancelledError from _make_cancel_aware_cb must be
                    # converted to KeyboardInterrupt so Optuna honours the
                    # cancel request and aborts the study gracefully. Any
                    # other exception (RuntimeError, TypeError, ...) is a
                    # genuine bug in the progress path and must propagate
                    # with its original traceback intact.
                    raise KeyboardInterrupt from None

            lizyml_callback = _bridge

        if on_progress is not None:
            # total=0 signals indeterminate until first trial callback
            # provides the real total.
            on_progress(current=0, total=0, message="Starting tuning...")

        # First round. When resume=True we continue the existing Optuna
        # study from the checkpoint (H-0062) and pass the re_tune kwargs
        # (n_trials / expand_boundary / boundary_threshold) that would
        # otherwise only apply from round 2 onwards.
        first_round_kwargs: dict[str, Any] = {}
        if resume:
            first_round_kwargs["resume"] = True
            first_round_kwargs.update(extra_kwargs)
        tune_result = model.tune(
            progress_callback=lizyml_callback,
            **first_round_kwargs,
        )
        for round_idx in range(2, n_rounds + 1):
            current_round = round_idx
            if on_progress is not None:
                on_progress(
                    current=0,
                    total=0,
                    message=f"Starting round {round_idx}/{n_rounds}...",
                    round=round_idx,
                    total_rounds=n_rounds,
                )
            tune_result = model.tune(
                progress_callback=lizyml_callback,
                resume=True,
                **extra_kwargs,
            )

        # H-0062 final save: lizyml's Model.tune() assigns ``self._study``
        # only at the very end of its body, so every bridge-callback save
        # above pickled a model whose ``_study`` was still the pre-tune
        # value (typically None for a fresh tune). Without this explicit
        # post-tune save, load_checkpoint(...)._study is None and the
        # Re-tune / Resume launcher hits lizyml's
        # "Cannot resume tuning: no previous tune() call" guard.
        # This is the source of truth for the on-disk checkpoint; the
        # per-trial saves above remain a crash-insurance best-effort.
        #
        # IMPORTANT: do NOT remove the per-trial bridge save even though
        # this final save is present. They serve different failure modes:
        # - final save covers the "successful tune then Re-tune later" path
        # - per-trial save covers "tune crashed mid-way" (power loss,
        #   OOM kill, cancellation) so the Results Panel can still show
        #   the last completed trial's score history. Note that a
        #   mid-round crash leaves ``_study`` unset on the pickled model,
        #   so Re-tune / Resume on such a crash is still best-effort.
        #
        # save_checkpoint itself swallows OSError/PicklingError internally
        # as WARNING logs; the explicit INFO here distinguishes "final
        # save ran" from "WARNING was logged" when triaging a Re-tune
        # failure from logs alone. The outer except is intentionally
        # narrowed (H-0062 Bugfix 2026-04-14 (8)) to filesystem / pickle
        # / type errors so genuine programming bugs in the caller path
        # (e.g. AttributeError on an unexpected model shape) still
        # propagate and are not silently swallowed.
        if checkpoint_dir is not None:
            try:
                self.save_checkpoint(model, checkpoint_dir)
                logger.info(
                    "H-0062: final post-tune checkpoint save attempted at %s",
                    checkpoint_dir,
                )
            except (OSError, PicklingError, RecursionError):
                logger.warning(
                    "final checkpoint save after tune raised unexpectedly",
                    exc_info=True,
                )

        if on_progress is not None:
            total = len(tune_result.trials) or 1
            on_progress(current=total, total=total, message="Tuning complete.")
        return serialize_tuning_result(tune_result)

    # -- Checkpoint persistence (H-0062) --

    def save_checkpoint(self, model: Any, path: Path) -> None:
        """Atomically persist *model* as ``path/model.pkl`` via temp+rename.

        Writes a ``model_meta.json`` sidecar capturing lizyml / lightgbm /
        optuna versions so later loads can reject incompatible runtimes.
        All failures (filesystem, pickling) are swallowed with a WARNING
        log so that a flaky checkpoint cannot crash an in-flight tune.

        Atomicity note: ``model.pkl`` and ``model_meta.json`` are
        rewritten as two separate atomic renames, not a combined
        transaction. A reader interleaving between the two replaces
        would briefly see a fresh ``model.pkl`` paired with a stale
        ``model_meta.json``. Inside a single Studio process this cannot
        cause a real problem because the only consumer (``load_checkpoint``
        from the Re-tune / Resume launcher) runs in the same interpreter
        as the writer and shares the same lizyml / lightgbm / optuna
        versions, so the sidecar comparison is trivially compatible.
        """
        target_dir = Path(path)
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            logger.warning("checkpoint: cannot create %s: %s", target_dir, exc)
            return

        tmp_path = target_dir / MODEL_PKL_TMP
        final_path = target_dir / MODEL_PKL
        try:
            with tmp_path.open("wb") as fh:
                cloudpickle.dump(model, fh)
            os.replace(tmp_path, final_path)
        except (OSError, PicklingError, RecursionError) as exc:
            logger.warning(
                "checkpoint save failed at %s: %s",
                final_path,
                exc,
            )
            # Best-effort cleanup of the partial temp file
            with contextlib.suppress(OSError):
                tmp_path.unlink(missing_ok=True)
            return

        # Meta sidecar -- if this fails we still keep the pickle, but log.
        meta_tmp = target_dir / MODEL_META_TMP
        meta_final = target_dir / MODEL_META
        try:
            meta_payload: dict[str, Any] = {
                "pickle_schema": PICKLE_SCHEMA_VERSION,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                **collect_pickle_versions(),
            }
            meta_tmp.write_text(
                json.dumps(meta_payload, ensure_ascii=False),
                encoding="utf-8",
            )
            os.replace(meta_tmp, meta_final)
        except OSError as exc:
            logger.warning("checkpoint meta write failed at %s: %s", meta_final, exc)
            with contextlib.suppress(OSError):
                meta_tmp.unlink(missing_ok=True)

    def load_checkpoint(self, path: Path) -> Any:
        """Load ``path/model.pkl`` after verifying ``model_meta.json``.

        Raises :class:`FileNotFoundError` when no pickle exists, and
        :class:`PickleIncompatibleError` when the sidecar reports a
        schema or lizyml-major mismatch.
        """
        target_dir = Path(path)
        pkl_path = target_dir / MODEL_PKL
        if not pkl_path.exists():
            raise FileNotFoundError(f"No checkpoint at {pkl_path}")

        meta_path = target_dir / MODEL_META
        if meta_path.exists():
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            verify_pickle_compatibility(meta)

        with pkl_path.open("rb") as fh:
            return cloudpickle.load(fh)

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

    def learning_curve_metrics(self, model: Any) -> list[str]:
        """Return metric names actually recorded in the learning curve history.

        Walks ``fit_result.history[*]["eval_history"][dataset][metric]``,
        mirroring the matching logic in
        ``lizyml.plots.learning_curve.plot_learning_curve``. This is the
        source of truth for the UI's metric filter -- it reflects what the
        backend actually trained on, not what the user requested in config.

        Returns an empty list when no eval history is recorded (e.g. early
        stopping disabled or legacy runs without history).
        """
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


# Re-export for callers that imported PickleIncompatibleError directly from
# the adapter module before the H-0062 split.
__all__ = ["LizyMLAdapter", "PickleIncompatibleError"]
