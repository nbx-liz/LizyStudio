"""Contract: UI schema objective list / parameter bounds == LizyML SSOT.

P-0104 Wave 3.1a / Issue #461. The Studio UI schema used to carry a
hardcoded ``option_sets.objective`` list and (before this Wave) no
hyper-parameter bounds at all. Both now come straight from LizyML's
``LGBMProvider`` so the UI always reflects the canonical objective list /
bounds shipped with the installed LizyML version.

This test locks that invariant — if a future LizyML release adds or
removes an objective, or tweaks a parameter bound, CI fails here unless
the Studio schema picks the change up automatically (which it does, by
sourcing from the provider) or a maintainer consciously diverges.
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
    return build_ui_schema(get_eval_metrics_by_task())


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
