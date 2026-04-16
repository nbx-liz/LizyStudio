"""Regression test for deep stripping of internal keys (Issue #115).

strip_internal_keys must remove underscore-prefixed keys not only from
model.params but also from nested sub-sections like tuning.optuna and
any top-level 'result' bookkeeping section that the UI may inject
during a round-trip.
"""

from __future__ import annotations

import pytest

from lizystudio.backends.lizyml.config_compat import strip_internal_keys

pytestmark = pytest.mark.unit


def test_strips_underscore_keys_from_tuning_optuna() -> None:
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {"depth": 6}},
        "tuning": {
            "optuna": {
                "n_trials": 50,
                "_ui_draft": True,
                "space": {"depth": {"low": 3, "high": 10}},
            },
        },
    }
    result = strip_internal_keys(config)
    assert "_ui_draft" not in result["tuning"]["optuna"]
    assert result["tuning"]["optuna"]["n_trials"] == 50
    assert result["tuning"]["optuna"]["space"] == {"depth": {"low": 3, "high": 10}}


def test_strips_top_level_result_section() -> None:
    config = {
        "task": "binary",
        "model": {"name": "lgbm", "params": {}},
        "result": {"_runtime_ms": 1234, "_cache_hit": True},
    }
    result = strip_internal_keys(config)
    assert "result" not in result


def test_strips_underscore_keys_from_model_params_still_works() -> None:
    config = {
        "model": {"name": "lgbm", "params": {"depth": 6, "_importance": [1, 2]}},
    }
    result = strip_internal_keys(config)
    assert "_importance" not in result["model"]["params"]
    assert result["model"]["params"]["depth"] == 6


def test_preserves_non_internal_keys_everywhere() -> None:
    config = {
        "task": "binary",
        "data": {"path": "/x.csv", "target": "y"},
        "model": {"name": "lgbm", "params": {"lr": 0.1}},
        "tuning": {"optuna": {"n_trials": 20, "space": {}}},
        "split": {"method": "kfold", "n_splits": 5},
    }
    result = strip_internal_keys(config)
    assert result["task"] == "binary"
    assert result["data"] == {"path": "/x.csv", "target": "y"}
    assert result["split"] == {"method": "kfold", "n_splits": 5}
    assert result["tuning"]["optuna"]["n_trials"] == 20
