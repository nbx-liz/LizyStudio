"""Model lifecycle methods (create, fit, tune) for LizyMLAdapter."""

from __future__ import annotations

import logging
from pathlib import Path
from pickle import PicklingError
from typing import Any

import pandas as pd

from lizystudio.backends.base import ProgressCallback
from lizystudio.backends.exceptions import SearchSpaceRefusedError, TuningFailedError
from lizystudio.backends.types import FitSummary, TuningSummary

from .config_compat import parse_re_tune, strip_internal_keys
from .serialization import serialize_tuning_result
from .space_wire import catalog_key_for_wire_name, to_wire_config

logger = logging.getLogger(__name__)


def _run_tune_round(model: Any, **kwargs: Any) -> Any:
    """Run one ``model.tune`` round, reporting two lizyml failures as their own.

    * ``TUNING_FAILED`` (every trial of a round failed) becomes
      :class:`TuningFailedError` (P-0116 D5, #691).
    * A ``CONFIG_INVALID`` about the search space, raised before the first
      trial, becomes :class:`SearchSpaceRefusedError` naming the dims lizyml
      named (P-0116 D1).

    The job then shows each under its own code instead of as a generic
    backend error.  Every other error propagates unchanged.
    """
    from lizyml.core.exceptions import LizyMLError

    try:
        return model.tune(**kwargs)
    except LizyMLError as exc:
        code = getattr(exc.code, "value", None)
        if code == "TUNING_FAILED":
            message = exc.user_message
            first_error = (exc.context or {}).get("first_error")
            if first_error:
                message = f"{message} First trial error: {first_error}"
            raise TuningFailedError(message) from exc
        dims = _space_refusal_dims(exc.context) if code == "CONFIG_INVALID" else None
        if dims is None:
            raise
        named = f" ({', '.join(dims)})" if dims else ""
        raise SearchSpaceRefusedError(
            # No "before the first trial": a resume whose space no longer
            # matches the study is refused the same way, mid-study.
            f"LizyML refused the search space{named}: {exc.user_message}",
            dims=dims,
        ) from exc


# Where lizyml says a refused dim was declared: the config's space, or a
# later round's ``tune(space=)``.  Matched exactly (DC2): neighbours such as
# ``tuning.optuna.space_mode`` are not the space.
_SPACE_SURFACES: frozenset[str] = frozenset({"tuning.optuna.space", "tune(space=)"})


def _space_refusal_dims(context: Any) -> tuple[str, ...] | None:
    """The catalog keys of the dims a space refusal names.

    ``None`` when *context* is not about the search space: no space surface
    at its top level, nor in a ``conflicts`` / ``managed`` entry.  The dims
    are read best-effort from the keys lizyml 0.20 uses (``dim``, ``names``,
    ``dimensions``, ``name``) and may be empty; no lizyml rule is copied.
    """
    if not isinstance(context, dict):
        return None
    entries: list[dict[str, Any]] = [context]
    for key in ("conflicts", "managed"):
        listed = context.get(key)
        if isinstance(listed, list):
            entries.extend(entry for entry in listed if isinstance(entry, dict))
    space_entries = [
        entry
        for entry in entries
        if isinstance(entry.get("surface"), str) and entry["surface"] in _SPACE_SURFACES
    ]
    if not space_entries:
        return None
    names: list[str] = []
    for entry in space_entries:
        for key in ("dim", "name"):
            if isinstance(entry.get(key), str):
                names.append(entry[key])
        for key in ("names", "dimensions"):
            listed = entry.get(key)
            if isinstance(listed, list):
                names.extend(name for name in listed if isinstance(name, str))
    return tuple(dict.fromkeys(catalog_key_for_wire_name(name) for name in names))


class LifecycleMixin:
    """Model creation, fitting, and tuning.

    Expects to be composed with :class:`CheckpointMixin` in the final
    adapter class (``self.save_checkpoint`` is resolved via MRO).
    """

    def save_checkpoint(self, model: Any, path: Path) -> None:
        raise NotImplementedError

    def create_model(self, config: dict[str, Any], dataframe: pd.DataFrame) -> Any:
        from lizyml import Model

        clean = to_wire_config(strip_internal_keys(config))
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
        storage: str | None = None,
        study_name: str | None = None,
    ) -> TuningSummary:
        """Run hyperparameter tuning via lizyml's Model.tune().

        ``storage`` and ``study_name`` (P-0099 v3-20b / R-1.4) are
        forwarded to ``model.tune`` (lizyml >= 0.12.0, H-0072). When
        provided together, Optuna persists trial state to the URL
        after every completed trial; re-invoking ``tune`` with the
        same identifiers re-attaches via ``load_if_exists=True`` and
        picks up where the prior run stopped. When both arguments are
        ``None`` (default), the legacy in-memory study path is used,
        so existing callers and re-tune flows continue to behave
        exactly as before.
        """
        n_rounds, extra_kwargs = parse_re_tune(re_tune)
        # P-0099 v3-20b: storage / study_name are pass-through kwargs
        # for lizyml's persistent-storage path. They are added to
        # every model.tune() call (first round + every re-tune round)
        # so a multi-round resume sees the same study identity across
        # rounds. lizyml 0.12.0 accepts None to mean "use the in-memory
        # default" — the local dict guarantees we only inject the
        # kwargs when both are set, which keeps the call signature
        # compatible with hypothetical future lizyml releases that add
        # a non-None default.
        storage_kwargs: dict[str, Any] = {}
        if storage is not None or study_name is not None:
            storage_kwargs["storage"] = storage
            storage_kwargs["study_name"] = study_name

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

            from lizystudio.backends.exceptions import CancelledError

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
        tune_result = _run_tune_round(
            model,
            progress_callback=lizyml_callback,
            **storage_kwargs,
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
            tune_result = _run_tune_round(
                model,
                progress_callback=lizyml_callback,
                resume=True,
                **storage_kwargs,
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
