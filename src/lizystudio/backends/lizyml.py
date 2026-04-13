"""LizyML backend adapter."""

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

logger = logging.getLogger(__name__)


# --- H-0062: Phase B checkpoint persistence -------------------------------


class PicklePreflightError(RuntimeError):
    """Raised before tune starts when the job dir is not usable for
    pickle persistence (no write perms, SELinux denial, or unpicklable
    skeleton)."""


class PickleIncompatibleError(RuntimeError):
    """Raised by ``load_checkpoint`` / ``verify_pickle_compatibility`` when
    the on-disk ``model_meta.json`` points at a schema or major backend
    version the current Studio cannot safely deserialize."""


_PICKLE_SCHEMA_VERSION = 1
_MODEL_PKL = "model.pkl"
_MODEL_PKL_TMP = "model.pkl.tmp"
_MODEL_META = "model_meta.json"
_MODEL_META_TMP = "model_meta.json.tmp"


def _collect_pickle_versions() -> dict[str, str]:
    """Snapshot the lizyml / lightgbm / optuna versions for the sidecar."""
    import lizyml

    versions: dict[str, str] = {
        "lizyml_version": getattr(lizyml, "__version__", "unknown"),
    }
    try:
        import lightgbm

        versions["lightgbm_version"] = getattr(lightgbm, "__version__", "unknown")
    except ImportError:  # pragma: no cover - lightgbm is a hard dep
        versions["lightgbm_version"] = "unknown"
    try:
        import optuna

        versions["optuna_version"] = getattr(optuna, "__version__", "unknown")
    except ImportError:  # pragma: no cover - optuna is a hard dep
        versions["optuna_version"] = "unknown"
    return versions


def _major_minor(version: str) -> tuple[int, int] | None:
    """Parse ``'0.9.1'`` into ``(0, 9)`` for version-compat comparison.

    Strips PEP 440 local / dev / pre-release suffixes so that the
    base ``major.minor`` is compared even for builds like
    ``'0.9.1.dev3+local'`` or ``'0.9.0a1'``. The strictness comes from
    the major/minor equality check in ``verify_pickle_compatibility``;
    if a dev build's pickle format diverges from the matching stable
    release, the fix is to bump ``_PICKLE_SCHEMA_VERSION``.
    """
    # Drop everything after the first non-numeric character in any
    # component (handles 0.9.0a1 / 0.9.0rc1 / 0.9.0.dev3 / 0.9.0+local).
    cleaned = version.split("+", 1)[0]
    parts = cleaned.split(".")
    if len(parts) < 2:
        return None
    numeric_parts: list[str] = []
    for raw in parts[:2]:
        digits = ""
        for ch in raw:
            if ch.isdigit():
                digits += ch
            else:
                break
        numeric_parts.append(digits)
    if not numeric_parts[0] or not numeric_parts[1]:
        return None
    try:
        return int(numeric_parts[0]), int(numeric_parts[1])
    except ValueError:
        return None


def verify_pickle_compatibility(meta: dict[str, Any]) -> None:
    """Reject a checkpoint whose sidecar points at an incompatible runtime.

    The check is intentionally strict: we only accept the exact pickle
    schema version and an exact lizyml major.minor match.  Anything else
    raises so the caller can show a clear error to the user rather than
    silently loading a bad model state.
    """
    schema = meta.get("pickle_schema")
    if schema != _PICKLE_SCHEMA_VERSION:
        raise PickleIncompatibleError(
            f"Unsupported pickle_schema: expected {_PICKLE_SCHEMA_VERSION}, "
            f"got {schema!r}"
        )

    current = _collect_pickle_versions()
    saved_lizyml = str(meta.get("lizyml_version", ""))
    current_mm = _major_minor(current["lizyml_version"])
    saved_mm = _major_minor(saved_lizyml)
    if current_mm is None or saved_mm is None or current_mm != saved_mm:
        raise PickleIncompatibleError(
            "Incompatible lizyml version: checkpoint was saved with "
            f"{saved_lizyml!r}, current runtime is "
            f"{current['lizyml_version']!r}"
        )


def preflight_pickle_check(job_dir: Path) -> None:
    """Fail fast before tune if ``job_dir`` cannot host a pickle file.

    Catches the common 'tune ran for an hour and then pickle save
    failed' class of bugs by verifying:

    1. The job dir is writable (creates and removes ``.write_test``)
    2. cloudpickle can round-trip a minimal sentinel object

    Real Model-specific picklability cannot be tested here because it
    requires the fitted instance, which is exactly what we are trying
    to produce.  The first real save attempt will surface any remaining
    pickling issue (logged as WARNING, tune continues).
    """
    job_dir.mkdir(parents=True, exist_ok=True)
    probe = job_dir / ".write_test"
    try:
        probe.write_bytes(b"ok")
    except OSError as exc:
        raise PicklePreflightError(
            f"Job directory {job_dir} is not writable: {exc}"
        ) from exc
    finally:
        if probe.exists():
            with contextlib.suppress(OSError):
                probe.unlink()

    sentinel: dict[str, Any] = {"_pickle_schema": _PICKLE_SCHEMA_VERSION}
    try:
        cloudpickle.loads(cloudpickle.dumps(sentinel))
    except Exception as exc:  # noqa: BLE001 — cloudpickle can raise many
        raise PicklePreflightError(f"cloudpickle round-trip failed: {exc}") from exc


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
        re_tune: dict[str, Any] | None = None,
        checkpoint_dir: Path | None = None,
    ) -> TuningSummary:
        n_rounds, extra_kwargs = _parse_re_tune(re_tune)

        lizyml_callback: Any = None
        accumulated_trials: list[dict[str, Any]] = []
        current_round = 1

        need_bridge = on_progress is not None or checkpoint_dir is not None

        if need_bridge:
            from lizyml import TuneProgressInfo

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
                except Exception:
                    # CancelledError from _make_cancel_aware_cb is caught by
                    # Optuna internally.  Re-raise as KeyboardInterrupt which
                    # Optuna honours to abort the study gracefully.
                    raise KeyboardInterrupt from None

            lizyml_callback = _bridge

        if on_progress is not None:
            # total=0 signals indeterminate until first trial callback
            # provides the real total.
            on_progress(current=0, total=0, message="Starting tuning...")

        tune_result = model.tune(progress_callback=lizyml_callback)
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

        if on_progress is not None:
            total = len(tune_result.trials) or 1
            on_progress(current=total, total=total, message="Tuning complete.")
        return _serialize_tuning_result(tune_result)

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

        tmp_path = target_dir / _MODEL_PKL_TMP
        final_path = target_dir / _MODEL_PKL
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

        # Meta sidecar — if this fails we still keep the pickle, but log.
        meta_tmp = target_dir / _MODEL_META_TMP
        meta_final = target_dir / _MODEL_META
        try:
            meta_payload: dict[str, Any] = {
                "pickle_schema": _PICKLE_SCHEMA_VERSION,
                "saved_at": datetime.now(timezone.utc).isoformat(),
                **_collect_pickle_versions(),
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
        pkl_path = target_dir / _MODEL_PKL
        if not pkl_path.exists():
            raise FileNotFoundError(f"No checkpoint at {pkl_path}")

        meta_path = target_dir / _MODEL_META
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
        source of truth for the UI's metric filter — it reflects what the
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


# ---------------------------------------------------------------------------
# Tune / re-tune helpers (H-0061)
# ---------------------------------------------------------------------------

# Hard upper bounds act as a DoS guard: the frontend clamps n_rounds to 10
# and n_trials implicitly via Search Space, but a direct API client could
# otherwise request millions of trials and tie up the single-job queue.
_MAX_RE_TUNE_ROUNDS = 20
_MAX_RE_TUNE_TRIALS_PER_ROUND = 10_000


def _parse_re_tune(
    re_tune: dict[str, Any] | None,
) -> tuple[int, dict[str, Any]]:
    """Validate a ``re_tune`` config block from the request.

    Returns ``(n_rounds, extra_kwargs)`` where ``extra_kwargs`` are the
    keyword arguments passed to ``model.tune(resume=True, ...)`` on
    rounds 2..n_rounds.  The first round always uses the Config-driven
    ``tuning.optuna`` settings (n_trials, space, sampler, ...).
    """
    if re_tune is None:
        return 1, {}

    n_rounds_raw = re_tune.get("n_rounds", 1)
    # Accept plain int only; reject float to avoid silent truncation (1.5 -> 1)
    # and reject bool (Python bools are ints but not meaningful here).
    if isinstance(n_rounds_raw, bool) or not isinstance(n_rounds_raw, int):
        raise ValueError(f"re_tune.n_rounds must be an integer, got {n_rounds_raw!r}")
    n_rounds = n_rounds_raw
    if n_rounds < 1:
        raise ValueError(f"re_tune.n_rounds must be >= 1, got {n_rounds}")
    if n_rounds > _MAX_RE_TUNE_ROUNDS:
        raise ValueError(
            f"re_tune.n_rounds must be <= {_MAX_RE_TUNE_ROUNDS}, got {n_rounds}"
        )

    extra_kwargs: dict[str, Any] = {}
    if "n_trials" in re_tune and re_tune["n_trials"] is not None:
        n_trials_raw = re_tune["n_trials"]
        # Same strict-int check as n_rounds: reject bool and non-int.
        if isinstance(n_trials_raw, bool) or not isinstance(n_trials_raw, int):
            raise ValueError(
                f"re_tune.n_trials must be an integer, got {n_trials_raw!r}"
            )
        if n_trials_raw < 1:
            raise ValueError(f"re_tune.n_trials must be >= 1, got {n_trials_raw}")
        if n_trials_raw > _MAX_RE_TUNE_TRIALS_PER_ROUND:
            raise ValueError(
                f"re_tune.n_trials must be <= {_MAX_RE_TUNE_TRIALS_PER_ROUND}, "
                f"got {n_trials_raw}"
            )
        extra_kwargs["n_trials"] = n_trials_raw
    if "expand_boundary" in re_tune and re_tune["expand_boundary"] is not None:
        extra_kwargs["expand_boundary"] = bool(re_tune["expand_boundary"])
    if "boundary_threshold" in re_tune and re_tune["boundary_threshold"] is not None:
        threshold_raw = re_tune["boundary_threshold"]
        # Same strict numeric check as n_rounds / n_trials (reject bool, str).
        if isinstance(threshold_raw, bool) or not isinstance(
            threshold_raw, (int, float)
        ):
            raise ValueError(
                f"re_tune.boundary_threshold must be a number, got {threshold_raw!r}"
            )
        threshold = float(threshold_raw)
        # lizyml 0.9.0 Model.tune enforces strict (0.0, 0.5); mirror that so
        # errors surface here instead of deep inside lizyml.
        if not (0.0 < threshold < 0.5):
            raise ValueError(
                f"re_tune.boundary_threshold must be in (0.0, 0.5), got {threshold}"
            )
        extra_kwargs["boundary_threshold"] = threshold
    return n_rounds, extra_kwargs


def _serialize_tuning_result(tune_result: Any) -> TuningSummary:
    """Convert lizyml ``TuningResult`` into Studio ``TuningSummary``.

    Populates the optional ``rounds`` and ``boundary_report`` fields
    when the lizyml result carries H-0068 data.  Legacy results without
    those fields produce a summary with ``rounds=None`` and
    ``boundary_report=None``.
    """
    rounds = _serialize_rounds(getattr(tune_result, "rounds", None))
    boundary = _serialize_boundary_report(getattr(tune_result, "boundary_report", None))
    return TuningSummary(
        best_params=dict(tune_result.best_params),
        best_score=float(tune_result.best_score),
        trials=[
            {
                "number": t.number,
                "params": dict(t.params),
                # Optuna PRUNED/FAIL trials carry score=None.
                "score": float(t.score) if t.score is not None else None,
                "state": t.state,
                "round": getattr(t, "round", 1),
            }
            for t in tune_result.trials
        ],
        metric_name=tune_result.metric_name,
        direction=tune_result.direction,
        rounds=rounds,
        boundary_report=boundary,
    )


def _serialize_rounds(rounds: Any) -> list[dict[str, Any]] | None:
    """Serialize a lizyml ``tuple[RoundSummary, ...]`` to plain dicts."""
    if not rounds:
        return None
    out: list[dict[str, Any]] = []
    for r in rounds:
        out.append(
            {
                "round": int(r.round),
                "n_trials": int(r.n_trials),
                "best_score_before": (
                    float(r.best_score_before)
                    if r.best_score_before is not None
                    else None
                ),
                "best_score_after": float(r.best_score_after),
                "expanded_dims": list(r.expanded_dims),
                "space_snapshot": [
                    _serialize_search_dim(dim) for dim in r.space_snapshot
                ],
            }
        )
    return out


def _serialize_boundary_report(report: Any) -> dict[str, Any] | None:
    """Serialize a lizyml ``BoundaryReport`` to a plain dict."""
    if report is None:
        return None
    dims = getattr(report, "dims", ())
    return {
        "dims": [
            {
                "name": str(d.name),
                "best_value": d.best_value,
                "low": d.low,
                "high": d.high,
                "position_pct": (
                    float(d.position_pct) if d.position_pct is not None else None
                ),
                "edge": str(d.edge) if d.edge is not None else None,
                "expanded": bool(d.expanded),
                "new_low": d.new_low,
                "new_high": d.new_high,
            }
            for d in dims
        ],
        "expanded_names": list(getattr(report, "expanded_names", ())),
    }


def _search_dim_type_label(dim: Any) -> str:
    """Map a lizyml ``SearchDim`` dataclass to a short type label.

    lizyml 0.9.0 uses three concrete frozen dataclasses — FloatDim, IntDim,
    CategoricalDim — and does not expose a ``type`` field.  Derive the
    label from the class name so the UI can distinguish numeric dims
    (with low/high/log) from categorical dims (with choices).
    """
    cls = type(dim).__name__
    if cls == "FloatDim":
        return "float"
    if cls == "IntDim":
        return "int"
    if cls == "CategoricalDim":
        return "categorical"
    return cls.lower().removesuffix("dim") or "unknown"


def _serialize_search_dim(dim: Any) -> dict[str, Any]:
    """Serialize a lizyml ``SearchDim`` into a plain dict.

    The snapshot captures just enough to render a Search Space Evolution
    view — type, name, category, and the type-specific range — without
    pulling backend-specific objects into Studio's common type boundary.
    Missing attributes are omitted rather than emitted as ``None`` so
    the UI can use ``"low" in dim`` to discriminate numeric vs categorical.
    """
    result: dict[str, Any] = {
        "name": getattr(dim, "name", None),
        "type": _search_dim_type_label(dim),
        "category": getattr(dim, "category", None),
    }
    # Numeric dims (FloatDim / IntDim) carry low/high/log.
    for attr in ("low", "high", "log"):
        if hasattr(dim, attr):
            result[attr] = getattr(dim, attr)
    # Categorical dims carry choices as a tuple; convert to list for JSON.
    if hasattr(dim, "choices"):
        choices = dim.choices
        result["choices"] = list(choices) if choices is not None else None
    return result
