"""Tests for Config patch protocol (H-0037) and error code expansion (H-0041).

Covers:
- PATCH /api/workspace/config endpoint
- Path validation (regex, dunder rejection)
- set / unset / merge operations
- New error codes: CONFIG_BUILD_ERROR, CONFIG_IMPORT_ERROR, EXPORT_ERROR
"""

from __future__ import annotations

from typing import Any

import pytest

from lizystudio.api.errors import (
    ConfigBuildError,
    ConfigImportError,
    ExportError,
)
from lizystudio.services.workspace import apply_config_patch

pytestmark = pytest.mark.integration

# --- H-0041: Error code tests ---


class TestNewErrorCodes:
    """Verify new error classes have correct codes and status."""

    def test_config_build_error(self) -> None:
        err = ConfigBuildError("missing required field 'target'")
        assert err.code == "CONFIG_BUILD_ERROR"
        assert err.status_code == 400
        assert "target" in err.message

    def test_config_import_error(self) -> None:
        err = ConfigImportError("YAML parse error at line 5")
        assert err.code == "CONFIG_IMPORT_ERROR"
        assert err.status_code == 400
        assert "YAML" in err.message

    def test_export_error(self) -> None:
        err = ExportError("model directory not found")
        assert err.code == "EXPORT_ERROR"
        assert err.status_code == 500
        assert "model" in err.message


# --- H-0037: Config patch service tests ---


class TestApplyConfigPatch:
    """Unit tests for apply_config_patch."""

    def test_set_top_level_key(self) -> None:
        config: dict[str, Any] = {"task": "binary"}
        result = apply_config_patch(
            config, [{"op": "set", "path": "target", "value": "y"}]
        )
        assert result["target"] == "y"
        assert result["task"] == "binary"

    def test_set_nested_key(self) -> None:
        config: dict[str, Any] = {"model": {"params": {}}}
        result = apply_config_patch(
            config,
            [{"op": "set", "path": "model.params.learning_rate", "value": 0.05}],
        )
        assert result["model"]["params"]["learning_rate"] == 0.05

    def test_unset_key(self) -> None:
        config: dict[str, Any] = {"model": {"params": {"lr": 0.1, "depth": 6}}}
        result = apply_config_patch(
            config,
            [{"op": "unset", "path": "model.params.lr"}],
        )
        assert "lr" not in result["model"]["params"]
        assert result["model"]["params"]["depth"] == 6

    def test_merge_operation(self) -> None:
        config: dict[str, Any] = {"training": {"seed": 42}}
        result = apply_config_patch(
            config,
            [{"op": "merge", "path": "training", "value": {"epochs": 10}}],
        )
        assert result["training"]["seed"] == 42
        assert result["training"]["epochs"] == 10

    def test_multiple_ops_in_one_patch(self) -> None:
        config: dict[str, Any] = {"a": 1, "b": 2}
        result = apply_config_patch(
            config,
            [
                {"op": "set", "path": "c", "value": 3},
                {"op": "unset", "path": "b"},
            ],
        )
        assert result == {"a": 1, "c": 3}

    def test_invalid_path_regex_raises(self) -> None:
        """Paths with special characters should be rejected."""
        config: dict[str, Any] = {}
        with pytest.raises(ValueError, match="Invalid path"):
            apply_config_patch(
                config,
                [{"op": "set", "path": "foo[0].bar", "value": 1}],
            )

    def test_dunder_path_rejected(self) -> None:
        """Paths containing __ should be rejected."""
        config: dict[str, Any] = {}
        with pytest.raises(ValueError, match="dunder"):
            apply_config_patch(
                config,
                [{"op": "set", "path": "model.__class__", "value": "x"}],
            )

    def test_invalid_op_rejected(self) -> None:
        """Only set/unset/merge ops are allowed."""
        config: dict[str, Any] = {}
        with pytest.raises(ValueError, match="op"):
            apply_config_patch(
                config,
                [{"op": "delete", "path": "key"}],
            )

    def test_non_dict_op_element_rejected(self) -> None:
        """Non-dict elements in ops list should be rejected."""
        config: dict[str, Any] = {"a": 1}
        with pytest.raises(ValueError, match="dict"):
            apply_config_patch(config, [None])  # type: ignore[list-item]

    def test_original_config_not_mutated(self) -> None:
        """apply_config_patch should return a new dict."""
        config: dict[str, Any] = {"a": {"b": 1}}
        result = apply_config_patch(
            config,
            [{"op": "set", "path": "a.b", "value": 2}],
        )
        assert config["a"]["b"] == 1
        assert result["a"]["b"] == 2

    def test_empty_ops_returns_copy(self) -> None:
        config: dict[str, Any] = {"a": 1}
        result = apply_config_patch(config, [])
        assert result == config
        assert result is not config


# --- H-0037: PATCH endpoint integration tests ---


def _set_valid_config(client: Any) -> dict[str, Any]:
    """Get a valid default config and PUT it into the workspace."""
    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    config: dict[str, Any] = res.json()
    client.put("/api/workspace/config", json=config)
    return config


class TestPatchEndpoint:
    """Integration tests via TestClient."""

    def test_patch_sets_value(self, client: Any) -> None:
        """PATCH /api/workspace/config should update config."""
        _set_valid_config(client)
        resp = client.patch(
            "/api/workspace/config",
            json={
                "ops": [
                    {"op": "set", "path": "task", "value": "regression"},
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.json()["config"]["task"] == "regression"

    def test_patch_unsets_value(self, client: Any) -> None:
        _set_valid_config(client)
        resp = client.patch(
            "/api/workspace/config",
            json={"ops": [{"op": "unset", "path": "calibration"}]},
        )
        assert resp.status_code == 200
        assert "calibration" not in resp.json()["config"]

    def test_patch_invalid_path_returns_422(self, client: Any) -> None:
        _set_valid_config(client)
        resp = client.patch(
            "/api/workspace/config",
            json={"ops": [{"op": "set", "path": "foo.__bar__", "value": 1}]},
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_PATCH"

    def test_patch_invalid_op_returns_422(self, client: Any) -> None:
        _set_valid_config(client)
        resp = client.patch(
            "/api/workspace/config",
            json={"ops": [{"op": "remove", "path": "task"}]},
        )
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "INVALID_PATCH"

    def test_patch_on_empty_config_returns_error(self, client: Any) -> None:
        """PATCH on empty workspace should fail."""
        client.post("/api/workspace/reset")
        resp = client.patch(
            "/api/workspace/config",
            json={"ops": [{"op": "set", "path": "x", "value": 1}]},
        )
        assert resp.status_code == 400

    def test_existing_put_still_works(self, client: Any) -> None:
        """PUT /api/workspace/config should still work (backward compat)."""
        config = _set_valid_config(client)
        resp = client.get("/api/workspace/config")
        assert resp.status_code == 200
        assert resp.json()["task"] == config["task"]


# --- Deeply nested config (#14) ---


class TestDeepNesting:
    """Config patch with deeply nested paths."""

    def test_set_deeply_nested_path(self) -> None:
        """Set operation on 5+ level nested path."""
        config: dict[str, Any] = {"a": {"b": {"c": {"d": {}}}}}
        result = apply_config_patch(
            config,
            [{"op": "set", "path": "a.b.c.d.e", "value": 42}],
        )
        assert result["a"]["b"]["c"]["d"]["e"] == 42

    def test_set_creates_intermediate_keys(self) -> None:
        """Set on non-existent intermediate keys creates them."""
        config: dict[str, Any] = {}
        result = apply_config_patch(
            config,
            [{"op": "set", "path": "x.y.z", "value": "deep"}],
        )
        assert result["x"]["y"]["z"] == "deep"

    def test_unset_deeply_nested(self) -> None:
        """Unset on a deep key removes only the leaf."""
        config: dict[str, Any] = {"a": {"b": {"c": 1, "d": 2}}}
        result = apply_config_patch(
            config,
            [{"op": "unset", "path": "a.b.c"}],
        )
        assert "c" not in result["a"]["b"]
        assert result["a"]["b"]["d"] == 2
