"""Config validation and re-tune option parsing for the LizyML backend.

Extracted from the monolithic ``lizyml.py`` (H-0062 cleanup):
- ``parse_re_tune`` — validates the request-level re_tune block and
  produces ``(n_rounds, extra_kwargs)`` for the adapter's tune loop.
- ``task_params_compat_errors`` — pydantic-style validation errors for
  task <-> objective / metric mismatches (H-0062 Bugfix 2026-04-14 (3)).
- ``strip_internal_keys`` — strips UI-internal underscore-prefixed keys
  and tune-only sections that lizyml's pydantic schema does not accept.
"""

from __future__ import annotations

import copy
from typing import Any

# Hard upper bounds act as a DoS guard: the frontend clamps n_rounds to 10
# and n_trials implicitly via Search Space, but a direct API client could
# otherwise request millions of trials and tie up the single-job queue.
MAX_RE_TUNE_ROUNDS = 20
MAX_RE_TUNE_TRIALS_PER_ROUND = 10_000


def parse_re_tune(
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
    if n_rounds > MAX_RE_TUNE_ROUNDS:
        raise ValueError(
            f"re_tune.n_rounds must be <= {MAX_RE_TUNE_ROUNDS}, got {n_rounds}"
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
        if n_trials_raw > MAX_RE_TUNE_TRIALS_PER_ROUND:
            raise ValueError(
                f"re_tune.n_trials must be <= {MAX_RE_TUNE_TRIALS_PER_ROUND}, "
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


def strip_internal_keys(config: dict[str, Any]) -> dict[str, Any]:
    """Remove UI-internal keys (prefixed with _) and tune-only sections
    that LizyML's Pydantic schema doesn't accept.

    Defensive against malformed inputs: if ``config`` is not a dict
    (or ``model`` / ``params`` / ``tuning`` are not dicts), the
    helper returns a best-effort copy unchanged rather than
    crashing. The real type errors surface via pydantic validation
    downstream.
    """
    if not isinstance(config, dict):
        return config  # pydantic will reject the type at validate time
    result = copy.deepcopy(config)
    # Strip _ keys from model.params (only when model AND params are dicts)
    model = result.get("model")
    if isinstance(model, dict):
        model_params = model.get("params")
        if isinstance(model_params, dict):
            model["params"] = {
                k: v for k, v in model_params.items() if not k.startswith("_")
            }
    # Strip tune-only keys from tuning (evaluation, model_params, training)
    tuning = result.get("tuning")
    if isinstance(tuning, dict):
        result["tuning"] = {k: v for k, v in tuning.items() if k in ("optuna",)}
        optuna = result["tuning"].get("optuna")
        if isinstance(optuna, dict):
            result["tuning"]["optuna"] = {
                k: v for k, v in optuna.items() if not k.startswith("_")
            }
    # Strip the 'result' section entirely — it carries runtime-only
    # bookkeeping (_runtime_ms, _cache_hit, etc.) that is not part of
    # the LizyML config schema.
    result.pop("result", None)
    return result


def search_space_compat_errors(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return pydantic-style errors for an invalid ``tuning.optuna.space``.

    P-0104 Wave 3.1a / Issue #461: LizyStudio's ``validate_config`` runs
    ``LizyMLConfig.model_validate`` plus its own task/objective compat
    checks, but never exercised LizyML's ``parse_space`` — so a Tune
    search space with an inverted Range (``low >= high``) or a
    log-distribution dim whose lower bound is ``<= 0`` slipped past the
    workspace validator and only blew up deep inside the tuning loop.

    Calling ``parse_space`` here surfaces those typed
    ``LizyMLError(CONFIG_INVALID)`` cases as a 400 in the workspace
    "Fix validation errors first" banner, alongside the existing
    Studio-side NumberInput guard (Wave 2.4).

    Defensive: if ``config`` is malformed, or ``tuning.optuna.space`` is
    missing / not a dict / empty, returns ``[]`` (pydantic / runtime
    layers handle the rest).
    """
    if not isinstance(config, dict):
        return []
    tuning = config.get("tuning")
    if not isinstance(tuning, dict):
        return []
    optuna = tuning.get("optuna")
    if not isinstance(optuna, dict):
        return []
    space = optuna.get("space")
    if not isinstance(space, dict) or not space:
        return []

    from lizyml.core.exceptions import LizyMLError
    from lizyml.tuning.search_space import parse_space

    try:
        parse_space(space)
    except LizyMLError as exc:
        return [
            {
                "type": "search_space_invalid",
                "loc": ("tuning", "optuna", "space"),
                "msg": getattr(exc, "user_message", str(exc)),
                "input": getattr(exc, "context", None),
            }
        ]
    return []


def task_params_compat_errors(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Return pydantic-style validation errors for task / objective /
    metric mismatches.

    Single source of truth for valid objective/metric names per task is
    the lizyml UI schema ``option_sets``. The lists here are kept in
    sync by ``tests/test_backends_lizyml.py``. Task is considered
    unknown (no error) when it is missing or not one of the three
    recognised values — that case is already covered by the normal
    pydantic LizyMLConfig validation.

    Defensive against malformed inputs: short-circuit when ``config``,
    ``model``, or ``params`` are not dicts (H-0062 Bugfix 2026-04-14 (7)).
    ``validate_config`` runs this helper after pydantic validation, so
    a caller that passes a malformed config would otherwise see the
    pydantic errors *plus* an AttributeError crashing the helper.
    """
    if not isinstance(config, dict):
        return []
    task = config.get("task")
    if task not in ("binary", "multiclass", "regression"):
        return []
    model = config.get("model")
    if not isinstance(model, dict):
        return []
    params = model.get("params")
    if not isinstance(params, dict):
        return []

    from lizystudio.backends.lizyml_metrics import get_eval_metrics_by_task
    from lizystudio.backends.lizyml_ui_schema import build_ui_schema

    option_sets = build_ui_schema(get_eval_metrics_by_task()).get("option_sets", {})
    allowed_objective = set(option_sets.get("objective", {}).get(task, []))
    allowed_metric = set(option_sets.get("model_metric", {}).get(task, []))

    errors: list[dict[str, Any]] = []

    objective = params.get("objective")
    if (
        isinstance(objective, str)
        and allowed_objective
        and objective not in allowed_objective
    ):
        errors.append(
            {
                "type": "task_objective_mismatch",
                "loc": ("model", "params", "objective"),
                "msg": (
                    f"objective={objective!r} is not valid for task={task!r}; "
                    f"allowed: {sorted(allowed_objective)}"
                ),
                "input": objective,
            }
        )

    metric = params.get("metric")
    # Empty list is OK (backend supplies defaults downstream).
    if isinstance(metric, list) and metric and allowed_metric:
        # H-0062 Bugfix 2026-04-14 (7): flag when ANY metric is invalid
        # for the current task. LightGBM rejects the whole list if any
        # entry is incompatible (e.g. task=binary + metric=["auc",
        # "multi_logloss"] -> the old "all-invalid only" policy let
        # this slip through and the user saw "All tuning trials failed"
        # at run time with no hint at the real cause.
        bad = [m for m in metric if isinstance(m, str) and m not in allowed_metric]
        if bad:
            errors.append(
                {
                    "type": "task_metric_mismatch",
                    "loc": ("model", "params", "metric"),
                    "msg": (
                        f"metric={bad!r} is not valid for task={task!r}; "
                        f"allowed: {sorted(allowed_metric)}"
                    ),
                    "input": metric,
                }
            )

    # Issue #269: lizyml only supports calibration for task="binary" and
    # raises CALIBRATION_NOT_SUPPORTED at fit time otherwise. The UI
    # hides the Calibration section under conditional_visibility but
    # leaves the value on the config when the user changes the task,
    # so the stale calibration sneaks past Pydantic and dies ~5s after
    # Fit. Catching it in the workspace validator surfaces the issue
    # in the existing "Fix validation errors first" banner instead.
    calibration = config.get("calibration")
    if calibration is not None and task != "binary":
        errors.append(
            {
                "type": "task_calibration_mismatch",
                "loc": ("calibration",),
                "msg": (
                    f"calibration is only supported for task='binary'; "
                    f"got task={task!r}. Clear the calibration block or "
                    f"switch the task to 'binary'."
                ),
                "input": calibration,
            }
        )

    return errors
