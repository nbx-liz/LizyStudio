"""Adapter Protocol conformance tests.

Verifies that all registered BackendAdapter implementations conform to
the Protocol interface, return correct types, and handle errors properly.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import BackendInfo, ConfigSchema


def _get_protocol_methods() -> dict[str, inspect.Signature]:
    """Extract all public method/property signatures from BackendAdapter."""
    methods: dict[str, inspect.Signature] = {}
    for name, member in inspect.getmembers(BackendAdapter):
        if name.startswith("_"):
            continue
        if callable(member) or isinstance(
            inspect.getattr_static(BackendAdapter, name, None), property
        ):
            try:
                sig = inspect.signature(member) if callable(member) else None
                methods[name] = sig  # type: ignore[assignment]
            except (ValueError, TypeError):
                methods[name] = None  # type: ignore[assignment]
    return methods


# --- Protocol surface ---


class TestProtocolSurface:
    """Verify that BackendAdapter Protocol has the expected surface."""

    def test_protocol_has_info_property(self) -> None:
        """BackendAdapter defines 'info' property."""
        attr = inspect.getattr_static(BackendAdapter, "info", None)
        assert isinstance(attr, property) or attr is not None

    def test_protocol_has_config_methods(self) -> None:
        """BackendAdapter defines config-related methods."""
        expected = [
            "get_config_schema",
            "get_ui_schema",
            "validate_config",
            "get_default_config",
            "load_config_from_file",
        ]
        for method_name in expected:
            assert hasattr(BackendAdapter, method_name), f"Missing: {method_name}"

    def test_protocol_has_model_lifecycle_methods(self) -> None:
        """BackendAdapter defines model lifecycle methods."""
        expected = [
            "create_model",
            "fit",
            "tune",
            "predict",
        ]
        for method_name in expected:
            assert hasattr(BackendAdapter, method_name), f"Missing: {method_name}"

    def test_protocol_has_evaluation_methods(self) -> None:
        """BackendAdapter defines evaluation methods."""
        expected = [
            "evaluate_table",
            "split_summary",
            "importance",
            "importance_kinds",
            "confusion_matrix",
            "plot",
            "available_plots",
        ]
        for method_name in expected:
            assert hasattr(BackendAdapter, method_name), f"Missing: {method_name}"

    def test_protocol_has_persistence_methods(self) -> None:
        """BackendAdapter defines persistence methods."""
        expected = [
            "export_model",
            "export_code",
            "load_model",
            "model_info",
        ]
        for method_name in expected:
            assert hasattr(BackendAdapter, method_name), f"Missing: {method_name}"


# --- LizyML Adapter conformance ---


class TestLizyMLConformance:
    """Verify that LizyMLAdapter implements all Protocol methods."""

    @pytest.fixture()
    def adapter(self) -> Any:
        return get_adapter("lizyml")

    def test_adapter_has_all_protocol_methods(self, adapter: Any) -> None:
        """LizyMLAdapter implements every method in BackendAdapter Protocol."""
        protocol_methods = _get_protocol_methods()
        for method_name in protocol_methods:
            assert hasattr(adapter, method_name), (
                f"LizyMLAdapter missing method: {method_name}"
            )

    def test_info_returns_backend_info(self, adapter: Any) -> None:
        """adapter.info returns a BackendInfo instance."""
        info = adapter.info
        assert isinstance(info, BackendInfo)
        assert isinstance(info.name, str)
        assert len(info.name) > 0
        assert isinstance(info.version, str)

    def test_get_config_schema_returns_config_schema(self, adapter: Any) -> None:
        """get_config_schema returns a ConfigSchema with valid JSON Schema."""
        schema = adapter.get_config_schema()
        assert isinstance(schema, ConfigSchema)
        assert isinstance(schema.json_schema, dict)
        assert "properties" in schema.json_schema or "type" in schema.json_schema

    def test_get_ui_schema_returns_dict(self, adapter: Any) -> None:
        """get_ui_schema returns a dict."""
        ui_schema = adapter.get_ui_schema()
        assert isinstance(ui_schema, dict)

    def test_validate_config_returns_list(self, adapter: Any) -> None:
        """validate_config returns a list (possibly empty for valid config)."""
        errors = adapter.validate_config({})
        assert isinstance(errors, list)

    def test_validate_config_empty_returns_errors(self, adapter: Any) -> None:
        """An empty config should produce validation errors."""
        errors = adapter.validate_config({})
        # Empty config is likely invalid; at least one error expected
        assert len(errors) > 0, "Empty config should produce errors"

    def test_get_default_config_returns_dict(self, adapter: Any) -> None:
        """get_default_config returns a non-empty config dict."""
        config = adapter.get_default_config(task="binary", target="target")
        assert isinstance(config, dict)
        assert len(config) > 0

    def test_default_config_validates_clean(self, adapter: Any) -> None:
        """Default config from get_default_config passes validate_config."""
        config = adapter.get_default_config(task="binary", target="target")
        errors = adapter.validate_config(config)
        assert errors == [], f"Default config has validation errors: {errors}"

    def test_load_config_from_file_yaml(self, adapter: Any) -> None:
        """load_config_from_file handles YAML content."""
        yaml_content = b"task: binary\ntarget: y\n"
        config = adapter.load_config_from_file(yaml_content, "config.yaml")
        assert isinstance(config, dict)
        assert config.get("task") == "binary"

    def test_load_config_from_file_json(self, adapter: Any) -> None:
        """load_config_from_file handles JSON content."""
        import json

        json_content = json.dumps({"task": "binary", "target": "y"}).encode()
        config = adapter.load_config_from_file(json_content, "config.json")
        assert isinstance(config, dict)


# --- Error handling ---


class TestAdapterErrors:
    """Verify adapter returns clear errors for invalid inputs."""

    @pytest.fixture()
    def adapter(self) -> Any:
        return get_adapter("lizyml")

    def test_load_model_nonexistent_path(self, adapter: Any) -> None:
        """load_model with a nonexistent path raises an error."""
        from lizyml.core.exceptions import LizyMLError

        with pytest.raises(LizyMLError):
            adapter.load_model("/nonexistent/model/path")

    def test_load_config_invalid_content(self, adapter: Any) -> None:
        """load_config_from_file with garbage content raises an error."""
        import yaml

        with pytest.raises(yaml.error.YAMLError):
            adapter.load_config_from_file(b"\x00\x01\x02", "config.yaml")
