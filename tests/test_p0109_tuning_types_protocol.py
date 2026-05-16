"""Tests for P-0109 PR-2: ``TuningDefaults`` / ``TuningOverrides`` /
``TuningConfig`` common types and the safe-default Protocol methods
``BackendCore.get_tuning_defaults`` and
``BackendCore.compute_effective_tuning``.

PR-2 is the contract-only step in the P-0109 chain: no concrete adapter
implementation, no service / API rewiring, no frontend changes. The
safe-default bodies in ``BackendCore`` give a future 2nd backend a
zero-effort starting point — these tests pin that contract so the
forward-compatibility guarantee does not regress silently.

See HISTORY P-0109 (Decision section) for the chain shape and how
PR-3 / PR-4 / PR-5 build on the surface fixed here.
"""

from __future__ import annotations

import dataclasses
from typing import Any

import pytest
from pydantic import ValidationError

from lizystudio.backends.base import BackendCore
from lizystudio.backends.types import (
    TuningConfig,
    TuningDefaults,
    TuningOverrides,
)

_FROZEN_DC_ERROR = dataclasses.FrozenInstanceError

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Type-level contract: TuningDefaults
# ---------------------------------------------------------------------------


class TestTuningDefaults:
    def test_empty_construction_for_backend_without_catalog(self) -> None:
        """A backend with no Optuna catalog returns empty defaults."""
        d = TuningDefaults()
        assert d.space == {}
        assert d.evaluation_metrics == []
        assert d.direction is None

    def test_full_construction(self) -> None:
        d = TuningDefaults(
            space={"learning_rate": {"type": "float", "low": 0.01, "high": 0.3}},
            evaluation_metrics=["auc", "auc_pr"],
            direction="maximize",
        )
        assert d.direction == "maximize"
        assert "learning_rate" in d.space
        assert d.evaluation_metrics == ["auc", "auc_pr"]

    def test_is_frozen(self) -> None:
        """``frozen=True`` so a workspace can hold a defensive snapshot."""
        d = TuningDefaults()
        with pytest.raises(_FROZEN_DC_ERROR):
            d.direction = "maximize"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Type-level contract: TuningOverrides — the sparse intent persisted in
# the workspace. The key invariant is "explicit None is not the same as
# unset" (P-0109 INV-T1, Q4 resolution).
# ---------------------------------------------------------------------------


class TestTuningOverrides:
    def test_default_construction_is_empty_intent(self) -> None:
        """A workspace never customised has every field unset."""
        o = TuningOverrides()
        assert o.n_trials is None
        assert o.timeout is None
        assert o.direction is None
        assert o.space == {}
        assert o.evaluation_metrics is None
        assert o.model_fields_set == set()

    def test_partial_override(self) -> None:
        o = TuningOverrides(n_trials=100)
        assert o.n_trials == 100
        assert o.model_fields_set == {"n_trials"}

    def test_explicit_timeout_none_is_user_set_intent(self) -> None:
        """User picking 'no timeout' is distinguishable from 'not touched'.

        Both ``TuningOverrides()`` and ``TuningOverrides(timeout=None)``
        carry ``.timeout is None``, but Pydantic's ``model_fields_set``
        reveals which one represents an explicit user choice — the
        signal the merge logic uses to fall through to catalog defaults
        only when the user hasn't expressed an opinion.
        """
        o_default = TuningOverrides()
        o_explicit = TuningOverrides(timeout=None)
        assert o_default.timeout is None
        assert o_explicit.timeout is None
        assert "timeout" not in o_default.model_fields_set
        assert "timeout" in o_explicit.model_fields_set

    def test_extra_field_is_rejected(self) -> None:
        """``extra='forbid'`` catches typos and stale field names."""
        with pytest.raises(ValidationError):
            TuningOverrides(unknown_field=42)  # type: ignore[call-arg]

    def test_is_frozen(self) -> None:
        o = TuningOverrides(n_trials=100)
        with pytest.raises(ValidationError):
            o.n_trials = 200  # type: ignore[misc]

    def test_space_override_is_per_key(self) -> None:
        o = TuningOverrides(
            space={
                "learning_rate": {"type": "float", "low": 0.001, "high": 0.5},
            },
        )
        assert o.space == {
            "learning_rate": {"type": "float", "low": 0.001, "high": 0.5},
        }
        assert "space" in o.model_fields_set

    def test_validates_from_dict_payload(self) -> None:
        """``model_validate`` (PUT /config path) preserves ``fields_set``."""
        o = TuningOverrides.model_validate({"n_trials": 100, "timeout": None})
        assert o.n_trials == 100
        assert o.timeout is None
        assert o.model_fields_set == {"n_trials", "timeout"}


# ---------------------------------------------------------------------------
# Type-level contract: TuningConfig — the effective state, always complete.
# ---------------------------------------------------------------------------


class TestTuningConfig:
    def test_requires_all_required_fields(self) -> None:
        """Effective state must be complete — partial construction fails."""
        with pytest.raises(ValidationError):
            TuningConfig()  # type: ignore[call-arg]

    def test_full_construction(self) -> None:
        c = TuningConfig(
            n_trials=100,
            timeout=300,
            direction="maximize",
            space={"lr": {"type": "float", "low": 0.01, "high": 0.1}},
            evaluation_metrics=["auc"],
            user_set_paths=["n_trials", "space.lr"],
        )
        assert c.n_trials == 100
        assert c.direction == "maximize"
        assert c.user_set_paths == ["n_trials", "space.lr"]

    def test_default_user_set_paths_is_empty(self) -> None:
        """``user_set_paths`` defaults to empty for effectives without intent."""
        c = TuningConfig(
            n_trials=50,
            timeout=None,
            direction="minimize",
            space={},
            evaluation_metrics=[],
        )
        assert c.user_set_paths == []

    def test_is_frozen(self) -> None:
        c = TuningConfig(
            n_trials=50,
            timeout=None,
            direction="minimize",
            space={},
            evaluation_metrics=[],
        )
        with pytest.raises(ValidationError):
            c.n_trials = 100  # type: ignore[misc]


# ---------------------------------------------------------------------------
# BackendCore.get_tuning_defaults safe default — minimal backend gets
# empty defaults for free (forward compat for 2nd adapter).
# ---------------------------------------------------------------------------


class _MinimalBackend(BackendCore):
    """Stub backend exercising only the inherited safe-default methods.

    Real adapters (e.g. ``LizyMLAdapter``) do **not** inherit from
    ``BackendCore``; they satisfy it via duck typing. Here we
    deliberately inherit so the Protocol's safe-default method bodies
    actually run — that is the contract PR-2 fixes for forward compat.
    """


class TestSafeDefaultGetTuningDefaults:
    def test_returns_empty_for_any_task(self) -> None:
        backend = _MinimalBackend()
        assert backend.get_tuning_defaults("binary") == TuningDefaults()
        assert backend.get_tuning_defaults("regression") == TuningDefaults()
        assert backend.get_tuning_defaults("multiclass") == TuningDefaults()
        assert backend.get_tuning_defaults("") == TuningDefaults()


# ---------------------------------------------------------------------------
# BackendCore.compute_effective_tuning safe default — merge semantics
# (P-0109 INV-T1/T2: catalog evolution propagates, user intent preserved).
# ---------------------------------------------------------------------------


class TestSafeDefaultComputeEffectiveTuning:
    def test_empty_overrides_and_no_catalog_yields_minimal_defaults(self) -> None:
        backend = _MinimalBackend()
        eff = backend.compute_effective_tuning("binary", TuningOverrides())
        assert eff.n_trials == 50
        assert eff.timeout is None
        assert eff.direction == "minimize"
        assert eff.space == {}
        assert eff.evaluation_metrics == []
        assert eff.user_set_paths == []

    def test_partial_override_only_marks_set_fields(self) -> None:
        """``user_set_paths`` reflects the actual sparse intent."""
        backend = _MinimalBackend()
        eff = backend.compute_effective_tuning("binary", TuningOverrides(n_trials=10))
        assert eff.n_trials == 10
        assert eff.direction == "minimize"  # fall-through default
        assert eff.user_set_paths == ["n_trials"]

    def test_explicit_timeout_none_is_tracked_in_user_set_paths(self) -> None:
        """Explicit no-timeout intent does NOT silently fall through to default."""
        backend = _MinimalBackend()
        eff = backend.compute_effective_tuning("binary", TuningOverrides(timeout=None))
        assert eff.timeout is None
        assert "timeout" in eff.user_set_paths

    def test_full_overrides_are_carried_into_effective(self) -> None:
        backend = _MinimalBackend()
        o = TuningOverrides(
            n_trials=200,
            timeout=600,
            direction="maximize",
            space={"learning_rate": {"type": "float", "low": 0.005, "high": 0.2}},
            evaluation_metrics=["auc", "auc_pr"],
        )
        eff = backend.compute_effective_tuning("regression", o)
        assert eff.n_trials == 200
        assert eff.timeout == 600
        assert eff.direction == "maximize"
        assert eff.space == {
            "learning_rate": {"type": "float", "low": 0.005, "high": 0.2},
        }
        assert eff.evaluation_metrics == ["auc", "auc_pr"]
        assert set(eff.user_set_paths) == {
            "n_trials",
            "timeout",
            "direction",
            "evaluation_metrics",
            "space.learning_rate",
        }

    def test_catalog_outside_custom_space_keys_are_preserved(self) -> None:
        """Q4 resolution: catalog-outside user params persist across task changes.

        Here the minimal backend has no catalog at all; the safe-default
        merge must still surface user-added params in ``effective.space``.
        """
        backend = _MinimalBackend()
        o = TuningOverrides(
            space={"custom_param": {"type": "categorical", "choices": ["a", "b"]}},
        )
        eff = backend.compute_effective_tuning("binary", o)
        assert "custom_param" in eff.space
        assert eff.space["custom_param"]["choices"] == ["a", "b"]
        assert "space.custom_param" in eff.user_set_paths


class _BackendWithCatalog(BackendCore):
    """Stub backend that overrides ``get_tuning_defaults`` to exercise the
    inherited-merge code path against a non-empty catalog (INV-T2 test).
    """

    def get_tuning_defaults(self, task: str) -> TuningDefaults:
        return TuningDefaults(
            space={
                "learning_rate": {"type": "float", "low": 0.01, "high": 0.1},
                "num_leaves": {"type": "int", "low": 20, "high": 200},
            },
            evaluation_metrics=["auc"],
            direction="maximize",
        )


class TestComputeEffectiveTuningMergeAgainstCatalog:
    def test_user_override_wins_per_space_key(self) -> None:
        """Override of one catalog key leaves the other catalog key intact."""
        backend = _BackendWithCatalog()
        o = TuningOverrides(
            space={"learning_rate": {"type": "float", "low": 0.001, "high": 0.5}},
        )
        eff = backend.compute_effective_tuning("binary", o)
        assert eff.space == {
            "learning_rate": {"type": "float", "low": 0.001, "high": 0.5},
            "num_leaves": {"type": "int", "low": 20, "high": 200},
        }
        assert "space.learning_rate" in eff.user_set_paths
        assert "space.num_leaves" not in eff.user_set_paths

    def test_empty_overrides_yields_pure_catalog_defaults(self) -> None:
        """INV-T2 happy path: zero intent → effective equals catalog (almost)."""
        backend = _BackendWithCatalog()
        eff = backend.compute_effective_tuning("binary", TuningOverrides())
        assert eff.space == {
            "learning_rate": {"type": "float", "low": 0.01, "high": 0.1},
            "num_leaves": {"type": "int", "low": 20, "high": 200},
        }
        assert eff.direction == "maximize"  # from catalog
        assert eff.evaluation_metrics == ["auc"]  # from catalog
        assert eff.user_set_paths == []

    def test_override_evaluation_metrics_replaces_catalog_list(self) -> None:
        """List-level replacement (not per-element merge)."""
        backend = _BackendWithCatalog()
        o = TuningOverrides(evaluation_metrics=["logloss", "brier"])
        eff = backend.compute_effective_tuning("binary", o)
        assert eff.evaluation_metrics == ["logloss", "brier"]
        assert "evaluation_metrics" in eff.user_set_paths

    def test_override_direction_overrides_catalog_direction(self) -> None:
        backend = _BackendWithCatalog()
        o = TuningOverrides(direction="minimize")
        eff = backend.compute_effective_tuning("binary", o)
        assert eff.direction == "minimize"
        assert "direction" in eff.user_set_paths


# ---------------------------------------------------------------------------
# Pure-function semantics: ``compute_effective_tuning`` is referentially
# transparent (P-0109: same (task, overrides) ⇒ same effective).
# ---------------------------------------------------------------------------


class TestComputeEffectiveTuningIsPure:
    def test_same_inputs_yield_same_output(self) -> None:
        backend = _BackendWithCatalog()
        o = TuningOverrides(n_trials=42, space={"x": {"type": "float"}})
        a = backend.compute_effective_tuning("binary", o)
        b = backend.compute_effective_tuning("binary", o)
        assert a == b

    def test_overrides_not_mutated(self) -> None:
        """The merge must not mutate the user's TuningOverrides snapshot."""
        backend = _BackendWithCatalog()
        original_space: dict[str, dict[str, Any]] = {
            "learning_rate": {"type": "float", "low": 0.001, "high": 0.5}
        }
        o = TuningOverrides(space=original_space)
        _ = backend.compute_effective_tuning("binary", o)
        assert o.space == {
            "learning_rate": {"type": "float", "low": 0.001, "high": 0.5}
        }
