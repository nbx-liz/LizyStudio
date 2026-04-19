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


__all__ = [
    "CancelledError",
    "CheckpointIncompatibleError",
    "CheckpointPreflightError",
]
