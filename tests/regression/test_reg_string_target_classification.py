"""Regression tests for non-numeric classification targets (lizyml 0.10.0).

Locks the LizyStudio adapter contract under lizyml's H-0070 auto-encoded
target feature (LizyML Issue #98 / lizyml 0.10.0):

- INV: ``LizyMLAdapter.create_model -> fit`` succeeds for binary +
  multiclass when the target column is ``str`` / ``pd.StringDtype`` /
  category. Pre-0.10.0, the same input failed deep in LightGBM with
  ``pandas dtypes must be int, float or bool``.
- INV: ``adapter.predict`` returns ``pred`` in the *original label
  dtype* — predictions for a ``str`` target are ``str`` arrays
  (e.g. ``["Adelie", "Chinstrap", ...]``), never int codes.
- INV: ``adapter.predict.proba`` is populated for classification.

The data is generated inline with controlled signal so the synthetic
features predict the target strongly enough that fit / predict
produce a deterministic pass under the default LightGBM seed.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter

pytestmark = pytest.mark.integration


def _binary_str_dataset(n: int = 200, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    x1 = rng.normal(size=n)
    x2 = rng.normal(size=n)
    # Strong linear separator on x1 so classification converges fast.
    target = np.where(x1 + 0.1 * x2 > 0, "positive", "negative")
    return pd.DataFrame({"x1": x1, "x2": x2, "label": target})


def _multiclass_str_dataset(n: int = 240, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    species = np.array(["Adelie", "Chinstrap", "Gentoo"])
    # 3 well-separated clusters so multiclass is easy to fit.
    cls = rng.integers(0, 3, size=n)
    bill = rng.normal(loc=cls * 5.0, scale=0.5, size=n)
    flipper = rng.normal(loc=cls * 10.0, scale=1.0, size=n)
    return pd.DataFrame(
        {
            "bill_length_mm": bill,
            "flipper_length_mm": flipper,
            "species": species[cls],
        }
    )


def _binary_config() -> dict[str, Any]:
    return {
        "config_version": 1,
        "task": "binary",
        "data": {
            "path": "/in-memory/binary.csv",
            "target": "label",
            "time_col": None,
            "group_col": None,
        },
        "features": {"exclude": [], "auto_categorical": True, "categorical": []},
        "split": {
            "method": "stratified_kfold",
            "n_splits": 3,
            "random_state": 42,
        },
        "model": {
            "name": "lgbm",
            "params": {
                "metric": ["binary_logloss"],
                "objective": "binary",
            },
            "auto_num_leaves": True,
            "num_leaves_ratio": 1,
            "min_data_in_leaf_ratio": 0.01,
            "min_data_in_bin_ratio": 0.01,
            "feature_weights": None,
            "balanced": None,
        },
        "training": {
            "seed": 42,
            "early_stopping": {
                "enabled": False,
                "rounds": 20,
                "inner_valid": {
                    "method": "holdout",
                    "ratio": 0.1,
                    "stratify": False,
                    "random_state": 42,
                },
            },
        },
        "tuning": None,
        "evaluation": {"metrics": ["accuracy", "logloss"]},
        "calibration": None,
        "output_dir": None,
    }


def _multiclass_config() -> dict[str, Any]:
    cfg = _binary_config()
    cfg["task"] = "multiclass"
    cfg["data"]["target"] = "species"
    cfg["model"]["params"] = {
        "metric": ["multi_logloss"],
        "objective": "multiclass",
    }
    cfg["evaluation"] = {"metrics": ["accuracy", "logloss"]}
    return cfg


def test_fit_succeeds_with_string_binary_target() -> None:
    """Binary fit on a string target completes (was a 0.9.x failure)."""
    df = _binary_str_dataset()
    adapter = LizyMLAdapter()

    model = adapter.create_model(_binary_config(), df)
    fit_result = adapter.fit(model)

    assert fit_result is not None
    assert fit_result.fold_count == 3


def test_fit_succeeds_with_string_multiclass_target() -> None:
    """Multiclass fit on a string target completes (was the user-reported
    species:str failure)."""
    df = _multiclass_str_dataset()
    adapter = LizyMLAdapter()

    model = adapter.create_model(_multiclass_config(), df)
    fit_result = adapter.fit(model)

    assert fit_result is not None
    assert fit_result.fold_count == 3


def test_predict_returns_original_string_labels_binary() -> None:
    """``predict.pred`` carries the original string labels, not int codes."""
    df = _binary_str_dataset()
    adapter = LizyMLAdapter()

    model = adapter.create_model(_binary_config(), df)
    adapter.fit(model)
    summary = adapter.predict(model, df.drop(columns=["label"]))

    pred_values = summary.predictions["pred"].tolist()
    # Every prediction is one of the two original string labels.
    assert set(pred_values) <= {"positive", "negative"}, (
        f"binary predictions leaked non-original labels: "
        f"{set(pred_values) - {'positive', 'negative'}}"
    )
    # Both classes appear at least once given the balanced synthetic data.
    assert len(set(pred_values)) == 2


def test_predict_returns_original_string_labels_multiclass() -> None:
    """Multiclass predictions decode back to {Adelie, Chinstrap, Gentoo}."""
    df = _multiclass_str_dataset()
    adapter = LizyMLAdapter()

    model = adapter.create_model(_multiclass_config(), df)
    adapter.fit(model)
    summary = adapter.predict(model, df.drop(columns=["species"]))

    pred_values = summary.predictions["pred"].tolist()
    expected = {"Adelie", "Chinstrap", "Gentoo"}
    assert set(pred_values) <= expected, (
        f"multiclass predictions leaked non-original labels: "
        f"{set(pred_values) - expected}"
    )
    # All three species recovered on this well-separated synthetic set.
    assert set(pred_values) == expected


def test_multiclass_predict_emits_per_class_proba_columns() -> None:
    """The 2-D ``proba`` from lizyml's multiclass predict is split into
    per-class columns named ``proba_<class>`` so the result DataFrame
    stays parquet-friendly. Class column names match
    ``fit_result.target_encoder.classes_`` order.
    """
    df = _multiclass_str_dataset()
    adapter = LizyMLAdapter()

    model = adapter.create_model(_multiclass_config(), df)
    adapter.fit(model)
    summary = adapter.predict(model, df.drop(columns=["species"]))

    columns = list(summary.predictions.columns)
    assert "pred" in columns
    # No flat "proba" column when target is multiclass.
    assert "proba" not in columns
    # Per-class columns present and sum to ~1 per row.
    expected_cols = {"proba_Adelie", "proba_Chinstrap", "proba_Gentoo"}
    assert expected_cols.issubset(columns)
    proba_sum = summary.predictions[list(expected_cols)].sum(axis=1)
    assert (proba_sum.between(0.99, 1.01)).all(), (
        f"per-class proba did not sum to 1: {proba_sum.describe()}"
    )
