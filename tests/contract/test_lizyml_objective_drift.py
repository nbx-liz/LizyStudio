"""Contract: UI schema objective / metric lists / parameter bounds == LizyML SSOT.

P-0104 Wave 3.1a / 3.1b / Issue #461. The Studio UI schema used to carry
hardcoded ``option_sets.objective`` / ``option_sets.model_metric`` lists
and (before Wave 3.1a) no hyper-parameter bounds at all. They now come
straight from LizyML's ``LGBMProvider`` so the UI always reflects the
canonical objective list / model-metric choices / bounds shipped with the
installed LizyML version. The ``option_sets.eval_metric`` block tracks
LizyML's eval-metrics registry instead.

This test locks those invariants — if a future LizyML release adds or
removes an objective / metric, or tweaks a parameter bound, CI fails here
unless the Studio schema picks the change up automatically (which it does,
by sourcing from the provider / registry) or a maintainer consciously
diverges.
"""

from __future__ import annotations

import pytest

from lizystudio.backends.lizyml_ui_schema import (
    _TASKS,
    build_ui_schema,
    get_eval_metrics_by_task,
)

pytestmark = pytest.mark.unit


def _ui_schema() -> dict:
    return build_ui_schema()


def _provider():
    from lizyml.estimators.lgbm.provider import LGBMProvider

    return LGBMProvider()


def test_option_sets_objective_matches_lizyml_canonical() -> None:
    schema = _ui_schema()
    provider = _provider()
    for task in _TASKS:
        assert tuple(schema["option_sets"]["objective"][task]) == tuple(
            provider.objective_choices(task)
        ), f"objective drift for task={task!r}"


def test_option_sets_metric_matches_lizyml_provider() -> None:
    """``option_sets.metric[task]`` is the nested ``{native, feval}`` shape
    sourced straight from ``LGBMProvider.metric_choices(task)`` (Wave 3.1b)."""
    schema = _ui_schema()
    provider = _provider()
    for task in _TASKS:
        choices = provider.metric_choices(task)
        actual = schema["option_sets"]["metric"][task]
        assert set(actual.keys()) == {"native", "feval"}, (
            f"metric option set for task={task!r} must have native/feval sections"
        )
        assert tuple(actual["native"]) == tuple(choices["native"]), (
            f"native metric drift for task={task!r}"
        )
        assert tuple(actual["feval"]) == tuple(choices["feval"]), (
            f"feval metric drift for task={task!r}"
        )


def test_option_sets_has_no_model_metric() -> None:
    """``option_sets.model_metric`` was removed in Wave 3.1b (Q3)."""
    schema = _ui_schema()
    assert "model_metric" not in schema["option_sets"]


def test_option_sets_eval_metric_matches_registry() -> None:
    """``option_sets.eval_metric[task]`` mirrors LizyML's eval-metrics registry."""
    schema = _ui_schema()
    registry = get_eval_metrics_by_task()
    for task in _TASKS:
        assert list(schema["option_sets"]["eval_metric"][task]) == list(
            registry[task]
        ), f"eval_metric drift for task={task!r}"


def test_parameter_bounds_match_lizyml_provider() -> None:
    schema = _ui_schema()
    provider = _provider()
    assert set(schema["parameter_bounds"].keys()) == set(_TASKS)
    for task in _TASKS:
        assert schema["parameter_bounds"][task] == dict(
            provider.parameter_bounds(task)
        ), f"parameter_bounds drift for task={task!r}"


def test_parameter_hint_objective_defaults_are_valid_choices() -> None:
    """Each ``parameter_hints.objective.default[task]`` is in the canonical list."""
    schema = _ui_schema()
    provider = _provider()
    hint = next(h for h in schema["parameter_hints"] if h["key"] == "objective")
    for task in _TASKS:
        default = hint["default"][task]
        assert default in provider.objective_choices(task), (
            f"objective hint default {default!r} not a valid {task} objective"
        )


def test_parameter_hint_metric_defaults_are_valid_choices() -> None:
    """Each ``parameter_hints.metric.default[task]`` entry is a valid model metric."""
    schema = _ui_schema()
    provider = _provider()
    hint = next(h for h in schema["parameter_hints"] if h["key"] == "metric")
    assert hint["kind"] == "metric"
    for task in _TASKS:
        choices = provider.metric_choices(task)
        valid = set(choices["native"]) | set(choices["feval"])
        for default in hint["default"][task]:
            assert default in valid, (
                f"metric hint default {default!r} not a valid {task} metric"
            )


def test_search_space_catalog_objective_defaults_are_valid_choices() -> None:
    """``search_space_catalog`` objective entry default must be a valid choice."""
    schema = _ui_schema()
    provider = _provider()
    entry = next(e for e in schema["search_space_catalog"] if e["key"] == "objective")
    for task in _TASKS:
        default = entry["default"][task]
        assert default in provider.objective_choices(task), (
            f"objective catalog default {default!r} not a valid {task} objective"
        )


def test_search_space_catalog_metric_defaults_are_valid_choices() -> None:
    """``search_space_catalog`` metric entry default must be a valid model metric."""
    schema = _ui_schema()
    provider = _provider()
    entry = next(e for e in schema["search_space_catalog"] if e["key"] == "metric")
    for task in _TASKS:
        choices = provider.metric_choices(task)
        valid = set(choices["native"]) | set(choices["feval"])
        default = entry["default"][task]
        assert default in valid, (
            f"metric catalog default {default!r} not a valid {task} metric"
        )


def test_special_search_space_fields_use_canonical_picker_tags() -> None:
    """``special_search_space_fields.metric`` was renamed model_metric->metric."""
    schema = _ui_schema()
    ssf = schema["special_search_space_fields"]
    assert ssf["objective"] == "objective"
    assert ssf["metric"] == "metric"
    assert ssf["inner_valid"] == "inner_valid_picker"
