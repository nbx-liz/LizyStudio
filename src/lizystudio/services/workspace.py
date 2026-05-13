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

    def is_tracked_temp_file(self, path: str) -> bool:
        """Return ``True`` when *path* is a server-staged upload tempfile.

        Used by ``/api/inference/run`` to authorise ``source_type=upload``
        paths without sending them through the user-facing
        ``ALLOWED_FILES_ROOT`` validation: server tempfiles live under
        the OS temp dir (typically ``/tmp``), which is intentionally
        outside the user's home root. Verifying membership in
        ``_temp_files`` (populated only by ``/api/*/upload`` endpoints)
        prevents an attacker from bypassing path validation by
        declaring ``source_type=upload`` with an arbitrary system path.
        """
        with self._lock:
            return path in self._temp_files

    def set_data(self, dataframe: pd.DataFrame, data_ref: DataRef) -> None:
        """Load data into the workspace."""
        with self._lock:
            self.dataframe = dataframe
            self.data_ref = data_ref

    def set_config(self, config: dict[str, Any]) -> None:
        """Update the current config."""
        with self._lock:
            self.config = config

    # --- Background job thread coordination (A-4) ---

    def register_job_thread(self, thread: threading.Thread) -> None:
        """Record *thread* as the currently-active background job thread.

        Replaces any previously-registered handle under the workspace
        lock so the reader side (:meth:`previous_job_thread`) never sees
        a torn write when a new job is started while the previous one is
        still winding down.
        """
        with self._lock:
            self._job_thread = thread

    def previous_job_thread(self) -> threading.Thread | None:
        """Return the most recently registered background job thread."""
        with self._lock:
            return self._job_thread

    def record_completion(
        self,
        *,
        fit_result: FitSummary | None,
        tune_result: TuningSummary | None,
        job_id: str,
    ) -> None:
        """Atomically update the post-job workspace state.

        Fit / tune / retune launchers write three related fields when a
        job finishes: the fit summary, the tune summary, and the active
        job id. Routing them through a single method guarantees readers
        observe a consistent snapshot.
        """
        with self._lock:
            self.workspace_fit_result = fit_result
            self.workspace_tune_result = tune_result
            self.current_job_id = job_id

    def note_current_job(self, job_id: str) -> None:
        """Update only the current job id (for early-failure paths)."""
        with self._lock:
            self.current_job_id = job_id


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

    PR-B4 / R-3.4: each error dict now carries ``severity`` and
    ``suggested_fix`` fields in addition to the legacy ``path`` and
    ``message``. Backend Pydantic errors default to
    ``severity="error"`` and ``suggested_fix=None`` because the schema
    has no canned repair text; workspace-aware validators
    (``_workspace_split_errors``) supply both fields directly.

    Normalizes Pydantic v2 error dicts to
    ``{path, message, severity, suggested_fix}`` for the frontend.
    """
    raw_errors = ws.backend.validate_config(config)
    normalized: list[dict[str, Any]] = []
    for err in raw_errors:
        loc = err.get("loc", [])
        path = ".".join(str(p) for p in loc) if loc else err.get("path", "")
        message = err.get("msg", err.get("message", ""))
        if path or message:
            normalized.append(
                {
                    "path": path,
                    "message": message,
                    "severity": "error",
                    "suggested_fix": None,
                }
            )
    # Issue #268: workspace-aware validation. n_splits > n_rows is
    # accepted by Pydantic (no row-count knowledge inside the schema)
    # but explodes ~5s after Fit with sklearn's
    # "Cannot have number of splits greater than the number of samples".
    # Surfacing it here lets the existing "Fix validation errors first"
    # banner block the user before they even click Fit.
    normalized.extend(_workspace_split_errors(ws, config))
    # Issue #394: regression metrics that the loaded target column makes
    # mathematically impossible (MAPE on zero targets, RMSLE on negative
    # targets, R² on a constant target). Returned as severity="warning"
    # so the banner advises but does not block — the user can still fit
    # if they accept that lizyml will skip those metrics mid-fold.
    normalized.extend(_workspace_metric_compatibility_errors(ws, config))
    return normalized


def validate_search_space_for_tune(
    ws: WorkspaceState, config: dict[str, Any]
) -> list[dict[str, Any]]:
    """Run-gate check for ``tuning.optuna.space`` (P-0108, Issue #474).

    Called from ``POST /api/workspace/tune`` (and retune) AFTER
    ``validate_config`` so structurally-broken search spaces are
    rejected with a clear 422 *before* the tune job launches.

    Deliberately NOT folded into ``validate_config``: that function is
    shared by the save gate (``PUT /config``), which must remain
    permissive so users can ``PUT`` work-in-progress configs (inverted
    Range mid-keystroke, log+low=0 while raising Min, etc.) without
    losing their edits. See Issue #474 + PR #473 post-mortem.

    Returns the same ``{path, message, severity, suggested_fix}``
    envelope as ``validate_config`` so the same frontend renderer can
    surface either source.
    """
    if not isinstance(config, dict):
        return []
    tuning = config.get("tuning")
    if not isinstance(tuning, dict):
        return []
    optuna = tuning.get("optuna")
    if not isinstance(optuna, dict):
        return []
    space = optuna.get("space")
    if not isinstance(space, dict) or not space:
        return []
    return ws.backend.validate_search_space(space)


def _workspace_split_errors(
    ws: WorkspaceState, config: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return ``{path, message}`` errors for split.n_splits > n_rows.

    Returns an empty list when the workspace has no data loaded yet, or
    when the config is malformed in ways the Pydantic layer already
    flagged (defensive to avoid raising AttributeError on top of an
    unrelated validation failure).
    """
    data_ref = ws.data_ref
    if data_ref is None:
        return []
    n_rows = data_ref.shape[0]
    split = config.get("split") if isinstance(config, dict) else None
    if not isinstance(split, dict):
        return []
    n_splits_raw = split.get("n_splits")
    if not isinstance(n_splits_raw, int) or isinstance(n_splits_raw, bool):
        return []
    if n_splits_raw <= n_rows:
        return []
    return [
        {
            "path": "split.n_splits",
            "message": (
                f"n_splits={n_splits_raw} is greater than the number of "
                f"samples in the loaded dataset (n_rows={n_rows}). "
                f"Reduce Folds to at most {n_rows}."
            ),
            "severity": "error",
            "suggested_fix": (f"Set Folds (split.n_splits) to {n_rows} or fewer."),
        }
    ]


def _metric_entry_name(metric: Any) -> str | None:
    """Return the metric name from a MetricEntry (str or {name: params}).

    Mirrors the frontend's ``metricEntryName`` helper: a metric is either
    a plain string ``"auc"`` or a single-key dict ``{"precision_at_k":
    {"k": 20}}``. Anything else (None, multi-key dict, non-string key)
    returns None so callers can defensively skip malformed entries
    without raising.
    """
    if isinstance(metric, str):
        return metric
    if isinstance(metric, dict) and len(metric) == 1:
        key = next(iter(metric.keys()))
        if isinstance(key, str):
            return key
    return None


def _workspace_metric_compatibility_errors(
    ws: WorkspaceState, config: dict[str, Any]
) -> list[dict[str, Any]]:
    """Issue #394 / #403 (P-0106): warn before Fit when a configured metric
    is incompatible with the loaded dataset's target column.

    A thin envelope: it extracts the generic inputs from *config* and the
    loaded dataframe (task, target column, the parsed set of metric names),
    delegates the "which of these metrics has a target precondition" decision
    to the backend (``ws.backend.get_incompatible_metrics`` — the watchlist
    and ``suggested_fix`` prose are owned there, not here, so a second backend
    declares its own vocabulary), and wraps each returned advisory in the
    ``severity="warning"`` envelope. ``warning`` (not ``error``) so the banner
    advises but does not gate Fit — the underlying fit path may skip the metric
    or surface a clearer mid-fold error, but no data is destroyed by trying.

    Short-circuits to an empty list when no data is loaded, when the target
    column is missing, or when ``evaluation.metrics`` is empty / unparsable.
    Defensive on every layer because ``validate_config`` runs against
    arbitrary user input that the schema layer may also have rejected.
    """
    if ws.dataframe is None or not isinstance(config, dict):
        return []
    data = config.get("data")
    if not isinstance(data, dict):
        return []
    target = data.get("target")
    if not isinstance(target, str) or target not in ws.dataframe.columns:
        return []
    evaluation = config.get("evaluation")
    metrics = evaluation.get("metrics") if isinstance(evaluation, dict) else None
    if not isinstance(metrics, list) or not metrics:
        return []
    metric_names = {
        name for entry in metrics if (name := _metric_entry_name(entry)) is not None
    }
    if not metric_names:
        return []

    task = config.get("task")
    incompatible = ws.backend.get_incompatible_metrics(
        task if isinstance(task, str) else "",
        ws.dataframe[target],
        metric_names,
    )
    return [
        {
            "path": "evaluation.metrics",
            "message": entry.message,
            "severity": "warning",
            "suggested_fix": entry.suggested_fix,
        }
        for entry in incompatible
    ]


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
