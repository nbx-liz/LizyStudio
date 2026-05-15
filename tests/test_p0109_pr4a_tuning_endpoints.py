"""Tests for P-0109 PR-4a — Tune intent/effective endpoints + helpers.

PR-4a is the additive API layer for the P-0109 intent/effective split.
The workspace storage shape is unchanged (still legacy nested
``config["tuning"]``); the new endpoints project that shape onto the
:class:`TuningOverrides` / :class:`TuningConfig` types so the frontend
(PR-5) can render the Tune tab without the racing seed-then-edit
useEffects. PR-4b will move storage to persist sparse overrides
directly; until then, the helpers under test here keep the two
representations in sync.

See HISTORY P-0109 (Decision) for the chain shape.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import TuningOverrides
from lizystudio.services.workspace import (
    extract_overrides_from_legacy_tuning,
    materialize_overrides_into_legacy_tuning,
)

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers (mirrored from test_workspace_api.py — kept local so this file
# stays self-contained for the PR-4a test slice).
# ---------------------------------------------------------------------------


def _create_csv(tmp_path: Path, name: str = "train.csv") -> str:
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, i % 2])
    return str(csv_path)


def _load_default_binary_config(client: TestClient) -> dict[str, Any]:
    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200, res.text
    return res.json()


def _load_data_and_binary_config(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200, r.text
    config = _load_default_binary_config(client)
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200, r.text
    assert r.json()["saved"] is True


# ---------------------------------------------------------------------------
# Service helpers — extract_overrides_from_legacy_tuning
# ---------------------------------------------------------------------------


class TestExtractOverridesFromLegacyTuning:
    """Project the legacy nested ``config["tuning"]`` onto TuningOverrides."""

    def test_none_input_yields_empty_overrides(self) -> None:
        o = extract_overrides_from_legacy_tuning(None)
        assert isinstance(o, TuningOverrides)
        assert o.model_fields_set == set()

    def test_empty_dict_yields_empty_overrides(self) -> None:
        o = extract_overrides_from_legacy_tuning({})
        assert isinstance(o, TuningOverrides)
        assert o.model_fields_set == set()

    def test_optuna_params_are_extracted(self) -> None:
        o = extract_overrides_from_legacy_tuning(
            {
                "optuna": {
                    "params": {
                        "n_trials": 100,
                        "timeout": 600,
                        "direction": "maximize",
                    },
                    "space": {},
                }
            }
        )
        assert o.n_trials == 100
        assert o.timeout == 600
        assert o.direction == "maximize"
        assert o.model_fields_set == {"n_trials", "timeout", "direction"}

    def test_optuna_space_is_extracted(self) -> None:
        o = extract_overrides_from_legacy_tuning(
            {
                "optuna": {
                    "params": {},
                    "space": {
                        "learning_rate": {
                            "type": "float",
                            "low": 0.001,
                            "high": 0.5,
                        }
                    },
                }
            }
        )
        assert "learning_rate" in o.space
        assert "space" in o.model_fields_set

    def test_evaluation_metrics_are_extracted(self) -> None:
        o = extract_overrides_from_legacy_tuning(
            {
                "optuna": {"params": {}, "space": {}},
                "evaluation": {"metrics": ["logloss", "brier"]},
            }
        )
        assert o.evaluation_metrics == ["logloss", "brier"]
        assert "evaluation_metrics" in o.model_fields_set

    def test_explicit_none_timeout_preserves_user_intent(self) -> None:
        """INV-T1 (P-0109 Q4): explicit ``None`` ≠ unset."""
        o = extract_overrides_from_legacy_tuning(
            {"optuna": {"params": {"timeout": None}, "space": {}}}
        )
        assert o.timeout is None
        assert "timeout" in o.model_fields_set

    def test_malformed_input_falls_back_to_empty(self) -> None:
        """Invalid scalar types (e.g. n_trials="50") fall back to empty."""
        o = extract_overrides_from_legacy_tuning(
            {"optuna": {"params": {"n_trials": "fifty"}, "space": {}}}
        )
        assert o.model_fields_set == set()

    def test_non_dict_value_is_ignored(self) -> None:
        o = extract_overrides_from_legacy_tuning("not a dict")
        assert o.model_fields_set == set()


# ---------------------------------------------------------------------------
# Service helpers — materialize_overrides_into_legacy_tuning
# ---------------------------------------------------------------------------


class TestMaterializeOverridesIntoLegacyTuning:
    """Convert TuningConfig → legacy nested ``tuning`` block."""

    def _make_effective(
        self,
        *,
        n_trials: int = 50,
        timeout: int | None = None,
        direction: str = "maximize",
        space: dict[str, dict[str, Any]] | None = None,
        evaluation_metrics: list[Any] | None = None,
    ) -> Any:
        from lizystudio.backends.types import TuningConfig

        return TuningConfig(
            n_trials=n_trials,
            timeout=timeout,
            direction=direction,  # type: ignore[arg-type]
            space=space if space is not None else {},
            evaluation_metrics=(
                evaluation_metrics if evaluation_metrics is not None else []
            ),
        )

    def test_minimum_effective_materializes_optuna_block(self) -> None:
        out = materialize_overrides_into_legacy_tuning(self._make_effective())
        assert out["optuna"]["params"]["n_trials"] == 50
        assert out["optuna"]["params"]["timeout"] is None
        assert out["optuna"]["params"]["direction"] == "maximize"
        assert out["optuna"]["space"] == {}
        # No evaluation block for empty metric list (caller can decide).
        # Empty input → empty output preserves PUT semantics.

    def test_space_is_materialized(self) -> None:
        out = materialize_overrides_into_legacy_tuning(
            self._make_effective(
                space={"lr": {"type": "float", "low": 0.01, "high": 0.3}}
            )
        )
        assert out["optuna"]["space"] == {
            "lr": {"type": "float", "low": 0.01, "high": 0.3}
        }

    def test_evaluation_metrics_are_materialized(self) -> None:
        out = materialize_overrides_into_legacy_tuning(
            self._make_effective(evaluation_metrics=["auc", "logloss"])
        )
        assert out["evaluation"] == {"metrics": ["auc", "logloss"]}

    def test_model_params_and_training_are_preserved(self) -> None:
        """LizyML-specific non-Optuna overrides survive the materialization."""
        current = {
            "optuna": {"params": {"n_trials": 1, "study_name": "old"}, "space": {}},
            "model_params": {"learning_rate": 0.05},
            "training": {"seed": 123},
        }
        out = materialize_overrides_into_legacy_tuning(
            self._make_effective(n_trials=100), current_tuning=current
        )
        assert out["model_params"] == {"learning_rate": 0.05}
        assert out["training"] == {"seed": 123}
        # Existing extra optuna.params keys are preserved alongside the
        # canonical ones — n_trials gets overwritten, study_name survives.
        assert out["optuna"]["params"]["study_name"] == "old"
        assert out["optuna"]["params"]["n_trials"] == 100

    def test_returns_independent_copy(self) -> None:
        """Caller-side mutation must not leak back into the effective config."""
        current = {"optuna": {"params": {}, "space": {}}, "model_params": {"x": 1}}
        out = materialize_overrides_into_legacy_tuning(
            self._make_effective(), current_tuning=current
        )
        out["model_params"]["x"] = 999
        assert current["model_params"] == {"x": 1}


# ---------------------------------------------------------------------------
# GET /api/workspace/config/tuning-snapshot
# ---------------------------------------------------------------------------


class TestTuningSnapshotEndpoint:
    """``GET /config/tuning-snapshot`` projects current workspace state."""

    def test_empty_workspace_returns_empty_defaults(self, client: TestClient) -> None:
        """Fresh workspace (no config) → empty defaults, empty effective."""
        res = client.get("/api/workspace/config/tuning-snapshot")
        assert res.status_code == 200, res.text
        body = res.json()
        assert "tuning_effective" in body
        assert "tuning_defaults" in body
        # No task set → empty TuningDefaults from the adapter.
        assert body["tuning_defaults"]["space"] == {}
        assert body["tuning_defaults"]["evaluation_metrics"] == []
        # Effective falls back to the empty-overrides safe default.
        assert body["tuning_effective"]["n_trials"] == 50

    def test_binary_config_returns_catalog_defaults(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """Binary task → catalog space + canonical metrics + maximize direction."""
        _load_data_and_binary_config(client, tmp_path)
        res = client.get("/api/workspace/config/tuning-snapshot")
        assert res.status_code == 200, res.text
        body = res.json()
        # Defaults carry the catalog space + canonical binary metric list.
        assert "learning_rate" in body["tuning_defaults"]["space"]
        assert body["tuning_defaults"]["evaluation_metrics"] == [
            "auc",
            "auc_pr",
            "brier",
            "logloss",
        ]
        assert body["tuning_defaults"]["direction"] == "maximize"
        # Effective for a fresh binary config (no explicit tune intent
        # persisted yet) matches the catalog defaults too.
        assert body["tuning_effective"]["direction"] == "maximize"
        assert body["tuning_effective"]["evaluation_metrics"] == [
            "auc",
            "auc_pr",
            "brier",
            "logloss",
        ]

    def test_after_legacy_put_config_effective_reflects_persisted_tuning(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """Legacy PUT /config that sets ``tuning`` is honoured by the snapshot."""
        _load_data_and_binary_config(client, tmp_path)
        # Manually craft a legacy ``tuning`` block via PUT /config.
        config = _load_default_binary_config(client)
        config["tuning"] = {
            "optuna": {
                "params": {
                    "n_trials": 200,
                    "timeout": None,
                    "direction": "maximize",
                },
                "space": {
                    "learning_rate": {
                        "type": "float",
                        "low": 0.1,
                        "high": 0.5,
                        "log": False,
                    }
                },
            }
        }
        r = client.put("/api/workspace/config", json=config)
        assert r.status_code == 200, r.text
        assert r.json()["saved"] is True

        res = client.get("/api/workspace/config/tuning-snapshot")
        assert res.status_code == 200, res.text
        eff = res.json()["tuning_effective"]
        assert eff["n_trials"] == 200
        # The user's override wins per-key over the catalog default.
        assert eff["space"]["learning_rate"]["low"] == 0.1
        assert eff["space"]["learning_rate"]["high"] == 0.5
        # Catalog-only keys (the user didn't touch them) survive intact.
        assert "max_depth" in eff["space"]


# ---------------------------------------------------------------------------
# PUT /api/workspace/config/tuning-overrides
# ---------------------------------------------------------------------------


class TestTuningOverridesUpdateEndpoint:
    """``PUT /config/tuning-overrides`` accepts sparse intent → echoes effective."""

    def test_partial_override_returns_updated_effective(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        res = client.put(
            "/api/workspace/config/tuning-overrides",
            json={"n_trials": 250},
        )
        assert res.status_code == 200, res.text
        eff = res.json()["tuning_effective"]
        assert eff["n_trials"] == 250
        # Catalog defaults still fill the rest.
        assert eff["direction"] == "maximize"
        assert "learning_rate" in eff["space"]

    def test_put_then_get_round_trip(self, client: TestClient, tmp_path: Path) -> None:
        _load_data_and_binary_config(client, tmp_path)
        # Apply an override.
        r = client.put(
            "/api/workspace/config/tuning-overrides",
            json={
                "n_trials": 333,
                "space": {
                    "learning_rate": {
                        "type": "float",
                        "low": 0.5,
                        "high": 1.0,
                        "log": False,
                    }
                },
            },
        )
        assert r.status_code == 200, r.text
        # GET-snapshot now reflects the persisted override.
        snap = client.get("/api/workspace/config/tuning-snapshot")
        assert snap.status_code == 200, snap.text
        eff = snap.json()["tuning_effective"]
        assert eff["n_trials"] == 333
        assert eff["space"]["learning_rate"]["low"] == 0.5
        # Verify the legacy PUT /config path also reflects the override
        # (the materialization wrote into ``ws.config["tuning"]``).
        cfg = client.get("/api/workspace/config")
        assert cfg.status_code == 200, cfg.text
        legacy = cfg.json().get("tuning", {})
        assert legacy["optuna"]["params"]["n_trials"] == 333

    def test_evaluation_metrics_override_replaces_list(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        r = client.put(
            "/api/workspace/config/tuning-overrides",
            json={"evaluation_metrics": ["logloss"]},
        )
        assert r.status_code == 200, r.text
        eff = r.json()["tuning_effective"]
        assert eff["evaluation_metrics"] == ["logloss"]

    def test_extra_field_is_rejected(self, client: TestClient, tmp_path: Path) -> None:
        """``TuningOverrides`` is ``extra="forbid"`` — typos surface as 422."""
        _load_data_and_binary_config(client, tmp_path)
        r = client.put(
            "/api/workspace/config/tuning-overrides",
            json={"unknown_field": 42},
        )
        assert r.status_code == 422, r.text

    def test_empty_body_is_accepted(self, client: TestClient, tmp_path: Path) -> None:
        """An empty intent is a valid 'reset to catalog defaults' request."""
        _load_data_and_binary_config(client, tmp_path)
        r = client.put("/api/workspace/config/tuning-overrides", json={})
        assert r.status_code == 200, r.text
        eff = r.json()["tuning_effective"]
        # Catalog defaults shine through when no overrides are set.
        assert eff["n_trials"] == 50  # safe fallback when catalog has none
        assert eff["direction"] == "maximize"
