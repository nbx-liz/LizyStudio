"""P-0116 D5, the dual-version backend part (#721; child 3a).

* ``embargo`` reaches lizyml summed into ``purge_gap``.  lizyml 0.15's
  splitter takes the dead zone as ``purge_gap + embargo`` and 0.20 adds a
  deprecated ``embargo`` to ``purge_gap``, so the sum keeps the split while
  dropping the deprecated key.
* A regression config that asks for stratification is refused before a job
  starts.  lizyml 0.15 fails such a fit with a bare sklearn ``ValueError``
  and 0.20 with ``CONFIG_INVALID`` at fit time; neither is a clear message.
* ``cross_entropy_lambda`` is not offered as a binary objective (#690).
* A tune whose trials all fail reports ``TUNING_FAILED`` as its own error
  (#691), not as a generic backend error.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.exceptions import SearchSpaceRefusedError, TuningFailedError
from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.lizyml.space_wire import to_wire_config
from lizystudio.backends.lizyml_ui_schema import build_ui_schema

pytestmark = pytest.mark.unit


class TestEmbargoIntoPurgeGap:
    def _split(self, **fields: Any) -> dict[str, Any]:
        return {
            "task": "regression",
            "split": {"method": "purged_time_series", **fields},
        }

    def test_embargo_is_added_to_purge_gap(self) -> None:
        out = to_wire_config(self._split(n_splits=4, purge_gap=2, embargo=3))
        assert out["split"] == {
            "method": "purged_time_series",
            "n_splits": 4,
            "purge_gap": 5,
        }

    def test_embargo_alone_becomes_purge_gap(self) -> None:
        out = to_wire_config(self._split(embargo=4))
        assert out["split"] == {"method": "purged_time_series", "purge_gap": 4}

    def test_zero_embargo_is_dropped(self) -> None:
        out = to_wire_config(self._split(purge_gap=2, embargo=0))
        assert out["split"] == {"method": "purged_time_series", "purge_gap": 2}

    @pytest.mark.parametrize(
        "fields",
        [
            # lizyml refuses the first five; the sum must not turn them into
            # a valid-looking config (DC1).
            {"purge_gap": 2, "embargo": None},
            {"purge_gap": 2, "embargo": -1},
            {"purge_gap": -3, "embargo": 5},
            {"purge_gap": 2, "embargo": 3, "gap": 1},
            {"purge_gap": 2, "embargo": 3, "embargo_pct": 0.1},
            # Valid: lizyml renames purge_window to purge_gap. Rewriting would
            # leave it beside a new purge_gap, which both versions refuse.
            {"purge_window": 2, "embargo": 3},
        ],
    )
    def test_configs_outside_the_plain_form_are_left_as_they_are(
        self, fields: dict[str, Any]
    ) -> None:
        config = self._split(**fields)
        assert to_wire_config(config) is config

    def test_config_without_embargo_is_unchanged(self) -> None:
        config = self._split(purge_gap=2)
        assert to_wire_config(config) is config

    def test_non_integer_embargo_is_left_for_lizyml_to_reject(self) -> None:
        # Summing would hide a malformed value; lizyml's schema reports it.
        config = self._split(purge_gap=2, embargo=True)
        assert to_wire_config(config)["split"]["embargo"] is True

    def test_input_is_not_mutated(self) -> None:
        config = self._split(purge_gap=2, embargo=3)
        to_wire_config(config)
        assert config["split"] == {
            "method": "purged_time_series",
            "purge_gap": 2,
            "embargo": 3,
        }


def _regression(**overrides: Any) -> dict[str, Any]:
    config: dict[str, Any] = {
        "config_version": 1,
        "task": "regression",
        "data": {"target": "y"},
        "split": {"method": "kfold", "n_splits": 3},
        "model": {"name": "lgbm", "params": {}},
    }
    config.update(overrides)
    return config


def _stratify_errors(config: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        e
        for e in LizyMLAdapter().validate_config(config)
        if e.get("type") == "regression_stratify"
    ]


class TestRegressionStratify:
    @pytest.mark.parametrize("method", ["stratified_kfold", "stratified_group_kfold"])
    def test_stratified_split_method_is_refused(self, method: str) -> None:
        errors = _stratify_errors(
            _regression(split={"method": method, "n_splits": 3, "group_col": "g"})
        )
        assert [e["loc"] for e in errors] == [("split", "method")]
        assert method in errors[0]["msg"]

    def test_groups_stratify_true_is_refused(self) -> None:
        split = {
            "method": "blocked_group_kfold",
            "blocks": {"col": "b"},
            "groups": {"col": "g", "stratify": True},
        }
        errors = _stratify_errors(_regression(split=split))
        assert [e["loc"] for e in errors] == [("split", "groups", "stratify")]

    @pytest.mark.parametrize("value", ["auto", False])
    def test_groups_stratify_auto_or_false_passes(self, value: Any) -> None:
        split = {
            "method": "blocked_group_kfold",
            "blocks": {"col": "b"},
            "groups": {"col": "g", "stratify": value},
        }
        assert _stratify_errors(_regression(split=split)) == []

    def test_inner_valid_stratify_true_is_refused(self) -> None:
        training = {
            "early_stopping": {
                "inner_valid": {"method": "holdout", "ratio": 0.1, "stratify": True}
            }
        }
        errors = _stratify_errors(_regression(training=training))
        assert [e["loc"] for e in errors] == [
            ("training", "early_stopping", "inner_valid", "stratify")
        ]

    def test_explicit_stratify_is_refused_even_with_early_stopping_off(self) -> None:
        # lizyml 0.20 refuses it before looking at enabled
        # (core/_model_factories.py:230-236); the 422 must come first.
        training = {
            "early_stopping": {
                "enabled": False,
                "inner_valid": {"method": "holdout", "stratify": True},
            }
        }
        assert len(_stratify_errors(_regression(training=training))) == 1

    def test_inner_valid_stratify_with_a_true_marker_is_refused(self) -> None:
        training = {
            "early_stopping": {
                "inner_valid": {"method": "holdout", "ratio": 0.1, "stratify": True},
                "validation_ratio": 0.1,
                "inner_valid_explicit": True,
            }
        }
        assert len(_stratify_errors(_regression(training=training))) == 1

    @pytest.mark.parametrize(
        "early_stopping",
        [
            # lizyml 0.15 reads inner_valid beside validation_ratio as not
            # explicit and resolves the inner split itself.
            {
                "inner_valid": {"method": "holdout", "ratio": 0.1, "stratify": True},
                "validation_ratio": 0.1,
            },
            # lizyml 0.20's marker says not explicit: same resolution.
            {
                "inner_valid": {"method": "holdout", "ratio": 0.1, "stratify": True},
                "inner_valid_explicit": False,
            },
        ],
    )
    def test_dormant_inner_valid_stratify_passes(
        self, early_stopping: dict[str, Any]
    ) -> None:
        training = {"early_stopping": early_stopping}
        assert _stratify_errors(_regression(training=training)) == []

    def test_all_three_are_reported_together(self) -> None:
        training = {
            "early_stopping": {"inner_valid": {"method": "holdout", "stratify": True}}
        }
        errors = _stratify_errors(
            _regression(
                split={"method": "stratified_kfold", "n_splits": 3}, training=training
            )
        )
        assert len(errors) == 2

    def test_plain_regression_passes(self) -> None:
        assert _stratify_errors(_regression()) == []

    @pytest.mark.parametrize("task", ["binary", "multiclass"])
    def test_classification_may_stratify(self, task: str) -> None:
        training = {
            "early_stopping": {"inner_valid": {"method": "holdout", "stratify": True}}
        }
        config = _regression(
            task=task,
            split={"method": "stratified_kfold", "n_splits": 3},
            training=training,
        )
        assert _stratify_errors(config) == []

    @pytest.mark.parametrize(
        "split",
        [
            None,
            "not-a-dict",
            {"method": 3},
            {"method": "blocked_group_kfold", "groups": "x"},
        ],
    )
    def test_malformed_sections_do_not_crash(self, split: Any) -> None:
        assert _stratify_errors(_regression(split=split)) == []


class TestCrossEntropyLambda:
    def test_not_offered_as_a_binary_objective(self) -> None:
        objectives = build_ui_schema()["option_sets"]["objective"]["binary"]
        assert "cross_entropy_lambda" not in objectives
        assert "binary" in objectives

    def test_still_offered_as_a_metric(self) -> None:
        metric = build_ui_schema()["option_sets"]["metric"]["binary"]
        assert "cross_entropy_lambda" in metric.get("native", []) + metric.get(
            "feval", []
        )

    def test_saved_binary_config_with_it_is_refused(self) -> None:
        config = _regression(
            task="binary",
            model={"name": "lgbm", "params": {"objective": "cross_entropy_lambda"}},
        )
        types = [e.get("type") for e in LizyMLAdapter().validate_config(config)]
        assert "task_objective_mismatch" in types


def _lizyml_error(code: str, message: str, context: dict[str, Any]) -> Exception:
    from lizyml.core.exceptions import ErrorCode, LizyMLError

    return LizyMLError(code=ErrorCode(code), user_message=message, context=context)


class TestTuningFailed:
    def _tune_raising(self, exc: Exception) -> BaseException:
        adapter = LizyMLAdapter()
        model = MagicMock()
        model.tune.side_effect = exc
        with pytest.raises(Exception) as excinfo:
            adapter.tune(model)
        return excinfo.value

    def test_tuning_failed_becomes_its_own_error(self) -> None:
        raised = self._tune_raising(
            _lizyml_error(
                "TUNING_FAILED",
                "All tuning trials failed. Check parameter ranges.",
                {"n_trials": 5, "first_error": "LightGBMError: max_bin must be > 1"},
            )
        )
        assert isinstance(raised, TuningFailedError)
        assert "All tuning trials failed" in str(raised)
        # lizyml 0.19+ carries the first trial error; 0.15 does not.
        assert "LightGBMError: max_bin must be > 1" in str(raised)

    def test_tuning_failed_without_first_error(self) -> None:
        raised = self._tune_raising(
            _lizyml_error("TUNING_FAILED", "All tuning trials failed.", {"n_trials": 5})
        )
        assert isinstance(raised, TuningFailedError)
        assert str(raised) == "All tuning trials failed."

    def test_other_lizyml_errors_pass_through(self) -> None:
        original = _lizyml_error("CONFIG_INVALID", "bad space", {})
        assert self._tune_raising(original) is original

    def test_job_reports_the_tuning_failed_code(self) -> None:
        from lizystudio.services._training_core import _apply_job_outcome

        job = MagicMock(job_id="job_x", status="queued", error=None)
        store = MagicMock()
        broadcaster = MagicMock()

        def execute(_cb: Any) -> Any:
            raise TuningFailedError("All tuning trials failed. Check parameter ranges.")

        _apply_job_outcome(job, store, broadcaster, execute_fn=execute, cb=MagicMock())

        message = "TuningFailedError: All tuning trials failed. Check parameter ranges."
        assert job.status == "failed"
        assert job.error.splitlines()[0] == message
        broadcaster.send_error.assert_called_once_with(
            "job_x", message, code="TUNING_FAILED"
        )


_SPACE = "tuning.optuna.space"
_REFUSED = "LizyML refused the search space"


class TestSearchSpaceRefused:
    """lizyml's pre-trial space refusals keep their own error (P-0116 D1).

    The context shapes are the ones lizyml 0.20 raises from ``model.tune()``
    (measured by running each against the adapter), including the
    ``unknown`` list for a model dim lizyml does not know.  Studio copies
    none of lizyml's rules; it only names the dims lizyml named.
    """

    def _tune_raising(self, exc: Exception) -> BaseException:
        adapter = LizyMLAdapter()
        model = MagicMock()
        model.tune.side_effect = exc
        with pytest.raises(Exception) as excinfo:
            adapter.tune(model)
        return excinfo.value

    @pytest.mark.parametrize(
        ("context", "dims"),
        [
            pytest.param(
                {
                    "conflicts": [
                        {
                            "surface": _SPACE,
                            "parameter": "learning_rate",
                            "dimensions": ["eta", "learning_rate"],
                        }
                    ]
                },
                ("eta", "learning_rate"),
                id="alias",
            ),
            pytest.param(
                {
                    "conflicts": [
                        {
                            "surface": _SPACE,
                            "name": "seed",
                            "config_path": "training.seed",
                        }
                    ]
                },
                ("seed",),
                id="training-owned-model-dim",
            ),
            pytest.param(
                {
                    "managed": [
                        {
                            "surface": _SPACE,
                            "name": "num_leaves",
                            "canonical": "num_leaves",
                            "smart_param": "auto_num_leaves",
                        }
                    ]
                },
                ("num_leaves",),
                id="smart-managed",
            ),
            pytest.param(
                {"unknown": [{"surface": _SPACE, "name": "not_a_param"}]},
                ("not_a_param",),
                id="unknown-model-dim",
            ),
            pytest.param(
                {"refused": [{"surface": _SPACE, "parameter": "max_bin"}]},
                ("max_bin",),
                id="any-list-key-parameter-only",
            ),
            pytest.param(
                # lizyml 0.20 _smart_combinations: a fixed model.params name a
                # smart dim of the space manages in some trials.  The entry's
                # surface is model.params; the space is in space_surface.
                {
                    "managed": [
                        {
                            "surface": "model.params",
                            "name": "max_leaves",
                            "canonical": "num_leaves",
                            "smart_param": "auto_num_leaves",
                            "smart_dimensions": ["auto_num_leaves"],
                            "space_surface": _SPACE,
                        }
                    ],
                    "space_surface": _SPACE,
                    "smart_values": {"auto_num_leaves": True},
                },
                ("auto_num_leaves",),
                id="smart-dimension-collision",
            ),
            pytest.param(
                {
                    "task": "binary",
                    "objective": "regression",
                    "surface": _SPACE,
                    "dim": "objective",
                    "key": "choices",
                    "value": "regression",
                },
                ("objective",),
                id="objective",
            ),
            pytest.param(
                {
                    "surface": _SPACE,
                    "reason": "bound_off_grid",
                    "dim": "max_bin",
                    "key": "low",
                    "grid_low": 64,
                    "grid_high": 192,
                },
                ("max_bin",),
                id="off-grid",
            ),
            pytest.param(
                {"surface": _SPACE, "names": ["foo", "bar"], "category": "smart"},
                ("foo", "bar"),
                id="names-list",
            ),
            pytest.param(
                {"surface": "tune(space=)", "dim": "early_stopping_rounds"},
                ("early_stopping.rounds",),
                id="later-round-space-and-wire-name",
            ),
        ],
    )
    def test_space_refusal_names_the_dims(
        self, context: dict[str, Any], dims: tuple[str, ...]
    ) -> None:
        raised = self._tune_raising(
            _lizyml_error("CONFIG_INVALID", "lizyml says why.", context)
        )
        assert isinstance(raised, SearchSpaceRefusedError)
        assert raised.dims == dims
        assert str(raised) == f"{_REFUSED} ({', '.join(dims)}): lizyml says why."

    def test_refusal_without_a_dim_falls_back_to_the_message(self) -> None:
        raised = self._tune_raising(
            _lizyml_error(
                "CONFIG_INVALID", "bad space.", {"surface": _SPACE, "reason": "x"}
            )
        )
        assert isinstance(raised, SearchSpaceRefusedError)
        assert raised.dims == ()
        assert str(raised) == f"{_REFUSED}: bad space."

    def test_dims_come_only_from_space_entries(self) -> None:
        context = {
            "conflicts": [
                {"surface": "model.params", "name": "seed"},
                {"surface": _SPACE, "name": "bagging_seed"},
            ]
        }
        raised = self._tune_raising(_lizyml_error("CONFIG_INVALID", "m", context))
        assert isinstance(raised, SearchSpaceRefusedError)
        assert raised.dims == ("bagging_seed",)

    @pytest.mark.parametrize(
        "context",
        [
            pytest.param({}, id="empty"),
            pytest.param(
                {"validation_errors": [{"loc": ["tuning", "optuna", "space"]}]},
                id="pydantic",
            ),
            # Exact surface match: these surfaces only start like the space.
            pytest.param({"surface": "tuning.optuna.space_mode"}, id="space_mode"),
            pytest.param({"surface": "tuning.optuna.params.direction"}, id="direction"),
            pytest.param({"surface": "tuning.study"}, id="study"),
            pytest.param(
                {"conflicts": [{"surface": "model.params", "name": "seed"}]},
                id="model-params-conflict",
            ),
            pytest.param({"conflicts": "not-a-list"}, id="malformed"),
        ],
    )
    def test_non_space_config_invalid_passes_through(
        self, context: dict[str, Any]
    ) -> None:
        original = _lizyml_error("CONFIG_INVALID", "not the space", context)
        assert self._tune_raising(original) is original

    def test_other_codes_with_a_space_surface_pass_through(self) -> None:
        original = _lizyml_error(
            "DATA_SCHEMA_INVALID", "m", {"surface": _SPACE, "dim": "x"}
        )
        assert self._tune_raising(original) is original

    def test_job_reports_the_space_refused_code(self) -> None:
        from lizystudio.services._training_core import _apply_job_outcome

        job = MagicMock(job_id="job_x", status="queued", error=None)
        store = MagicMock()
        broadcaster = MagicMock()
        refusal = f"{_REFUSED} (max_bin): off grid."

        def execute(_cb: Any) -> Any:
            raise SearchSpaceRefusedError(refusal, dims=("max_bin",))

        _apply_job_outcome(job, store, broadcaster, execute_fn=execute, cb=MagicMock())

        message = f"SearchSpaceRefusedError: {refusal}"
        assert job.status == "failed"
        assert job.error.splitlines()[0] == message
        broadcaster.send_error.assert_called_once_with(
            "job_x", message, code="SEARCH_SPACE_REFUSED"
        )
