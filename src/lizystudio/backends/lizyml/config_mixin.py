"""Config-related methods for LizyMLAdapter."""

from __future__ import annotations

import json
from typing import Any

import yaml

from lizystudio.backends.types import BackendInfo, ConfigSchema

from .config_compat import (
    search_space_compat_errors,
    strip_internal_keys,
    task_params_compat_errors,
)


class ConfigMixin:
    """Identification, schema, validation, and config file loading."""

    @property
    def info(self) -> BackendInfo:
        import lizyml

        return BackendInfo(name="lizyml", version=lizyml.__version__)

    def get_ui_schema(self) -> dict[str, Any]:
        from lizystudio.backends.lizyml_ui_schema import (
            build_ui_schema,
            get_eval_metrics_by_task,
        )

        return build_ui_schema(get_eval_metrics_by_task())

    def get_config_schema(self) -> ConfigSchema:
        from lizyml.config.schema import LizyMLConfig

        return ConfigSchema(json_schema=LizyMLConfig.model_json_schema())

    def get_default_config(self, task: str, target: str) -> dict[str, Any]:
        from lizyml.config.schema import LizyMLConfig

        is_classification = task in ("binary", "multiclass")
        split_method = "stratified_kfold" if is_classification else "kfold"
        # P-0104 Wave 2.2 / Issue #459: Studio overrides the library default
        # ``TrainingConfig.seed = 42`` with 1120 at the default-config layer.
        # This keeps fresh Fit-tab configs aligned with the Tune-tab seed
        # default already at 1120 (see ``lizyml_ui_schema.search_space_catalog``)
        # so the Fit / Tune split is reproducible without manual override.
        minimal = {
            "config_version": 1,
            "task": task,
            "data": {"target": target},
            "model": {"name": "lgbm"},
            "split": {"method": split_method},
            "training": {"seed": 1120},
        }
        validated = LizyMLConfig.model_validate(minimal)
        return validated.model_dump(mode="json")

    def validate_config(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        from lizyml.config.schema import LizyMLConfig
        from pydantic import ValidationError

        clean = self._strip_internal_keys(config)
        errors: list[dict[str, Any]] = []
        try:
            LizyMLConfig.model_validate(clean)
        except ValidationError as exc:
            errors.extend(exc.errors())  # type: ignore[arg-type]

        errors.extend(task_params_compat_errors(clean))
        errors.extend(search_space_compat_errors(clean))
        return errors

    @staticmethod
    def _strip_internal_keys(config: dict[str, Any]) -> dict[str, Any]:
        """Thin shim around :func:`strip_internal_keys` kept for backward
        compatibility — older tests reach into ``LizyMLAdapter._strip_internal_keys``
        directly."""
        return strip_internal_keys(config)

    def load_config_from_file(self, content: bytes, filename: str) -> dict[str, Any]:
        text = content.decode("utf-8")
        if filename.endswith((".yaml", ".yml")):
            data: Any = yaml.safe_load(text)
        elif filename.endswith(".json"):
            data = json.loads(text)
        else:
            try:
                data = yaml.safe_load(text)
            except yaml.YAMLError:
                data = json.loads(text)
        if not isinstance(data, dict):
            msg = f"Expected a mapping, got {type(data).__name__}"
            raise ValueError(msg)
        return data
