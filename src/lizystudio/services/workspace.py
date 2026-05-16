"""Workspace volatile state — lives in app.state, injected via Depends."""

from __future__ import annotations

import copy
import dataclasses
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import Request
from pydantic import ValidationError

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.types import (
    DataRef,
    FitSummary,
    TuningConfig,
    TuningOverrides,
    TuningSummary,
)


@dataclass
class WorkspaceState:
    """Mutable workspace state (per-process, volatile)."""

    backend: BackendAdapter
    config: dict[str, Any] = field(default_factory=dict)
    data_ref: DataRef | None = None
    dataframe: pd.DataFrame | None = None
    model: Any = None
    # P-0109 PR-4b: sparse Tune intent — the SSOT for the Tune tab.
    # Workspace persists ONLY user-set fields here (catalog defaults are
    # re-derived on demand by ``adapter.compute_effective_tuning``).
    # ``None`` means "never touched"; an empty ``TuningOverrides()``
    # instance means "explicitly cleared to catalog defaults". The two
    # are equivalent for effective computation but the distinction
    # survives across PUTs via Pydantic ``model_fields_set``.
    tuning_overrides: TuningOverrides | None = None
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
            self.tuning_overrides = None
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

    def set_tuning_overrides(self, overrides: TuningOverrides | None) -> None:
        """Replace the persisted Tune intent (P-0109 PR-4b).

        Passing ``None`` clears the intent so the next effective
        computation falls back to pure catalog defaults. Threads writing
        the workspace state concurrently are serialised through the same
        lock as :meth:`set_config`.
        """
        with self._lock:
            self.tuning_overrides = overrides

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


# --- Tune intent/effective split (P-0109 PR-4a) ------------------------------
#
# These helpers project the legacy ``config["tuning"]`` shape onto the
# P-0109 ``TuningOverrides`` type (and back) so the Tune-tab snapshot
# endpoint can answer ``GET /config/tuning-snapshot`` without owning the
# storage rename — that's PR-4b's job. The helpers keep the workspace
# in-memory storage unchanged (still ``ws.config["tuning"]`` in the
# legacy nested shape) while the API surface starts speaking the new
# two-layer (overrides + effective) language to the frontend.


def extract_overrides_from_legacy_tuning(
    tuning: Any,
) -> TuningOverrides:
    """Project a legacy ``config["tuning"]`` block onto :class:`TuningOverrides`.

    The legacy shape is nested
    (``{optuna: {params, space}, evaluation, model_params, training}``);
    :class:`TuningOverrides` is flat (``n_trials``, ``timeout``,
    ``direction``, ``space``, ``evaluation_metrics``). Only the
    intersection maps cleanly — ``model_params`` / ``training`` are
    LizyML-specific overrides that the Tune-tab snapshot does not
    expose. PR-4b widens this mapping (or moves storage) once the
    architectural rename ships.

    ``None`` / missing / malformed input is tolerated: an empty
    :class:`TuningOverrides` is returned rather than raising. This keeps
    the snapshot endpoint robust to fresh workspaces and in-progress
    edits.

    Each scalar field is added to ``model_fields_set`` only when present
    in the input — so a workspace that has never set ``timeout``
    presents as "not touched" rather than as "explicit None", preserving
    the INV-T1 distinction.
    """
    if not isinstance(tuning, dict):
        return TuningOverrides()
    data: dict[str, Any] = {}
    optuna = tuning.get("optuna")
    if isinstance(optuna, dict):
        params = optuna.get("params")
        if isinstance(params, dict):
            for key in ("n_trials", "timeout", "direction"):
                if key in params:
                    data[key] = params[key]
        space = optuna.get("space")
        if isinstance(space, dict) and space:
            data["space"] = {k: v for k, v in space.items() if isinstance(v, dict)}
    evaluation = tuning.get("evaluation")
    if isinstance(evaluation, dict):
        metrics = evaluation.get("metrics")
        if isinstance(metrics, list):
            data["evaluation_metrics"] = list(metrics)
    try:
        return TuningOverrides.model_validate(data)
    except ValidationError:
        # Malformed legacy state (e.g. n_trials="50" as a string from an
        # ancient persisted workspace) — fall back to an empty intent so
        # the snapshot endpoint still answers and the frontend can
        # re-establish the state via a fresh PUT.
        return TuningOverrides()


def materialize_overrides_into_legacy_tuning(
    effective: TuningConfig,
    *,
    current_tuning: Any = None,
) -> dict[str, Any]:
    """Materialize a :class:`TuningConfig` back into the legacy nested shape.

    Produces a fresh dict suitable for assignment to
    ``config["tuning"]``. ``current_tuning`` (the previous legacy block,
    if any) is mined for non-Tune-overrides keys —
    ``optuna.params``-keys outside the four canonical ones,
    ``model_params``, and ``training`` — so a user's
    LizyML-only overrides survive a Tune-tab edit.

    The four canonical ``optuna.params`` keys are
    ``n_trials`` / ``timeout`` / ``direction`` plus any extras the user
    had set (e.g. ``study_name``). Re-tune state
    (``tuning.re_tune``) is also preserved.
    """
    existing: dict[str, Any] = (
        copy.deepcopy(current_tuning) if isinstance(current_tuning, dict) else {}
    )
    raw_optuna = existing.get("optuna")
    existing_optuna: dict[str, Any] = raw_optuna if isinstance(raw_optuna, dict) else {}
    raw_params = existing_optuna.get("params")
    existing_params: dict[str, Any] = raw_params if isinstance(raw_params, dict) else {}

    materialized_params: dict[str, Any] = dict(existing_params)
    materialized_params["n_trials"] = effective.n_trials
    materialized_params["timeout"] = effective.timeout
    materialized_params["direction"] = effective.direction

    out: dict[str, Any] = dict(existing)
    out["optuna"] = {
        **existing_optuna,
        "params": materialized_params,
        "space": dict(effective.space),
    }
    if effective.evaluation_metrics:
        out["evaluation"] = {"metrics": list(effective.evaluation_metrics)}
    elif "evaluation" in out:
        # Preserve a user-cleared metric list as ``[]`` so PUT semantics
        # round-trip — the alternative would silently re-seed defaults
        # the user just deleted.
        out["evaluation"] = {"metrics": []}
    return out


def _current_overrides(ws: WorkspaceState) -> TuningOverrides:
    """Return ``ws.tuning_overrides`` defaulted to an empty intent.

    Hides the ``None`` sentinel from callers that only need to compute
    an effective config — they treat "never touched" and "explicit
    empty" the same way. The distinction still surfaces via
    :attr:`TuningOverrides.model_fields_set` for callers that need it.
    """
    return ws.tuning_overrides if ws.tuning_overrides is not None else TuningOverrides()


def _current_task(ws: WorkspaceState) -> str:
    return str(ws.config.get("task", "")) if isinstance(ws.config, dict) else ""


def get_tuning_snapshot(ws: WorkspaceState) -> dict[str, Any]:
    """Build the response payload for ``GET /config/tuning-snapshot``.

    Returns ``{"tuning_effective", "tuning_defaults", "tuning_overrides"}``
    where each side is a plain dict the frontend consumes via the
    openapi-typescript surface. PR-4b makes ``ws.tuning_overrides`` the
    sole source of Tune intent — the snapshot endpoint reads it
    directly instead of extracting from legacy ``ws.config["tuning"]``.

    PR-6c adds ``tuning_overrides`` to the payload so the frontend can
    compute a future write body without round-tripping through the
    legacy ``GET/PUT /config`` shim. ``user_set_paths`` on the
    effective config is also consumed by the Tune-tab "modified"
    badge — both sides live on the same payload so a single
    ``useTuningSnapshot`` subscription drives both the read view and
    the badge state.
    """
    task = _current_task(ws)
    overrides = _current_overrides(ws)
    effective = ws.backend.compute_effective_tuning(task, overrides)
    defaults = ws.backend.get_tuning_defaults(task)
    return {
        "tuning_effective": effective.model_dump(mode="json"),
        "tuning_defaults": dataclasses.asdict(defaults),
        "tuning_overrides": overrides.model_dump(mode="json"),
    }


def update_tuning_overrides(
    ws: WorkspaceState,
    overrides: TuningOverrides,
) -> dict[str, Any]:
    """Persist *overrides* as the sole Tune intent (P-0109 PR-4b).

    Replaces ``ws.tuning_overrides`` outright (no merge with prior
    intent — the body is the full sparse intent). Echoes the resulting
    effective config so the caller can refresh its local state in a
    single round-trip.

    PR-4b removes the PR-4a write-back into ``ws.config["tuning"]`` —
    the legacy nested form is no longer the storage. ``workspace_tune``
    materializes the effective config into ``job.config["tuning"]`` at
    job-start time (INV-T6), and ``GET /config`` synthesizes the same
    block for legacy callers via :func:`get_legacy_config_view`.

    INV-T2 (P-0109): catalog evolution automatically propagates because
    catalog-only space keys are not stored — they're re-derived from
    ``adapter.get_tuning_defaults`` on every effective computation.
    """
    task = _current_task(ws)
    ws.set_tuning_overrides(overrides)
    effective = ws.backend.compute_effective_tuning(task, overrides)
    return {"tuning_effective": effective.model_dump(mode="json")}


def get_legacy_config_view(ws: WorkspaceState) -> dict[str, Any]:
    """Project ``ws.config`` + ``ws.tuning_overrides`` into the legacy shape.

    PR-4b stores ``tuning_overrides`` as a first-class workspace field;
    legacy callers (``GET /config`` consumers, YAML download, the
    pre-PR-5 frontend that still reads ``config.tuning``) keep seeing a
    ``config["tuning"]`` block synthesised here on demand.

    Sparse-emit invariant: the synthesised ``tuning`` block contains
    ONLY the fields the user explicitly set in
    ``ws.tuning_overrides`` (tracked via Pydantic ``model_fields_set``).
    This preserves the pre-PR-4b semantic that ``GET /config`` returns
    "what was PUT" — the legacy frontend treats absent fields as
    "user has not touched" and falls back to local UI defaults
    (e.g. N Trials SegmentedControl default = 50). The fully-materialised
    effective view (with all catalog defaults filled in) lives at
    ``GET /config/tuning-snapshot``, which PR-5 frontend consumes.

    INV-T6 (job-time freeze) is unaffected: ``materialize_tuning_for_job``
    *always* emits the complete effective into ``job.config["tuning"]``
    so tune jobs run with full optuna params + space regardless of
    sparseness here.
    """
    if not isinstance(ws.config, dict):
        return {}
    overrides = ws.tuning_overrides
    if overrides is None:
        return dict(ws.config)
    fields_set = overrides.model_fields_set
    out = dict(ws.config)
    optuna_params: dict[str, Any] = {}
    if "n_trials" in fields_set:
        optuna_params["n_trials"] = overrides.n_trials
    if "timeout" in fields_set:
        optuna_params["timeout"] = overrides.timeout
    if "direction" in fields_set:
        optuna_params["direction"] = overrides.direction
    optuna: dict[str, Any] = {}
    if optuna_params:
        optuna["params"] = optuna_params
    if overrides.space:
        optuna["space"] = {k: dict(v) for k, v in overrides.space.items()}
    tuning: dict[str, Any] = {}
    if optuna:
        tuning["optuna"] = optuna
    if "evaluation_metrics" in fields_set and overrides.evaluation_metrics is not None:
        tuning["evaluation"] = {"metrics": list(overrides.evaluation_metrics)}
    if tuning:
        out["tuning"] = tuning
    return out


def absorb_legacy_tuning(ws: WorkspaceState, config: dict[str, Any]) -> dict[str, Any]:
    """Extract ``config["tuning"]`` into ``ws.tuning_overrides`` (P-0109 PR-4b).

    Compat shim for legacy PUT /config payloads. The pre-PR-5 frontend
    still sends the materialized ``tuning`` block alongside the rest of
    the config; this helper diverts that block into the sparse intent
    store and returns the config WITHOUT the ``tuning`` key so the
    storage rename stays consistent. PUT /config flows that omit
    ``tuning`` leave ``ws.tuning_overrides`` unchanged.

    Returns a fresh dict (input is not mutated).
    """
    if not isinstance(config, dict):
        return {}
    if "tuning" not in config:
        return dict(config)
    tuning = config["tuning"]
    overrides = extract_overrides_from_legacy_tuning(tuning)
    # Always store the absorbed overrides — even an empty intent is a
    # meaningful "user cleared tune state" signal. ``None`` is reserved
    # for "never touched" (post-reset, fresh workspace).
    ws.set_tuning_overrides(overrides)
    stripped = {k: v for k, v in config.items() if k != "tuning"}
    return stripped


def materialize_tuning_for_job(ws: WorkspaceState) -> dict[str, Any]:
    """Build the per-job config snapshot with the effective ``tuning`` block.

    Implements INV-T6 (P-0109 PR-4b): the job's persisted config must
    remain stable even as the catalog evolves. The effective Tune
    config is computed once here — from
    :attr:`WorkspaceState.tuning_overrides` if the user touched any
    Tune state, or from an empty :class:`TuningOverrides` (which the
    adapter resolves to pure catalog defaults) otherwise — and frozen
    into the returned dict.

    Unlike :func:`get_legacy_config_view`, this helper *always*
    materializes a ``tuning`` block: every tune job needs concrete
    Optuna params + direction + space at run time, regardless of
    whether the user ever opened the Tune tab. The caller hands the
    result to ``job_store.create_and_claim_active`` so ``job.config``
    carries the snapshot for the lifetime of the job (and on disk via
    ``meta.json``).
    """
    if not isinstance(ws.config, dict):
        return {}
    overrides = _current_overrides(ws)
    effective = ws.backend.compute_effective_tuning(_current_task(ws), overrides)
    out = dict(ws.config)
    out["tuning"] = materialize_overrides_into_legacy_tuning(
        effective, current_tuning=ws.config.get("tuning")
    )
    return out
