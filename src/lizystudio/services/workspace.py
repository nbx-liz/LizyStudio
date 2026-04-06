"""Workspace volatile state — lives in app.state, injected via Depends."""

from __future__ import annotations

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
            # Clean up tracked temp files
            for tmp in self._temp_files:
                Path(tmp).unlink(missing_ok=True)
            self._temp_files.clear()

    def track_temp_file(self, path: str) -> None:
        """Register a temp file for cleanup on reset."""
        with self._lock:
            self._temp_files.append(path)

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
