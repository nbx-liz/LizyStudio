"""Tests for P-0109 PR-4b — workspace storage rename + INV-T6 snapshot freeze.

PR-4b makes :attr:`WorkspaceState.tuning_overrides` the sole source of
Tune intent. The legacy nested ``config["tuning"]`` block is no longer
persisted in the workspace — it's synthesised on demand by
:func:`get_legacy_config_view` for backward-compat GET /config callers,
and materialised once at tune-job start via
:func:`materialize_tuning_for_job` (INV-T6).

Tests cover:

* The new ``WorkspaceState.tuning_overrides`` field + reset behaviour
* PUT /config compat: legacy ``tuning`` block diverts into
  ``ws.tuning_overrides`` and is stripped from ``ws.config``
* GET /config compat: synthesises ``tuning`` from
  ``ws.tuning_overrides`` so legacy callers keep seeing the materialised
  shape
* INV-T6 snapshot freeze: tune jobs receive a config snapshot whose
  ``tuning`` block is materialised once at start and is independent of
  later catalog changes
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import TuningOverrides
from lizystudio.services.workspace import (
    absorb_legacy_tuning,
    get_legacy_config_view,
    materialize_tuning_for_job,
)

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_csv(tmp_path: Path) -> str:
    csv_path = tmp_path / "train.csv"
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
    r = client.post("/api/workspace/data/path", json={"path": _create_csv(tmp_path)})
    assert r.status_code == 200, r.text
    r = client.put("/api/workspace/config", json=_load_default_binary_config(client))
    assert r.status_code == 200 and r.json()["saved"] is True, r.text


# ---------------------------------------------------------------------------
# WorkspaceState.tuning_overrides field
# ---------------------------------------------------------------------------


class TestWorkspaceTuningOverridesField:
    """The new sparse-intent storage field on :class:`WorkspaceState`."""

    def test_fresh_workspace_has_none(self, client: TestClient) -> None:
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        assert ws.tuning_overrides is None

    def test_reset_clears_tuning_overrides(self, client: TestClient) -> None:
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        ws.tuning_overrides = TuningOverrides(n_trials=42)
        ws.reset()
        assert ws.tuning_overrides is None

    def test_set_tuning_overrides_locks_under_write(self, client: TestClient) -> None:
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        ws.set_tuning_overrides(TuningOverrides(n_trials=100))
        assert ws.tuning_overrides is not None
        assert ws.tuning_overrides.n_trials == 100


# ---------------------------------------------------------------------------
# PUT /config compat — absorbs legacy tuning into tuning_overrides
# ---------------------------------------------------------------------------


class TestPutConfigAbsorbsLegacyTuning:
    """``PUT /config`` diverts ``body["tuning"]`` into ``ws.tuning_overrides``."""

    def test_legacy_payload_with_tuning_lands_in_overrides(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        config = _load_default_binary_config(client)
        config["tuning"] = {
            "optuna": {
                "params": {
                    "n_trials": 333,
                    "timeout": None,
                    "direction": "maximize",
                },
                "space": {
                    "learning_rate": {
                        "type": "float",
                        "low": 0.5,
                        "high": 1.0,
                        "log": False,
                    }
                },
            }
        }
        r = client.put("/api/workspace/config", json=config)
        assert r.status_code == 200, r.text
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        # The intent landed in tuning_overrides.
        assert ws.tuning_overrides is not None
        assert ws.tuning_overrides.n_trials == 333
        assert "learning_rate" in ws.tuning_overrides.space
        # And was stripped from ws.config so the storage has a single SSOT.
        assert "tuning" not in ws.config

    def test_payload_without_tuning_leaves_overrides_unchanged(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        ws.tuning_overrides = TuningOverrides(n_trials=99)
        # A pure config update (no tuning block) preserves the intent.
        config = _load_default_binary_config(client)
        config.pop("tuning", None)
        r = client.put("/api/workspace/config", json=config)
        assert r.status_code == 200, r.text
        assert ws.tuning_overrides is not None
        assert ws.tuning_overrides.n_trials == 99


# ---------------------------------------------------------------------------
# GET /config compat — synthesises tuning from tuning_overrides
# ---------------------------------------------------------------------------


class TestGetConfigSynthesisesLegacyTuning:
    """``GET /config`` returns materialised ``tuning`` for legacy callers."""

    def test_get_after_overrides_set_includes_user_set_tuning(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """Sparse-emit: the synthesised ``tuning`` only carries user-set fields.

        Catalog defaults intentionally do NOT bleed into ``GET /config``
        — they live at ``GET /config/tuning-snapshot`` for callers that
        want the fully-materialised effective view. The pre-PR-4b
        legacy frontend reads ``config.tuning.optuna.params.n_trials``
        and treats missing fields as "untouched", falling back to its
        local SegmentedControl default. Sparseness preserves that
        semantic so the legacy frontend keeps working unchanged
        between PR-4b and PR-5.
        """
        _load_data_and_binary_config(client, tmp_path)
        r = client.put(
            "/api/workspace/config/tuning-overrides",
            json={"n_trials": 250},
        )
        assert r.status_code == 200, r.text
        cfg = client.get("/api/workspace/config")
        assert cfg.status_code == 200, cfg.text
        body = cfg.json()
        assert "tuning" in body
        assert body["tuning"]["optuna"]["params"]["n_trials"] == 250
        # ``timeout`` / ``direction`` / ``space`` not in ``model_fields_set``
        # of the PUT body — sparse-emit omits them.
        assert "timeout" not in body["tuning"]["optuna"]["params"]
        assert "direction" not in body["tuning"]["optuna"]["params"]
        assert "space" not in body["tuning"]["optuna"]

    def test_get_without_overrides_omits_tuning(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        """Pre-PR-5 behaviour: no tune state → no tuning key in GET /config."""
        _load_data_and_binary_config(client, tmp_path)
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        ws.tuning_overrides = None
        cfg = client.get("/api/workspace/config")
        assert cfg.status_code == 200, cfg.text
        assert "tuning" not in cfg.json()


# ---------------------------------------------------------------------------
# INV-T6 — tune-job snapshot freeze
# ---------------------------------------------------------------------------


class TestInvT6JobSnapshotFreeze:
    """``materialize_tuning_for_job`` produces a frozen effective at start."""

    def test_workspace_with_no_overrides_yields_catalog_defaults_in_job_config(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        ws = client.app.state.workspace  # type: ignore[attr-defined]
        ws.tuning_overrides = None

        captured: dict[str, Any] = {}

        def fake_start(**kwargs: object) -> str:
            captured["job_config"] = kwargs["config"]
            return "job_inv_t6_a"

        with patch("lizystudio.api.workspace.start_tune_async", side_effect=fake_start):
            r = client.post("/api/workspace/tune")
        assert r.status_code == 200, r.text

        snapshot = captured["job_config"]
        assert snapshot["tuning"]["optuna"]["params"]["n_trials"] == 50
        assert snapshot["tuning"]["optuna"]["params"]["direction"] == "maximize"
        # Catalog space appears in the job snapshot.
        assert "learning_rate" in snapshot["tuning"]["optuna"]["space"]

    def test_workspace_with_overrides_yields_merged_effective_in_job_config(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        _load_data_and_binary_config(client, tmp_path)
        # Set a sparse override via the dedicated endpoint.
        r = client.put(
            "/api/workspace/config/tuning-overrides",
            json={"n_trials": 200},
        )
        assert r.status_code == 200, r.text

        captured: dict[str, Any] = {}

        def fake_start(**kwargs: object) -> str:
            captured["job_config"] = kwargs["config"]
            return "job_inv_t6_b"

        with patch("lizystudio.api.workspace.start_tune_async", side_effect=fake_start):
            r = client.post("/api/workspace/tune")
        assert r.status_code == 200, r.text

        snapshot = captured["job_config"]
        # User intent survives.
        assert snapshot["tuning"]["optuna"]["params"]["n_trials"] == 200
        # Catalog direction (auc → maximize) fills the unset field.
        assert snapshot["tuning"]["optuna"]["params"]["direction"] == "maximize"


# ---------------------------------------------------------------------------
# Unit tests — service helpers behave correctly when called directly
# ---------------------------------------------------------------------------


class TestAbsorbLegacyTuning:
    def test_extracts_and_strips_tuning(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        config = {
            "task": "binary",
            "tuning": {"optuna": {"params": {"n_trials": 77}, "space": {}}},
        }
        out = absorb_legacy_tuning(ws, config)
        assert out == {"task": "binary"}
        assert ws.tuning_overrides is not None
        assert ws.tuning_overrides.n_trials == 77

    def test_no_tuning_in_payload_leaves_state_unchanged(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        ws.tuning_overrides = TuningOverrides(n_trials=99)
        out = absorb_legacy_tuning(ws, {"task": "binary"})
        assert out == {"task": "binary"}
        # Overrides survive a tuning-less PUT.
        assert ws.tuning_overrides is not None
        assert ws.tuning_overrides.n_trials == 99

    def test_does_not_mutate_input(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        original = {
            "task": "binary",
            "tuning": {"optuna": {"params": {"n_trials": 50}, "space": {}}},
        }
        snap = dict(original)
        absorb_legacy_tuning(ws, original)
        # Caller's dict survives unchanged — fresh copy returned.
        assert original == snap


class TestGetLegacyConfigView:
    def test_no_overrides_returns_config_as_is(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        ws.config = {"task": "binary"}
        out = get_legacy_config_view(ws)
        assert out == {"task": "binary"}

    def test_overrides_synthesise_materialised_tuning_block(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        ws.config = {"task": "binary"}
        ws.tuning_overrides = TuningOverrides(n_trials=42)
        out = get_legacy_config_view(ws)
        assert out["tuning"]["optuna"]["params"]["n_trials"] == 42


class TestMaterializeTuningForJob:
    def test_always_emits_tuning_block(self) -> None:
        """INV-T6 stronger than ``get_legacy_config_view``: always materialise."""
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        ws.config = {"task": "binary"}
        ws.tuning_overrides = None  # no user intent
        out = materialize_tuning_for_job(ws)
        # Pure catalog defaults materialised — INV-T6 demands a tuning
        # block at job start regardless of the workspace's intent state.
        assert "tuning" in out
        assert out["tuning"]["optuna"]["params"]["n_trials"] == 50
        assert out["tuning"]["optuna"]["params"]["direction"] == "maximize"

    def test_overrides_win_per_field(self) -> None:
        from lizystudio.backends.lizyml import LizyMLAdapter
        from lizystudio.services.workspace import WorkspaceState

        ws = WorkspaceState(backend=LizyMLAdapter())
        ws.config = {"task": "binary"}
        ws.tuning_overrides = TuningOverrides(n_trials=11, direction="minimize")
        out = materialize_tuning_for_job(ws)
        assert out["tuning"]["optuna"]["params"]["n_trials"] == 11
        assert out["tuning"]["optuna"]["params"]["direction"] == "minimize"
