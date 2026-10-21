"""The adapter hands lizyml the wire form of the search space (P-0116 D1, #721).

Runs a real lizyml Tune through ``LizyMLAdapter.create_model`` with Studio's
catalog-keyed default space, and checks how lizyml routed each dim.  Before
the wire form, the training dims reached lizyml as unknown model parameters
(``early_stopping.rounds``) and a ``"false"`` boolean choice switched a smart
parameter on (Issue #689).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.lizyml.config_mixin import _catalog_default_space
from lizystudio.backends.lizyml.space_wire import WIRE_TABLE

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml" / "tune"

_SMART = {key for key, row in WIRE_TABLE.items() if row.category == "smart"}
_TRAINING = {row.wire_name for row in WIRE_TABLE.values() if row.category == "training"}


def _tune_config(space: dict[str, Any], n_trials: int = 2) -> dict[str, Any]:
    config: dict[str, Any] = json.loads((FIXTURE / "config.json").read_text())
    config["tuning"] = {"optuna": {"params": {"n_trials": n_trials}, "space": space}}
    return config


def _tune(config: dict[str, Any]) -> Any:
    df = pd.read_csv(FIXTURE / "data.csv")
    backend = LizyMLAdapter()
    model = backend.create_model(config, df)
    return model.tune()


@pytest.mark.integration
def test_default_catalog_space_is_routed_by_category() -> None:
    result = _tune(_tune_config(_catalog_default_space()))

    assert set(result.best_training_params) == _TRAINING
    assert not set(result.best_model_params) & (
        _SMART | _TRAINING | {"early_stopping.rounds"}
    )
    assert set(result.best_smart_params) == {
        "num_leaves_ratio",
        "min_data_in_leaf_ratio",
        "min_data_in_bin_ratio",
    }


@pytest.mark.integration
def test_false_boolean_choice_trains_the_smart_param_off() -> None:
    """Regression for #689: the UI's ``"false"`` string must reach lizyml as False."""
    space = {
        "auto_num_leaves": {"type": "categorical", "choices": ["false"]},
        "learning_rate": {"type": "float", "low": 1e-3, "high": 1e-2, "log": True},
    }
    config = _tune_config(space, n_trials=1)
    config["model"]["auto_num_leaves"] = False

    result = _tune(config)

    assert result.best_smart_params["auto_num_leaves"] is False
