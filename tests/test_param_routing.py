"""Routing of ``model.params`` names to their Fit-config places (P-0116 D2, #721).

Five writers put flat values into ``model.params``:

* autofit and retune merge a tune's ``best_params``
  (``services/_training_core.py::_prepare_autofit_config``);
* the unpause skip path rebuilds ``best_params`` from the Optuna study and
  merges it the same way;
* the frontend's Apply to Fit merges ``best_params`` (``TuneTrialsSection``);
* the Tune tab's Fixed mode writes each catalog key and value
  (``TuneTab.handleModelParamChange``).

lizyml reads smart and training settings elsewhere, and 0.20 refuses them in
``model.params``.  Every writer's config reaches lizyml through
``LizyMLAdapter.create_model``, which routes each name by ``WIRE_TABLE``'s Fit
destination.  The persisted configs keep their shape.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from lizystudio.backends.lizyml.space_wire import route_model_params, to_wire_config

pytestmark = pytest.mark.unit


def _fit_config(params: dict[str, Any], **training: Any) -> dict[str, Any]:
    return {
        "task": "binary",
        "model": {
            "name": "lgbm",
            "params": params,
            "auto_num_leaves": True,
            "num_leaves_ratio": 1.0,
        },
        "training": {
            "seed": 1120,
            "early_stopping": {
                "enabled": True,
                "rounds": 150,
                "inner_valid": {"method": "holdout", "ratio": 0.1},
                "validation_ratio": 0.1,
            },
            **training,
        },
    }


class TestRouting:
    def test_native_params_stay(self) -> None:
        params = {"learning_rate": 0.01, "num_leaves": 31, "min_child_samples": 5}
        out = route_model_params(_fit_config(dict(params)))
        assert out["model"]["params"] == params

    @pytest.mark.parametrize(
        "key",
        [
            "auto_num_leaves",
            "num_leaves_ratio",
            "min_data_in_leaf_ratio",
            "min_data_in_bin_ratio",
            "feature_weights",
            "balanced",
        ],
    )
    def test_smart_params_move_to_the_model_section(self, key: str) -> None:
        value: Any = {"feature_weights": {"a": 2.0}}.get(key, 0.5)
        out = route_model_params(_fit_config({key: value, "learning_rate": 0.01}))
        assert out["model"][key] == value
        assert out["model"]["params"] == {"learning_rate": 0.01}

    def test_params_value_wins_over_the_model_field(self) -> None:
        # autofit merges the tuned value into model.params; it must win over
        # the value the Fit tab left on the model section.
        out = route_model_params(_fit_config({"num_leaves_ratio": 0.6}))
        assert out["model"]["num_leaves_ratio"] == 0.6

    @pytest.mark.parametrize("name", ["early_stopping_rounds", "early_stopping.rounds"])
    def test_rounds_move_to_early_stopping(self, name: str) -> None:
        out = route_model_params(_fit_config({name: 77}))
        assert out["training"]["early_stopping"]["rounds"] == 77
        assert out["model"]["params"] == {}

    def test_seed_and_enabled_move_to_training(self) -> None:
        out = route_model_params(
            _fit_config({"seed": 7, "early_stopping.enabled": False})
        )
        assert out["training"]["seed"] == 7
        assert out["training"]["early_stopping"]["enabled"] is False
        assert out["model"]["params"] == {}

    def test_validation_ratio_keeps_split_aware_resolution(self) -> None:
        # A ratio, from a tune or from Fixed mode, is not a method choice:
        # lizyml keeps resolving the inner split, with this ratio
        # (D-20261020-008 option A: explicit only for a picker choice).
        out = route_model_params(_fit_config({"validation_ratio": 0.25}))
        es = out["training"]["early_stopping"]
        assert es["validation_ratio"] == 0.25
        assert es["inner_valid"] == {"method": "holdout", "ratio": 0.25}
        assert out["model"]["params"] == {}

    def test_inner_valid_method_keeps_split_aware_resolution(self) -> None:
        # model.params.inner_valid is written both by a user pick and by the
        # Tune tab's automatic CV recommendation (TuneTab.tsx:212-220); the
        # name does not tell them apart.  Until the UI marks a pick (child 5,
        # the 0.20 marker), the method is carried with validation_ratio kept,
        # which lizyml 0.15 reads as not explicit (D-20261020-008 option A:
        # an automatic recommendation is never explicit).
        out = route_model_params(_fit_config({"inner_valid": "time_holdout"}))
        es = out["training"]["early_stopping"]
        assert es["inner_valid"] == {"method": "time_holdout", "ratio": 0.1}
        assert es["validation_ratio"] == 0.1
        assert out["model"]["params"] == {}

    def test_tune_tab_output_with_a_tuned_ratio_stays_automatic(self) -> None:
        # Real Tune-tab output after autofit: the automatic inner_valid
        # recommendation plus the tuned validation_ratio.
        out = route_model_params(
            _fit_config({"inner_valid": "group_holdout", "validation_ratio": 0.2})
        )
        es = out["training"]["early_stopping"]
        assert es["inner_valid"] == {"method": "group_holdout", "ratio": 0.2}
        assert es["validation_ratio"] == 0.2

    def test_inner_valid_on_a_config_without_early_stopping(self) -> None:
        config = {"task": "binary", "model": {"params": {"inner_valid": "holdout"}}}
        out = route_model_params(config)
        assert out["training"]["early_stopping"] == {
            "inner_valid": {"method": "holdout", "ratio": 0.1},
            "validation_ratio": 0.1,
        }

    def test_a_lizyml_020_marker_is_left_untouched(self) -> None:
        # lizyml 0.20 defaults dump inner_valid_explicit: false. Routing does
        # not decide explicitness, so the marker stays as the config has it.
        config = _fit_config({"inner_valid": "holdout", "validation_ratio": 0.2})
        config["training"]["early_stopping"]["inner_valid_explicit"] = False
        es = route_model_params(config)["training"]["early_stopping"]
        assert es["inner_valid_explicit"] is False

    @pytest.mark.parametrize(
        "order",
        [
            ("early_stopping.rounds", "early_stopping_rounds"),
            ("early_stopping_rounds", "early_stopping.rounds"),
        ],
    )
    def test_both_rounds_spellings_the_tuned_spelling_wins(
        self, order: tuple[str, str], caplog: pytest.LogCaptureFixture
    ) -> None:
        # A stale Fixed-mode value (catalog spelling) and a tuned value (wire
        # spelling, from best_params) can both be present; the tuned one wins
        # whatever the dict order, and the dropped one is logged.
        values = {"early_stopping.rounds": 150, "early_stopping_rounds": 73}
        params = {name: values[name] for name in order}
        with caplog.at_level("WARNING"):
            out = route_model_params(_fit_config(params))
        assert out["training"]["early_stopping"]["rounds"] == 73
        assert out["model"]["params"] == {}
        assert "early_stopping.rounds" in caplog.text

    @pytest.mark.parametrize(
        ("training", "where"),
        [
            ("not-a-dict", "training"),
            (None, "training"),
            ({"seed": 1, "early_stopping": None}, "early_stopping"),
            ({"seed": 1, "early_stopping": "not-a-dict"}, "early_stopping"),
        ],
    )
    def test_malformed_training_sections_are_not_replaced(
        self, training: Any, where: str
    ) -> None:
        # strip_internal_keys keeps malformed shapes so lizyml's schema rejects
        # them; routing must not swap them for empty dicts (DC1).
        config = {
            "task": "binary",
            "model": {
                "params": {"seed": 7, "early_stopping_rounds": 70},
                "num_leaves_ratio": 1.0,
            },
            "training": training,
        }
        out = route_model_params(config)
        assert out["training"] == training
        assert out["model"]["params"] == {"seed": 7, "early_stopping_rounds": 70}

    def test_malformed_training_still_routes_smart_names(self) -> None:
        config = {
            "task": "binary",
            "model": {"params": {"num_leaves_ratio": 0.6}},
            "training": "not-a-dict",
        }
        out = route_model_params(config)
        assert out["model"]["num_leaves_ratio"] == 0.6
        assert out["training"] == "not-a-dict"

    def test_input_is_not_mutated(self) -> None:
        config = _fit_config(
            {
                "num_leaves_ratio": 0.6,
                "early_stopping_rounds": 77,
                "inner_valid": "holdout",
            }
        )
        before = copy.deepcopy(config)
        route_model_params(config)
        assert config == before

    @pytest.mark.parametrize(
        "config",
        [
            {"task": "binary"},
            {"task": "binary", "model": {"name": "lgbm"}},
            {"task": "binary", "model": {"params": {}}},
            {"task": "binary", "model": {"params": {"learning_rate": 0.01}}},
        ],
    )
    def test_nothing_to_route_is_unchanged(self, config: dict[str, Any]) -> None:
        assert route_model_params(config) == config


class TestFiveWriters:
    """Each writer's config, as ``create_model`` hands it to lizyml."""

    TUNED = {
        "learning_rate": 0.004,
        "num_leaves_ratio": 0.62,
        "min_data_in_leaf_ratio": 0.19,
        "early_stopping_rounds": 73,
        "validation_ratio": 0.13,
    }

    EXPECTED_MODEL = {
        "name": "lgbm",
        "params": {"objective": "binary", "learning_rate": 0.004},
        "auto_num_leaves": True,
        "num_leaves_ratio": 0.62,
        "min_data_in_leaf_ratio": 0.19,
    }
    EXPECTED_EARLY_STOPPING = {
        "enabled": True,
        "rounds": 73,
        "inner_valid": {"method": "holdout", "ratio": 0.13},
        "validation_ratio": 0.13,
    }

    def _base(self) -> dict[str, Any]:
        # The Tune tab writes the CV-recommended inner_valid into model.params
        # on its own (TuneTab.tsx:212-220), so every writer carries it.
        config = _fit_config({"objective": "binary", "inner_valid": "holdout"})
        config["tuning"] = {"optuna": {"params": {"n_trials": 3}, "space": {}}}
        return config

    def _check(self, handed: dict[str, Any]) -> None:
        assert handed["model"] == self.EXPECTED_MODEL
        assert handed["training"]["early_stopping"] == self.EXPECTED_EARLY_STOPPING
        assert handed["training"]["seed"] == 1120

    def test_autofit_and_retune(self) -> None:
        from lizystudio.services._training_core import _prepare_autofit_config

        self._check(to_wire_config(_prepare_autofit_config(self._base(), self.TUNED)))

    def test_unpause_skip_path(self) -> None:
        # The skip path rebuilds best_params from Optuna, whose trial params
        # carry the wire names, and merges them through the same helper.
        from lizystudio.services._training_core import _prepare_autofit_config

        rebuilt = dict(self.TUNED)
        self._check(to_wire_config(_prepare_autofit_config(self._base(), rebuilt)))

    def test_apply_to_fit(self) -> None:
        # TuneTrialsSection.buildFitConfig: drop tuning, spread best_params
        # over model.params.
        base = self._base()
        base.pop("tuning")
        base["model"]["params"] = {**base["model"]["params"], **self.TUNED}
        self._check(to_wire_config(base))

    def test_fixed_mode(self) -> None:
        # TuneTab Fixed mode writes catalog keys into model.params.
        base = self._base()
        base["model"]["params"].update(
            {
                "learning_rate": 0.004,
                "num_leaves_ratio": 0.62,
                "min_data_in_leaf_ratio": 0.19,
                "early_stopping.rounds": 73,
                "validation_ratio": 0.13,
            }
        )
        self._check(to_wire_config(base))
