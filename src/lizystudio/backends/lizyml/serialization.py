"""Serialization helpers that turn lizyml dataclasses into plain dicts.

Extracted from the monolithic ``lizyml.py`` (H-0062 cleanup). These
helpers form the boundary between lizyml's internal types and the
Studio common type layer (``backends.types``); no external callers
should reach into lizyml objects directly.
"""

from __future__ import annotations

from typing import Any

from lizystudio.backends.types import TuningSummary


def serialize_tuning_result(tune_result: Any) -> TuningSummary:
    """Convert lizyml ``TuningResult`` into Studio ``TuningSummary``.

    Populates the optional ``rounds`` and ``boundary_report`` fields
    when the lizyml result carries H-0068 data.  Legacy results without
    those fields produce a summary with ``rounds=None`` and
    ``boundary_report=None``.
    """
    rounds = serialize_rounds(getattr(tune_result, "rounds", None))
    boundary = serialize_boundary_report(getattr(tune_result, "boundary_report", None))
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


def serialize_rounds(rounds: Any) -> list[dict[str, Any]] | None:
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
                    serialize_search_dim(dim) for dim in r.space_snapshot
                ],
            }
        )
    return out


def serialize_boundary_report(report: Any) -> dict[str, Any] | None:
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
                # P-0104 Wave 3.1b / Issue #461: lizyml v0.15 flags dims
                # whose proposed expansion was clipped by ``parameter_bounds``.
                # The Re-tune UI badges these so the user knows the search
                # range hit the hard library limit.
                "clamped_to_bound": bool(getattr(d, "clamped_to_bound", False)),
            }
            for d in dims
        ],
        "expanded_names": list(getattr(report, "expanded_names", ())),
    }


def search_dim_type_label(dim: Any) -> str:
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


def serialize_search_dim(dim: Any) -> dict[str, Any]:
    """Serialize a lizyml ``SearchDim`` into a plain dict.

    The snapshot captures just enough to render a Search Space Evolution
    view — type, name, category, and the type-specific range — without
    pulling backend-specific objects into Studio's common type boundary.
    Missing attributes are omitted rather than emitted as ``None`` so
    the UI can use ``"low" in dim`` to discriminate numeric vs categorical.
    """
    result: dict[str, Any] = {
        "name": getattr(dim, "name", None),
        "type": search_dim_type_label(dim),
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
