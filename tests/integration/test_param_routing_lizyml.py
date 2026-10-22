"""Tuned and fixed values reach lizyml where it reads them (P-0116 D2, #721).

Runs a real lizyml Tune, builds the autofit config the way the job does, fits
through ``LizyMLAdapter.create_model``, and reads the exported model's
``metadata.json`` config: smart values on the model section, early stopping on
``training``, and only LightGBM names in ``model.params``.  Before routing,
the tuned smart and training values sat in ``model.params`` where lizyml 0.15
ignored them and 0.20 refuses them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.lizyml.config_mixin import _catalog_default_space
from lizystudio.services._training_core import _prepare_autofit_config

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml" / "tune"

_NON_LGBM = {
    "auto_num_leaves",
    "num_leaves_ratio",
    "min_data_in_leaf_ratio",
    "min_data_in_bin_ratio",
    "feature_weights",
    "balanced",
    "early_stopping_rounds",
    "early_stopping.rounds",
    "early_stopping.enabled",
    "validation_ratio",
    "inner_valid",
    "seed",
}


def _base_config() -> dict[str, Any]:
    config: dict[str, Any] = json.loads((FIXTURE / "config.json").read_text())
    config["tuning"] = {
        "optuna": {"params": {"n_trials": 2}, "space": _catalog_default_space()}
    }
    return config


def _exported_config(config: dict[str, Any], tmp_path: Path) -> dict[str, Any]:
    df = pd.read_csv(FIXTURE / "data.csv")
    backend = LizyMLAdapter()
    model = backend.create_model(config, df)
    backend.fit(model)
    out_dir = tmp_path / "model"
    backend.export_model(model, str(out_dir))
    metadata = json.loads((out_dir / "metadata.json").read_text())
    exported: dict[str, Any] = metadata["config"]
    return exported


@pytest.mark.integration
def test_autofit_routes_tuned_values(tmp_path: Path) -> None:
    df = pd.read_csv(FIXTURE / "data.csv")
    backend = LizyMLAdapter()
    base = _base_config()
    tuned = backend.tune(backend.create_model(base, df))
    fit_config = _prepare_autofit_config(base, tuned.best_params)

    exported = _exported_config(fit_config, tmp_path)

    best = tuned.best_params
    assert not set(exported["model"]["params"]) & _NON_LGBM
    assert exported["model"]["num_leaves_ratio"] == pytest.approx(
        best["num_leaves_ratio"]
    )
    es = exported["training"]["early_stopping"]
    assert es["rounds"] == best["early_stopping_rounds"]
    assert es["inner_valid"]["ratio"] == pytest.approx(best["validation_ratio"])
    # A tuned ratio is not a user pick (D-20261020-008 option A).
    assert es["inner_valid_explicit"] is False


@pytest.mark.integration
@pytest.mark.parametrize("marker", [True, False])
def test_the_inner_valid_marker_reaches_lizyml(tmp_path: Path, marker: bool) -> None:
    # The UI marks a user pick true (child 5b); routing keeps that bool.
    config = _base_config()
    config.pop("tuning")
    config["model"]["params"]["inner_valid"] = "holdout"
    config["training"]["early_stopping"]["inner_valid_explicit"] = marker

    exported = _exported_config(config, tmp_path)

    es = exported["training"]["early_stopping"]
    assert es["inner_valid_explicit"] is marker
    assert es["inner_valid"]["method"] == "holdout"


@pytest.mark.integration
def test_fixed_mode_values_reach_training(tmp_path: Path) -> None:
    config = _base_config()
    config.pop("tuning")
    config["model"]["params"].update(
        {"seed": 7, "early_stopping.rounds": 33, "inner_valid": "holdout"}
    )

    exported = _exported_config(config, tmp_path)

    assert not set(exported["model"]["params"]) & _NON_LGBM
    assert exported["training"]["seed"] == 7
    assert exported["training"]["early_stopping"]["rounds"] == 33
    assert exported["training"]["early_stopping"]["inner_valid"]["method"] == "holdout"
