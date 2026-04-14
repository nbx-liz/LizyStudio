"""Workspace volatile state — lives in app.state, injected via Depends."""

from __future__ import annotations

import copy
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Request

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import DataRef, FitSummary, TuningSummary


@dataclass
class WorkspaceState:
    """Mutable workspace state (per-process, volatile)."""

    backend: BackendAdapter
    config: dict[str, Any] = field(default_factory=dict)
    data_ref: DataRef | None = None
    dataframe: pd.DataFrame | None = None
    model: Any = None
    # Result from the latest fit/tune executed in this session
    workspace_fit_result: FitSummary | None = None
    workspace_tune_result: TuningSummary | None = None
    current_job_id: str | None = None
    # Thread safety for background thread writes
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    # Background job thread tracking (H-0040)
    _job_thread: threading.Thread | None = field(default=None, repr=False)
    # Temp files to clean up on reset
    _temp_files: list[str] = field(default_factory=list, repr=False)

    def reset(self) -> None:
        """Clear everything except the backend adapter."""
        with self._lock:
            self.config = {}
            self.data_ref = None
            self.dataframe = None
            self.model = None
            self.workspace_fit_result = None
            self.workspace_tune_result = None
            self.current_job_id = None
            self._job_thread = None
            # Clean up tracked temp files
            for tmp in self._temp_files:
                Path(tmp).unlink(missing_ok=True)
            self._temp_files.clear()

    def track_temp_file(self, path: str) -> None:
        """Register a temp file for cleanup on reset."""
        with self._lock:
            self._temp_files.append(path)

    def consume_temp_file(self, path: str) -> bool:
        """Delete a previously tracked temp file and drop it from the list.

        Returns ``True`` when *path* was tracked (whether or not the
        unlink succeeded). Inference consumers call this right after a
        single-shot upload so ``/tmp`` does not fill up waiting for
        ``reset()``.
        """
        with self._lock:
            if path not in self._temp_files:
                return False
            self._temp_files.remove(path)
        Path(path).unlink(missing_ok=True)
        return True

    def set_data(self, dataframe: pd.DataFrame, data_ref: DataRef) -> None:
        """Load data into the workspace."""
        with self._lock:
            self.dataframe = dataframe
            self.data_ref = data_ref

    def set_config(self, config: dict[str, Any]) -> None:
        """Update the current config."""
        with self._lock:
            self.config = config


def get_workspace(request: Request) -> WorkspaceState:
    """FastAPI dependency — retrieve workspace from app.state."""
    return request.app.state.workspace  # type: ignore[no-any-return]


# --- Service-layer helpers for config operations (Phase 20) ---


def get_config_schema(ws: WorkspaceState) -> dict[str, Any]:
    """Return the backend's config JSON Schema."""
    return ws.backend.get_config_schema().json_schema


def get_default_config(ws: WorkspaceState, task: str, target: str) -> dict[str, Any]:
    """Generate a complete default config via the backend adapter."""
    return ws.backend.get_default_config(task, target)


def validate_config(ws: WorkspaceState, config: dict[str, Any]) -> list[dict[str, Any]]:
    """Validate a config dict against the backend.

    Normalizes Pydantic v2 error dicts to ``{path, message}`` for the frontend.
    """
    raw_errors = ws.backend.validate_config(config)
    normalized: list[dict[str, Any]] = []
    for err in raw_errors:
        loc = err.get("loc", [])
        path = ".".join(str(p) for p in loc) if loc else err.get("path", "")
        message = err.get("msg", err.get("message", ""))
        if path or message:
            normalized.append({"path": path, "message": message})
    return normalized


def load_config_from_file(
    ws: WorkspaceState, content: bytes, filename: str
) -> dict[str, Any]:
    """Parse an uploaded config file via the backend."""
    return ws.backend.load_config_from_file(content, filename)


def get_backend_name(ws: WorkspaceState) -> str:
    """Return the backend adapter name."""
    return ws.backend.info.name


# --- Config patch operations (H-0037) ---


# Allows letters, digits, underscores (single _ OK, __ rejected separately).
_PATH_RE = re.compile(r"^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$")
_ALLOWED_OPS = frozenset({"set", "unset", "merge"})


def apply_config_patch(
    config: dict[str, Any],
    ops: list[dict[str, Any]],
) -> dict[str, Any]:
    """Apply patch operations to a config dict and return a new copy.

    Each op is ``{"op": "set"|"unset"|"merge", ...}``.
    ``merge`` performs a **shallow** (1-level) merge.
    Raises ``ValueError`` on invalid path or op.
    """
    result = copy.deepcopy(config)
    for op_dict in ops:
        if not isinstance(op_dict, dict):
            msg = "Each op must be a dict"
            raise ValueError(msg)
        op = op_dict.get("op", "")
        path = op_dict.get("path", "")
        value = op_dict.get("value")

        if op not in _ALLOWED_OPS:
            msg = f"Unsupported op: {op!r}. Allowed: {sorted(_ALLOWED_OPS)}"
            raise ValueError(msg)
        if not _PATH_RE.match(path):
            msg = f"Invalid path: {path!r}"
            raise ValueError(msg)
        if "__" in path:
            msg = f"Path contains dunder: {path!r}"
            raise ValueError(msg)

        parts = path.split(".")
        _apply_single_op(result, parts, op, value)
    return result


def _apply_single_op(
    target: dict[str, Any],
    parts: list[str],
    op: str,
    value: Any,
) -> None:
    """Apply a single patch op at the given path."""
    # Navigate to parent
    current = target
    for part in parts[:-1]:
        if part not in current or not isinstance(current[part], dict):
            current[part] = {}
        current = current[part]

    key = parts[-1]
    if op == "set":
        current[key] = value
    elif op == "unset":
        current.pop(key, None)
    elif op == "merge":
        if not isinstance(value, dict):
            msg = f"merge value must be a dict, got {type(value).__name__}"
            raise ValueError(msg)
        existing = current.get(key, {})
        if not isinstance(existing, dict):
            existing = {}
        current[key] = {**existing, **value}
