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

from lizystudio.backends.exceptions import SearchSpaceRefusedError
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


@pytest.mark.integration
def test_log_rows_with_ui_step_are_admitted() -> None:
    """Regression for #688: a log range with the UI step_map step is admitted.

    The UI's Range switch adds the step_map step to every row.  lizyml 0.20
    put learning_rate's 1e-4 low off its 1e-3 grid and refused the Tune
    before trial 0; the step is now dropped for log ranges only.
    """
    space = {
        "learning_rate": {
            "type": "float",
            "low": 0.0001,
            "high": 0.1,
            "log": True,
            "step": 0.001,
        },
        "feature_fraction": {
            "type": "float",
            "low": 0.5,
            "high": 1.0,
            "log": False,
            "step": 0.05,
        },
    }

    result = _tune(_tune_config(space, n_trials=2))

    assert len(result.trials) == 2
    dims = {dim.name: dim for dim in result.rounds[0].space_snapshot}
    assert dims["learning_rate"].log is True
    assert dims["learning_rate"].step is None
    assert dims["feature_fraction"].step == 0.05


_INT = {"type": "int", "low": 8, "high": 64}


@pytest.mark.integration
@pytest.mark.parametrize(
    ("space", "dims"),
    [
        pytest.param(
            {
                "learning_rate": {"type": "float", "low": 0.01, "high": 0.1},
                "eta": {"type": "float", "low": 0.01, "high": 0.1},
            },
            ("eta", "learning_rate"),
            id="alias",
        ),
        pytest.param({"seed": {**_INT}}, ("seed",), id="training-owned-model-dim"),
        pytest.param({"num_leaves": {**_INT}}, ("num_leaves",), id="auto-num-leaves"),
        pytest.param(
            {"objective": {"type": "categorical", "choices": ["regression"]}},
            ("objective",),
            id="objective",
        ),
        pytest.param(
            {"max_bin": {"type": "int", "low": 63, "high": 250, "step": 64}},
            ("max_bin",),
            id="off-grid",
        ),
        pytest.param(
            {"not_a_param": {"type": "float", "low": 0.1, "high": 0.9}},
            ("not_a_param",),
            id="unknown-model-dim",
        ),
    ],
)
def test_space_refusal_is_its_own_error(
    space: dict[str, Any], dims: tuple[str, ...]
) -> None:
    """lizyml's pre-trial space refusals surface by dim (P-0116 D1).

    Each refusal shape in the table reaches the job as
    :class:`SearchSpaceRefusedError`, from ``tune`` (not ``create_model``),
    before any trial is reported.
    """
    df = pd.read_csv(FIXTURE / "data.csv")
    backend = LizyMLAdapter()
    model = backend.create_model(_tune_config(space, n_trials=1), df)
    reports: list[dict[str, Any]] = []

    with pytest.raises(SearchSpaceRefusedError) as excinfo:
        backend.tune(model, on_progress=lambda **kw: reports.append(kw))

    assert excinfo.value.dims == dims
    assert not [r for r in reports if r.get("trial_results")]
    assert all(r["current"] == 0 for r in reports)


@pytest.mark.integration
def test_smart_dimension_collision_is_a_space_refusal() -> None:
    """A fixed name a smart dim of the space manages is refused by space (P-0116 D1).

    With ``model.params.max_leaves`` fixed and ``auto_num_leaves`` off, a
    smart ``auto_num_leaves`` dim that can turn it on is refused before any
    trial.  lizyml locates the space in ``space_surface``, not ``surface``.
    """
    df = pd.read_csv(FIXTURE / "data.csv")
    config = _tune_config(
        {"auto_num_leaves": {"type": "categorical", "choices": [True, False]}},
        n_trials=1,
    )
    config["model"]["auto_num_leaves"] = False
    config["model"]["params"]["max_leaves"] = 31
    backend = LizyMLAdapter()
    model = backend.create_model(config, df)

    with pytest.raises(SearchSpaceRefusedError) as excinfo:
        backend.tune(model)

    assert excinfo.value.dims == ("auto_num_leaves",)
