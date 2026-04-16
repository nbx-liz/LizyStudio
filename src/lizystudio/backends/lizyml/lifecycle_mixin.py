"""Model lifecycle methods (create, fit, tune) for LizyMLAdapter."""

from __future__ import annotations

import logging
from pathlib import Path
from pickle import PicklingError
from typing import Any

import pandas as pd

from lizystudio.backends.base import ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary

from .config_compat import parse_re_tune, strip_internal_keys
from .serialization import serialize_tuning_result

logger = logging.getLogger(__name__)


class LifecycleMixin:
    """Model creation, fitting, and tuning.

    Expects to be composed with :class:`CheckpointMixin` in the final
    adapter class (``self.save_checkpoint`` is resolved via MRO).
    """

    def save_checkpoint(self, model: Any, path: Path) -> None:
        raise NotImplementedError

    def create_model(self, config: dict[str, Any], dataframe: pd.DataFrame) -> Any:
        from lizyml import Model

        clean = strip_internal_keys(config)
        return Model(clean, data=dataframe)

    def fit(
        self,
        model: Any,
        *,
        params: dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> FitSummary:
        if on_progress is not None:
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
        """Run hyperparameter tuning via lizyml's Model.tune()."""
        n_rounds, extra_kwargs = parse_re_tune(re_tune)

        lizyml_callback: Any = None
        accumulated_trials: list[dict[str, Any]] = []
        current_round = 1

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

            from lizystudio.services.training import CancelledError

            def _bridge(info: TuneProgressInfo) -> None:
                nonlocal current_round
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
                    raise KeyboardInterrupt from None

            lizyml_callback = _bridge

        if on_progress is not None:
            on_progress(current=0, total=0, message="Starting tuning...")

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
