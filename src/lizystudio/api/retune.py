"""Re-tune / Resume / Lineage API endpoints (H-0062 Phase B).

Extracted from ``api/jobs.py`` (H-0062 cleanup) so the retune-specific
validation, lock management, and request/response models can evolve
independently of the standard CRUD endpoints. The endpoints live on the
same ``router`` instance imported from ``api.jobs`` so URL paths and
``app.include_router`` wiring are unchanged.
"""

from __future__ import annotations

from typing import Any

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict

from lizystudio.api.errors import (
    JobNotCompletedError,
    JobNotFoundError,
    ParentLockedError,
    StudioError,
)
from lizystudio.api.errors import (
    PickleIncompatibleError as PickleIncompatibleApiError,
)
from lizystudio.api.jobs import _get_job_or_404, router
from lizystudio.services.jobs import Job, JobStore, get_job_store
from lizystudio.services.workspace import WorkspaceState, get_workspace

# Hard upper bound on Re-tune / Resume n_trials. Mirrors lizyml's
# _MAX_RE_TUNE_TRIALS_PER_ROUND so a Re-tune child cannot smuggle
# a larger workload than a Phase A re_tune round could.
_MAX_RETUNE_TRIALS = 10_000


class RetuneRequest(BaseModel):
    """Body of ``POST /api/jobs/{id}/retune``.

    Uses ``extra='forbid'`` so unknown fields are rejected rather than
    silently dropped (CLAUDE.md Python security rule, H-0062 review).
    """

    model_config = ConfigDict(extra="forbid")

    n_trials: int
    expand_boundary: bool | None = None
    boundary_threshold: float | None = None


class ResumeRequest(BaseModel):
    """Body of ``POST /api/jobs/{id}/resume``."""

    model_config = ConfigDict(extra="forbid")

    n_trials: int | None = None


def _validate_n_trials(n_trials: int) -> int:
    if n_trials < 1:
        raise StudioError("INVALID_PARAM", f"n_trials must be >= 1, got {n_trials}")
    if n_trials > _MAX_RETUNE_TRIALS:
        raise StudioError(
            "INVALID_PARAM",
            f"n_trials must be <= {_MAX_RETUNE_TRIALS}, got {n_trials}",
        )
    return n_trials


def _validate_boundary_threshold(threshold: float | None) -> None:
    """Mirror lizyml's ``Model.tune`` constraint at the API layer.

    Without this, an out-of-range value would only fail asynchronously
    inside the worker thread, leaving the user staring at a generic
    "child failed" error instead of an immediate 400.
    """
    if threshold is None:
        return
    if not (0.0 < threshold < 0.5):
        raise StudioError(
            "INVALID_PARAM",
            f"boundary_threshold must be in (0.0, 0.5), got {threshold}",
        )


def _require_tune_job_with_checkpoint(parent: Job, job_store: JobStore) -> None:
    """Validate that *parent* can host a Re-tune / Resume child (H-0062).

    H-0062 Decision 2026-04-14: Grandchild retune (re-tuning a retune
    child) is now allowed. Each child carries its own model.pkl that
    continues the Optuna study, so chaining A -> B -> C is a natural
    extension of the Re-tune UX and matches user expectations. The
    original MVP restriction was removed after UX feedback showed users
    naturally expected to continue tuning from the latest result
    instead of jumping back to the original parent.

    The remaining checks are structural (tune job, model.pkl present)
    plus the synchronous pickle compatibility check so a version
    mismatch surfaces as ``PICKLE_INCOMPATIBLE`` (400) on the POST
    itself rather than as a failed background child job.
    """
    if parent.job_type != "tune":
        raise StudioError(
            "INVALID_PARAM",
            f"Job {parent.job_id} is not a tune job (type={parent.job_type})",
        )
    parent_dir = job_store.jobs_dir / parent.job_id
    checkpoint = parent_dir / "model.pkl"
    if not checkpoint.exists():
        raise StudioError(
            "CHECKPOINT_MISSING",
            (
                f"Job {parent.job_id} has no model.pkl checkpoint; "
                "re-tune/resume unavailable"
            ),
        )
    # H-0062: check pickle metadata if present. Missing meta is
    # tolerated (legacy / pre-H-0062 checkpoints) -- only the explicit
    # mismatch case raises. A meta file that exists but is corrupted
    # (truncated write, partial atomic rename failure, manual edit) is
    # treated as an incompatible checkpoint rather than a 500 -- the
    # user can recover by deleting the parent and re-tuning.
    meta_path = parent_dir / "model_meta.json"
    if meta_path.exists():
        import json as _json

        from lizystudio.backends.lizyml import (
            PickleIncompatibleError as _AdapterIncompatible,
        )
        from lizystudio.backends.lizyml import (
            verify_pickle_compatibility,
        )

        try:
            meta = _json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, _json.JSONDecodeError) as exc:
            raise PickleIncompatibleApiError(
                f"Corrupted model_meta.json for {parent.job_id}: {exc}"
            ) from exc
        try:
            verify_pickle_compatibility(meta)
        except _AdapterIncompatible as exc:
            raise PickleIncompatibleApiError(str(exc)) from exc


def _claim_retune_slot(parent_job_id: str, job_store: JobStore) -> str:
    """Return the placeholder that must be swapped in later via rebind.

    The lock is acquired with a provisional placeholder so we never
    leave the slot held if child creation fails.
    """
    placeholder = f"pending_{parent_job_id}"
    if not job_store.acquire_parent_lock(parent_job_id, placeholder):
        raise ParentLockedError(
            parent_job_id, job_store.get_locked_child(parent_job_id)
        )
    return placeholder


def _get_broadcaster(request: Request) -> Any:
    """Pull the ProgressBroadcaster off the app state (H-0062)."""
    return request.app.state.broadcaster


@router.post("/{job_id}/retune")
def retune_job(
    job_id: str,
    body: RetuneRequest,
    request: Request,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Start a Re-tune child job from a completed parent Tune (H-0062)."""
    from lizystudio.services.training import start_retune_async

    parent = _get_job_or_404(job_id, job_store)
    if parent.status != "completed":
        raise JobNotCompletedError(job_id)
    _require_tune_job_with_checkpoint(parent, job_store)
    _validate_n_trials(body.n_trials)
    _validate_boundary_threshold(body.boundary_threshold)

    placeholder = _claim_retune_slot(job_id, job_store)
    # Single try/except so a failure path never double-releases. On a
    # successful start_retune_async return the lock stays held and is
    # released by the launcher's own finally block when the worker
    # thread eventually finishes (success / failure / cancellation).
    started = False
    try:
        child = job_store.create(
            backend_name=parent.backend_name,
            config=parent.config,
            data_ref=parent.data_ref,
            job_type="tune",
            parent_job_id=parent.job_id,
        )
        # H-0062 Bugfix 2026-04-14 (4): atomic placeholder -> child
        # rebind. The previous release+acquire pair opened a race
        # window where another request could claim the slot between
        # the two operations and the second acquire silently returned
        # False. rebind_parent_lock does the swap under the single
        # mutex so no window exists.
        if not job_store.rebind_parent_lock(parent.job_id, placeholder, child.job_id):
            # Another request stole the slot between claim and rebind.
            # Surface it as a 409 so the caller can retry, and
            # explicitly remove the newly-created child so it does not
            # leak as an orphan pending row.
            job_store.delete(child.job_id)
            raise ParentLockedError(
                parent.job_id, job_store.get_locked_child(parent.job_id)
            )

        start_retune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=_get_broadcaster(request),
            parent_job=parent,
            child_job=child,
            n_trials=body.n_trials,
            expand_boundary=body.expand_boundary,
            boundary_threshold=body.boundary_threshold,
            mode="retune",
        )
        started = True
    finally:
        if not started:
            job_store.release_parent_lock(parent.job_id)
    return {"job_id": child.job_id, "parent_job_id": parent.job_id}


@router.post("/{job_id}/resume")
def resume_job(
    job_id: str,
    body: ResumeRequest,
    request: Request,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Resume a failed Tune Job from its last saved checkpoint (H-0062)."""
    from lizystudio.services.training import start_retune_async

    parent = _get_job_or_404(job_id, job_store)
    if parent.status != "failed":
        raise StudioError(
            "JOB_NOT_FAILED",
            f"Resume is only available on failed tune jobs (status={parent.status})",
        )
    _require_tune_job_with_checkpoint(parent, job_store)

    # Auto-compute remaining trials from original config when not provided.
    n_trials = body.n_trials
    if n_trials is None:
        n_trials = _auto_remaining_trials(parent)
    _validate_n_trials(n_trials)

    placeholder = _claim_retune_slot(job_id, job_store)
    started = False
    try:
        child = job_store.create(
            backend_name=parent.backend_name,
            config=parent.config,
            data_ref=parent.data_ref,
            job_type="tune",
            parent_job_id=parent.job_id,
        )
        # H-0062 Bugfix 2026-04-14 (4): atomic rebind, see retune_job.
        if not job_store.rebind_parent_lock(parent.job_id, placeholder, child.job_id):
            job_store.delete(child.job_id)
            raise ParentLockedError(
                parent.job_id, job_store.get_locked_child(parent.job_id)
            )

        start_retune_async(
            ws=ws,
            job_store=job_store,
            broadcaster=_get_broadcaster(request),
            parent_job=parent,
            child_job=child,
            n_trials=n_trials,
            expand_boundary=None,
            boundary_threshold=None,
            mode="resume",
        )
        started = True
    finally:
        if not started:
            job_store.release_parent_lock(parent.job_id)
    return {"job_id": child.job_id, "parent_job_id": parent.job_id}


def _auto_remaining_trials(parent: Job) -> int:
    """Compute remaining trials for a failed Tune Job (H-0062).

    For Phase A multi-round parents, the "original" trial count is
    ``n_rounds * n_trials_per_round``. ``tune_result.trials`` contains
    the cumulative count across every round that actually ran, so the
    remainder is ``(expected_total - completed)`` clamped at >= 1.

    For legacy single-round parents ``n_rounds`` defaults to 1 and
    the math reduces to ``n_trials - completed``.
    """
    config = parent.config or {}
    tuning = config.get("tuning") or {}
    optuna = tuning.get("optuna") or {}
    params = optuna.get("params") or {}
    per_round = int(params.get("n_trials", 50))
    re_tune = tuning.get("re_tune") or {}
    n_rounds_raw = re_tune.get("n_rounds", 1) if isinstance(re_tune, dict) else 1
    try:
        n_rounds = max(1, int(n_rounds_raw))
    except (TypeError, ValueError):
        n_rounds = 1
    expected_total = per_round * n_rounds
    completed = 0
    if parent.tune_result is not None and parent.tune_result.trials:
        completed = len(parent.tune_result.trials)
    return max(1, expected_total - completed)


@router.get("/{job_id}/lineage")
def get_job_lineage(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Return the lineage subtree rooted at *job_id* (H-0062)."""
    tree = job_store.get_lineage_tree(job_id)
    if tree is None:
        raise JobNotFoundError(job_id)
    return {"tree": tree}
