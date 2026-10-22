"""Tests for the lizyml wire form of the Tune search space (P-0116 D1, #721).

Studio keeps the search space keyed by its UI catalog key everywhere above
the adapter (workspace config, job snapshot, ``TuneTab``).  The adapter
translates it into the shape lizyml reads at the ``create_model`` boundary:
the lizyml parameter name, the ``category`` lizyml routes it by, boolean
choices as booleans, and dims whose owner can never be on dropped.
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from lizystudio.backends.lizyml.space_wire import (
    WIRE_TABLE,
    WireNameCollisionError,
    to_wire_config,
    to_wire_entry,
    to_wire_space,
)
from lizystudio.backends.lizyml_ui_schema import _SEARCH_SPACE_CATALOG

pytestmark = pytest.mark.unit


def _config(
    space: dict[str, Any],
    *,
    auto_num_leaves: Any = True,
    early_stopping_enabled: Any = True,
) -> dict[str, Any]:
    return {
        "task": "binary",
        "model": {"name": "lgbm", "params": {}, "auto_num_leaves": auto_num_leaves},
        "training": {"early_stopping": {"enabled": early_stopping_enabled}},
        "tuning": {"optuna": {"params": {"n_trials": 5}, "space": space}},
    }


RANGE = {"type": "float", "low": 0.1, "high": 0.3, "log": False}


class TestTable:
    def test_table_covers_exactly_the_catalog(self) -> None:
        catalog_keys = {entry["key"] for entry in _SEARCH_SPACE_CATALOG}
        assert set(WIRE_TABLE) == catalog_keys

    def test_every_tunable_row_has_a_category_and_fixed_only_rows_have_none(
        self,
    ) -> None:
        for entry in _SEARCH_SPACE_CATALOG:
            row = WIRE_TABLE[entry["key"]]
            tunable = any(m in ("range", "choice") for m in entry.get("modes", []))
            if tunable:
                assert row.category in ("model", "smart", "training"), entry["key"]
            else:
                assert row.category is None, entry["key"]

    @pytest.mark.parametrize(
        ("key", "wire_name", "category"),
        [
            ("num_leaves_ratio", "num_leaves_ratio", "smart"),
            ("min_data_in_leaf_ratio", "min_data_in_leaf_ratio", "smart"),
            ("min_data_in_bin_ratio", "min_data_in_bin_ratio", "smart"),
            ("auto_num_leaves", "auto_num_leaves", "smart"),
            ("balanced", "balanced", "smart"),
            # The UI groups num_leaves with the smart params, but it is a
            # native LightGBM parameter: lizyml refuses it as category smart.
            ("num_leaves", "num_leaves", "model"),
            ("learning_rate", "learning_rate", "model"),
            ("max_bin", "max_bin", "model"),
            ("objective", "objective", "model"),
            ("early_stopping.rounds", "early_stopping_rounds", "training"),
            ("validation_ratio", "validation_ratio", "training"),
        ],
    )
    def test_wire_name_and_category(
        self, key: str, wire_name: str, category: str
    ) -> None:
        assert WIRE_TABLE[key].wire_name == wire_name
        assert WIRE_TABLE[key].category == category


class TestToWireSpace:
    def test_default_catalog_space_gets_wire_names_and_categories(self) -> None:
        space = {
            "num_leaves_ratio": {**RANGE, "high": 1.0},
            "learning_rate": {"type": "float", "low": 1e-4, "high": 1e-2, "log": True},
            "early_stopping.rounds": {"type": "int", "low": 50, "high": 200},
            "validation_ratio": RANGE,
        }
        wire = to_wire_space(space, _config(space))
        assert wire == {
            "num_leaves_ratio": {**RANGE, "high": 1.0, "category": "smart"},
            "learning_rate": {
                "type": "float",
                "low": 1e-4,
                "high": 1e-2,
                "log": True,
                "category": "model",
            },
            "early_stopping_rounds": {
                "type": "int",
                "low": 50,
                "high": 200,
                "category": "training",
            },
            "validation_ratio": {**RANGE, "category": "training"},
        }

    def test_client_category_is_overridden_for_catalog_names(self) -> None:
        # The frontend derives category from the UI group, which marks
        # num_leaves as smart. The table decides.
        space = {
            "num_leaves": {"type": "int", "low": 8, "high": 64, "category": "smart"}
        }
        wire = to_wire_space(space, _config(space, auto_num_leaves=False))
        assert wire["num_leaves"]["category"] == "model"

    def test_unknown_names_pass_through_unchanged(self) -> None:
        entry = {"type": "int", "low": 5, "high": 50, "category": "model"}
        space = {"min_child_samples": entry, "extra_without_category": {**RANGE}}
        wire = to_wire_space(space, _config(space))
        assert wire["min_child_samples"] == entry
        assert wire["extra_without_category"] == RANGE

    @pytest.mark.parametrize(
        "key", ["auto_num_leaves", "balanced", "first_metric_only"]
    )
    def test_boolean_string_choices_become_booleans(self, key: str) -> None:
        space = {key: {"type": "categorical", "choices": ["true", "false"]}}
        wire = to_wire_space(space, _config(space))
        assert wire[key]["choices"] == [True, False]

    def test_boolean_coercion_leaves_none_and_real_booleans_alone(self) -> None:
        space = {"balanced": {"type": "categorical", "choices": [None, True, "false"]}}
        wire = to_wire_space(space, _config(space))
        assert wire["balanced"]["choices"] == [None, True, False]

    def test_non_boolean_rows_keep_string_choices(self) -> None:
        space = {"objective": {"type": "categorical", "choices": ["binary", "true"]}}
        wire = to_wire_space(space, _config(space))
        assert wire["objective"]["choices"] == ["binary", "true"]

    def test_input_is_not_mutated(self) -> None:
        space = {
            "early_stopping.rounds": {"type": "int", "low": 50, "high": 200},
            "auto_num_leaves": {"type": "categorical", "choices": ["true"]},
        }
        before = copy.deepcopy(space)
        to_wire_space(space, _config(space))
        assert space == before


LOG_RANGE = {"type": "float", "low": 1e-4, "high": 0.1, "log": True}


class TestLogRangeStep:
    """A log range is sent without ``step`` (#688, D-20261021-017 option 2).

    The UI ``step_map`` gives every range a step, but lizyml 0.20 puts a
    stepped dim on the multiples of its step, and the catalog's log lows
    (learning_rate 1e-4, lambda_l2 1e-6) are not on that grid.  A linear
    range keeps its step; an off-grid one is lizyml's to refuse.
    """

    def test_log_range_drops_step(self) -> None:
        raw = {**LOG_RANGE, "step": 0.001}
        assert to_wire_entry("learning_rate", raw) == (
            "learning_rate",
            {**LOG_RANGE, "category": "model"},
        )

    def test_log_range_drops_step_for_non_catalog_name(self) -> None:
        # step_map also covers additional params such as min_child_weight.
        raw = {**LOG_RANGE, "step": 0.001}
        assert to_wire_entry("min_child_weight", raw) == ("min_child_weight", LOG_RANGE)

    def test_linear_range_keeps_step(self) -> None:
        raw = {**RANGE, "step": 0.05}
        _name, entry = to_wire_entry("feature_fraction", raw)
        assert entry["step"] == 0.05

    @pytest.mark.parametrize("log", ["true", 1, None])
    def test_non_bool_log_keeps_step(self, log: Any) -> None:
        # Only a real boolean is a log range; anything else is lizyml's to
        # judge, with the step it was given (DC1).
        raw = {**LOG_RANGE, "log": log, "step": 0.001}
        _name, entry = to_wire_entry("learning_rate", raw)
        assert entry["step"] == 0.001
        assert entry["log"] == log

    def test_input_is_not_mutated(self) -> None:
        raw = {**LOG_RANGE, "step": 0.001}
        before = copy.deepcopy(raw)
        to_wire_entry("learning_rate", raw)
        assert raw == before

    def test_to_wire_config_drops_step_from_log_ranges(self) -> None:
        space = {
            "learning_rate": {**LOG_RANGE, "step": 0.001},
            "feature_fraction": {**RANGE, "step": 0.05},
        }
        wire = to_wire_config(_config(space))["tuning"]["optuna"]["space"]
        assert "step" not in wire["learning_rate"]
        assert wire["feature_fraction"]["step"] == 0.05


class TestOwnerRules:
    """Dims whose owner can never be on are not sent (P-0116 D1).

    ``num_leaves_ratio`` is read only while ``auto_num_leaves`` is true, and
    lizyml 0.20 refuses a user-written one when it cannot be. Studio's
    expanded catalog space reaches lizyml as user-written, so Studio drops it.
    The training dims follow a Studio policy: with early stopping fixed off,
    a tuned ``early_stopping_rounds`` would switch it back on.

    Fixed mode still writes ``early_stopping.enabled`` into ``model.params``
    until child 2 routes it to ``training.early_stopping``; only the
    ``training`` value is read here on purpose.
    """

    SPACE = {
        "num_leaves_ratio": {**RANGE, "high": 1.0},
        "early_stopping.rounds": {"type": "int", "low": 50, "high": 200},
        "validation_ratio": RANGE,
    }

    @pytest.mark.parametrize(
        ("auto_num_leaves_mode", "expect_ratio"),
        [
            ("fixed_true", True),
            ("fixed_false", False),
            ("choice_with_true", True),
            ("choice_false_only", False),
        ],
    )
    @pytest.mark.parametrize("early_stopping_enabled", [True, False])
    def test_owner_matrix(
        self,
        auto_num_leaves_mode: str,
        expect_ratio: bool,
        early_stopping_enabled: bool,
    ) -> None:
        space = dict(self.SPACE)
        fixed_auto: Any = True
        if auto_num_leaves_mode == "fixed_false":
            fixed_auto = False
        elif auto_num_leaves_mode == "choice_with_true":
            fixed_auto = False
            space["auto_num_leaves"] = {
                "type": "categorical",
                "choices": ["true", "false"],
            }
        elif auto_num_leaves_mode == "choice_false_only":
            space["auto_num_leaves"] = {"type": "categorical", "choices": ["false"]}
        config = _config(
            space,
            auto_num_leaves=fixed_auto,
            early_stopping_enabled=early_stopping_enabled,
        )

        wire = to_wire_space(space, config)

        assert ("num_leaves_ratio" in wire) is expect_ratio
        assert ("early_stopping_rounds" in wire) is early_stopping_enabled
        assert ("validation_ratio" in wire) is early_stopping_enabled

    def test_missing_owner_settings_count_as_lizyml_defaults(self) -> None:
        # lizyml defaults auto_num_leaves and early_stopping.enabled to true,
        # so an absent setting must not drop the dims.
        config = {"task": "binary", "model": {"name": "lgbm"}, "tuning": {}}
        wire = to_wire_space(dict(self.SPACE), config)
        assert set(wire) == {
            "num_leaves_ratio",
            "early_stopping_rounds",
            "validation_ratio",
        }


class TestToWireConfig:
    def test_replaces_only_the_space(self) -> None:
        space = {"early_stopping.rounds": {"type": "int", "low": 50, "high": 200}}
        config = _config(space)
        out = to_wire_config(config)
        assert out["tuning"]["optuna"]["space"] == {
            "early_stopping_rounds": {
                "type": "int",
                "low": 50,
                "high": 200,
                "category": "training",
            }
        }
        assert out["tuning"]["optuna"]["params"] == {"n_trials": 5}
        assert out["model"] == config["model"]
        assert config["tuning"]["optuna"]["space"] == space

    def test_a_non_empty_space_replaces_the_provider_defaults(self) -> None:
        # P-0116 D1 / child 4: Studio's catalog space is the whole space, so
        # lizyml 0.20 must not merge its default space (or fixed params) in.
        config = _config({"learning_rate": {"type": "float", "low": 0.01, "high": 0.1}})
        out = to_wire_config(config)
        assert out["tuning"]["optuna"]["space_mode"] == "replace"
        assert "space_mode" not in config["tuning"]["optuna"]

    @pytest.mark.parametrize(
        "config",
        [
            {"task": "binary"},
            {"task": "binary", "tuning": None},
            {"task": "binary", "tuning": {"optuna": {"params": {"n_trials": 1}}}},
            {"task": "binary", "tuning": {"optuna": {"space": {}}}},
        ],
    )
    def test_configs_without_a_space_are_returned_unchanged(
        self, config: dict[str, Any]
    ) -> None:
        # No space_mode either: an empty space must keep lizyml's merge
        # default, because replace with no dims would declare an empty space.
        assert to_wire_config(config) == config


class TestRunGate:
    """The run-gate judges each dim in the form lizyml will receive."""

    def test_frontend_smart_category_on_num_leaves_passes(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter

        space = {
            "num_leaves": {"type": "int", "low": 8, "high": 64, "category": "smart"},
            "auto_num_leaves": {"type": "categorical", "choices": ["true", "false"]},
        }
        assert LizyMLAdapter().validate_search_space(space) == []

    def test_error_path_keeps_the_catalog_key(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter

        space = {"early_stopping.rounds": {"type": "int", "low": 200, "high": 50}}
        errors = LizyMLAdapter().validate_search_space(space)
        paths = [e["path"] for e in errors]
        assert paths == ["tuning.optuna.space.early_stopping.rounds"]

    def test_ui_range_switch_of_log_rows_passes_run_gate(self) -> None:
        # The two catalog log rows lizyml 0.20 refused once the UI's Range
        # switch added the step_map step (#688): learning_rate 1e-4 on a 1e-3
        # grid, lambda_l2 1e-6 on a 1e-4 grid.
        from lizystudio.backends.lizyml import LizyMLAdapter

        space = {
            "learning_rate": {**LOG_RANGE, "step": 0.001},
            "lambda_l2": {
                "type": "float",
                "low": 1e-6,
                "high": 10.0,
                "log": True,
                "step": 0.0001,
            },
        }
        assert LizyMLAdapter().validate_search_space(space) == []

    def test_off_grid_linear_range_refused_at_run_gate(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter

        space = {"max_bin": {"type": "int", "low": 63, "high": 250, "step": 64}}
        errors = LizyMLAdapter().validate_search_space(space)
        assert [e["path"] for e in errors] == ["tuning.optuna.space.max_bin"]
        # lizyml names the nearest on-grid range; the fix suggests it.
        fix = errors[0]["suggested_fix"]
        assert "Min=64" in fix
        assert "Max=192" in fix


class TestWireNameCollisions:
    """Two entries that name one lizyml parameter must not silently collapse."""

    @pytest.mark.parametrize(
        "order",
        [
            ("early_stopping.rounds", "early_stopping_rounds"),
            ("early_stopping_rounds", "early_stopping.rounds"),
        ],
    )
    def test_to_wire_space_refuses_a_collision(self, order: tuple[str, str]) -> None:
        entry = {"type": "int", "low": 50, "high": 200}
        space = {key: dict(entry) for key in order}
        with pytest.raises(WireNameCollisionError) as excinfo:
            to_wire_space(space, _config(space))
        assert "early_stopping_rounds" in str(excinfo.value)

    @pytest.mark.parametrize(
        "order",
        [
            ("early_stopping.rounds", "early_stopping_rounds"),
            ("early_stopping_rounds", "early_stopping.rounds"),
        ],
    )
    def test_run_gate_reports_a_collision(self, order: tuple[str, str]) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter

        entry = {"type": "int", "low": 50, "high": 200}
        space = {key: dict(entry) for key in order}
        errors = LizyMLAdapter().validate_search_space(space)
        assert [e["path"] for e in errors] == [f"tuning.optuna.space.{order[1]}"]
        assert "early_stopping_rounds" in errors[0]["message"]
