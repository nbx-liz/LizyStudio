"""Unit tests for the LizyML adapter."""

from __future__ import annotations

from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import BackendInfo, ConfigSchema


def test_adapter_info() -> None:
    adapter = LizyMLAdapter()
    info = adapter.info
    assert isinstance(info, BackendInfo)
    assert info.name == "lizyml"
    assert isinstance(info.version, str)


def test_adapter_config_schema() -> None:
    adapter = LizyMLAdapter()
    schema = adapter.get_config_schema()
    assert isinstance(schema, ConfigSchema)
    assert "properties" in schema.json_schema


def test_adapter_validate_config_empty() -> None:
    adapter = LizyMLAdapter()
    errors = adapter.validate_config({})
    assert len(errors) > 0


def test_adapter_load_config_yaml() -> None:
    adapter = LizyMLAdapter()
    content = b"task: binary\nmodel:\n  name: lightgbm"
    result = adapter.load_config_from_file(content, "config.yaml")
    assert result["task"] == "binary"
    assert result["model"]["name"] == "lightgbm"


def test_adapter_load_config_json() -> None:
    adapter = LizyMLAdapter()
    content = b'{"task": "regression"}'
    result = adapter.load_config_from_file(content, "config.json")
    assert result["task"] == "regression"


def test_registry_get_adapter() -> None:
    adapter = get_adapter("lizyml")
    assert isinstance(adapter, LizyMLAdapter)


def test_registry_unknown_backend() -> None:
    import pytest

    with pytest.raises(ValueError, match="Unknown backend"):
        get_adapter("nonexistent")
