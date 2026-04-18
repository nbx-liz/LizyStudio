"""Regression test for R² on constant target (Issue #156).

``_compute_inf_metrics`` returned ``r2 = 0.0`` when ``ss_tot == 0``
(constant ground truth). The statistical convention is that R² is
undefined for a constant target — returning ``NaN`` is the correct
reporting; ``0.0`` silently misleads users on degenerate slices (e.g.
a single-class split inside a binary regression task).
"""

from __future__ import annotations

import math

import pandas as pd
import pytest

from lizystudio.services.inference import _compute_inf_metrics

pytestmark = pytest.mark.unit


def test_r2_is_nan_when_target_is_constant() -> None:
    """INV: r2 is NaN when ss_tot == 0 (constant actual)."""
    pred_df = pd.DataFrame(
        {
            "actual": [5.0, 5.0, 5.0, 5.0],
            "pred": [4.8, 5.1, 5.0, 4.9],
        }
    )
    metrics = _compute_inf_metrics(pred_df, {"task": "regression"})
    assert "r2" in metrics
    assert math.isnan(metrics["r2"]), f"expected NaN, got {metrics['r2']!r}"


def test_r2_is_nan_when_predictions_are_also_constant() -> None:
    """Even when predictions == actual (zero residuals), a constant
    target still has undefined R². The statistical ``1.0`` convention
    for zero-residual + constant-target is NOT adopted here because it
    is ambiguous — NaN flags the degenerate slice explicitly.
    """
    pred_df = pd.DataFrame(
        {
            "actual": [3.0, 3.0, 3.0],
            "pred": [3.0, 3.0, 3.0],
        }
    )
    metrics = _compute_inf_metrics(pred_df, {"task": "regression"})
    assert math.isnan(metrics["r2"])


def test_r2_is_finite_for_non_degenerate_target() -> None:
    """Sanity: the fix does not regress the normal case."""
    pred_df = pd.DataFrame(
        {
            "actual": [1.0, 2.0, 3.0, 4.0, 5.0],
            "pred": [1.1, 1.9, 3.0, 4.2, 4.8],
        }
    )
    metrics = _compute_inf_metrics(pred_df, {"task": "regression"})
    assert math.isfinite(metrics["r2"])
    # With near-perfect predictions, r2 should be close to 1.0.
    assert metrics["r2"] > 0.9


def test_r2_is_negative_when_predictions_are_worse_than_mean() -> None:
    """A model that predicts worse than the target mean yields r2 < 0 —
    unchanged by this fix, regression guard for the happy path.
    """
    pred_df = pd.DataFrame(
        {
            "actual": [1.0, 2.0, 3.0, 4.0, 5.0],
            "pred": [5.0, 4.0, 3.0, 2.0, 1.0],  # inverse of actual
        }
    )
    metrics = _compute_inf_metrics(pred_df, {"task": "regression"})
    assert metrics["r2"] < 0
