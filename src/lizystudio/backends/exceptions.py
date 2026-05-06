"""Common backend-layer exceptions (H-0068).

Moving these types here lets the service and API layers catch them
without importing from any specific backend package, and lets adapters
signal cancellation / checkpoint-incompatibility through a stable
contract.

Historical locations re-export from this module for backwards
compatibility — identity is preserved so ``except CancelledError``
catches across :mod:`lizystudio.services.training`,
:mod:`lizystudio.services._training_core`, and backend mixins all
match the same class.
"""

from __future__ import annotations


class CancelledError(Exception):
    """Raised when a long-running backend operation is cancelled.

    Adapters may raise this directly from a progress-callback bridge to
    short-circuit ``fit`` / ``tune`` when :func:`JobStore.is_cancel_requested`
    returns ``True``.
    """


class PausedError(Exception):
    """Raised when a long-running backend operation observes a pause request.

    Pause is the first non-terminal mid-flight unwind in the Job state
    machine (P-0099 R-1.4 / v3-20).  ``_run_job_core`` catches this in a
    dedicated except-branch that writes ``status="paused"`` and KEEPS
    ownership of ``active_job_id`` so the same job id can be resumed in
    place via the /unpause endpoint — pre-fix the cancel/failure finally
    block would have released the slot, defeating in-place resume.

    Adapters raise this from a progress-callback bridge when
    :meth:`JobStore.is_pause_requested` returns ``True``, mirroring the
    cancel observation point so the subprocess child's fresh JobStore can
    react via the on-disk PAUSE flag.
    """


class CheckpointIncompatibleError(Exception):
    """Raised when a previously-saved checkpoint cannot be loaded.

    Typical reasons:

    - pickle schema version mismatch
    - ML backend version mismatch
    - corrupted / truncated sidecar ``model_meta.json``

    Adapters translate their own pickle / dependency errors into this
    type so the API layer can return a consistent envelope without
    importing backend-specific symbols.
    """


class CheckpointPreflightError(Exception):
    """Raised when the target directory cannot host a checkpoint.

    Signalled by :meth:`BackendCore.preflight_checkpoint_dir` before
    tuning starts so the caller can fail fast (directory not writable,
    serialization library cannot round-trip, etc.).  The service layer
    translates this to
    :class:`~lizystudio.api.errors.PicklePreflightFailedError` for the
    HTTP envelope.
    """


class IncompatibleFormatVersionError(Exception):
    """Raised when an on-disk JSON artefact carries a ``format_version``
    this runtime does not know how to read (C-9 / H-0081).

    The storage layer tolerates missing ``format_version`` keys by
    treating them as v0 and running the identity migration, so existing
    workspaces keep loading without user action. Unknown versions (e.g.
    a workspace written by a future runtime) surface through this
    exception so the user sees a clear error rather than silently
    corrupted state.
    """


class PlotNotAvailableError(Exception):
    """Raised when a plot type is not in the backend's dispatch table
    (Issue #355).

    The lizyml ``EvaluationMixin`` dispatch is a closed enumeration;
    any request for a plot type the backend does not advertise is a
    client-side mistake (or a frontend that has not yet been told the
    backend's capabilities). The API layer translates this to HTTP
    404 with code ``PLOT_NOT_AVAILABLE``, so the caller can recover
    gracefully without seeing a server-error envelope.

    Pre-fix the backend raised a bare ``ValueError`` here, which the
    API funnelled through ``except Exception: raise BackendError`` and
    emitted as a 500 — that hid every Inference run's SHAP fan-out
    behind a scary console error during the v0.3.0 release rehearsal.
    """

    def __init__(self, plot_type: str, available: list[str]) -> None:
        super().__init__(
            f"Plot type {plot_type!r} is not available (available: {available})"
        )
        self.plot_type = plot_type
        self.available = available


__all__ = [
    "CancelledError",
    "CheckpointIncompatibleError",
    "CheckpointPreflightError",
    "IncompatibleFormatVersionError",
    "PausedError",
    "PlotNotAvailableError",
]
