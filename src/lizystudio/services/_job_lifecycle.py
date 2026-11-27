"""The job lifecycle transition primitive (P-0119, Issues #613 / #697).

One lock in the parent process (``JobLifecycle.lock``) guards every change
of a job's status, its cancel / pause flags, the active slot, the per-job
run tokens and the lifecycle reset generation. Status changes take exactly
three forms:

- **settle** (no live token; ``pending`` / ``paused`` only),
- **commit** of a live token (``commit`` / ``abort`` / ``force_release``),
- **recover** at process start, before the API and launchers run.

Every operation returns the :class:`LifecycleEffects` it owes and the caller
emits them after the lock is released; the lock is never held across a
join, ``Popen``, a child wait, a broadcast or a metric.

Lock order (BLUEPRINT §3.4.2): ``JobLifecycle.lock`` → ``ActiveJobSlot``'s
lock → ``JobControlFlags``' cancel / pause locks (leaves). ``WorkspaceState``'s
lock is disjoint: neither is taken while the other is held.

This module holds the admission / commit half; the API-facing operations
(cancel, pause, reset, force-release, recover, delete) are in
:mod:`lizystudio.services._job_lifecycle_ops`.
"""

from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from typing import Any

from lizystudio.services._job_active_slot import ActiveJobSlot
from lizystudio.services._job_control_flags import JobControlFlags
from lizystudio.services._job_lifecycle_ops import LifecycleOps
from lizystudio.services._job_lifecycle_types import (
    CANCELLED_CODE,
    CANCELLED_MESSAGE,
    LEGAL_TRANSITIONS,
    TERMINAL_STATUSES,
    AdmissionReason,
    AdmissionRefused,
    ExpectedStatus,
    IllegalTransitionError,
    LifecycleEffects,
    Outcome,
    RecoverRefusedError,
    RunToken,
    SlotRule,
)
from lizystudio.services._job_metadata import Job, JobMetadataStore
from lizystudio.services._job_outcome_file import remove_outcome

_logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(UTC).isoformat()


class JobLifecycle(LifecycleOps):
    """Admission, the start gate and the token commit (P-0119 Option A)."""

    def __init__(
        self,
        meta: JobMetadataStore,
        slot: ActiveJobSlot,
        flags: JobControlFlags,
    ) -> None:
        self._meta = meta
        self._slot = slot
        self._flags = flags
        self.lock = threading.Lock()
        self._tokens: dict[str, RunToken] = {}
        self._last_run_gen = 0
        self._reset_gen = 0
        self._started = False
        # INV-LC-5 for notifications: every token removal and every
        # token-fenced frame take this gate, so a frame is either sent while
        # its run is live or dropped. Lock order: ``lock`` -> ``_emit_gate``;
        # an emitter takes only the gate (never ``lock``), so a broadcast is
        # never made under the lifecycle lock.
        self._emit_gate = threading.Lock()

    # --- reset generation and reservations -----------------------------

    def capture_reset_gen(self) -> int:
        """The lifecycle reset generation, for a request to pass to ``admit``."""
        with self.lock:
            return self._reset_gen

    def create_and_reserve(self, **create: Any) -> tuple[Job, int] | None:
        """Create a ``pending`` job holding the slot (the ``/fit`` / ``/tune``
        reservation) and return it with the reset generation of this request.

        ``None`` when another job holds the slot. A holder with a live run
        token is never treated as stale, whatever its row on disk says.
        """
        with self.lock:
            holder = self._slot.active_job_id
            if holder is not None and holder in self._tokens:
                return None
            job = self._slot.create_and_claim(**create)
            return None if job is None else (job, self._reset_gen)

    def create_child(self, **create: Any) -> tuple[Job, int]:
        """Create a retune / resume child (no slot) and the request's generation."""
        with self.lock:
            return self._meta.create(**create), self._reset_gen

    # --- admission and the start gate -----------------------------------

    def admit(
        self,
        job_id: str,
        *,
        expect: ExpectedStatus,
        reset_gen: int,
        slot_rule: SlotRule,
    ) -> RunToken:
        """Admit one run of *job_id*: write ``running`` and issue its token.

        Raises :class:`AdmissionRefused`; a refused ``pending`` job is settled
        (``cancelled`` after a reset or a cancel, ``failed`` otherwise) and the
        refusal carries that settle's effects.
        """
        with self.lock:
            job = self._meta.get(job_id)
            reason = self._admit_checks_locked(
                job, job_id, expect, reset_gen, slot_rule
            )
            if reason is None and job is not None:
                return self._admit_locked(job, slot_rule)
            effects = self._settle_refused_locked(job, expect, reason)
            status = None if job is None else job.status
        raise AdmissionRefused(job_id, reason or "status", status, effects)

    def _admit_checks_locked(
        self,
        job: Job | None,
        job_id: str,
        expect: ExpectedStatus,
        reset_gen: int,
        slot_rule: SlotRule,
    ) -> AdmissionReason | None:
        """The admission preconditions, in their order (a test seam: it runs
        under the lock, so holding it here holds every lifecycle operation)."""
        if not self._same_reset_gen_locked(reset_gen):
            return "reset_gen"
        if job is None or job.status != expect:
            return "status"
        if self._flags.is_cancel_requested(job_id):
            return "cancel"
        if job_id in self._tokens:
            return "live"
        holder = self._slot.active_job_id
        if slot_rule == "claim":
            return None if holder in (None, job_id) else "slot"
        return None if holder == job_id else "slot"

    def _admit_locked(self, job: Job, slot_rule: SlotRule) -> RunToken:
        self._write_status_locked(job.job_id, "running", error=None, completed_at=None)
        if slot_rule == "claim":
            self._slot.claim(job.job_id)
        self._flags.clear_pause(job.job_id)
        remove_outcome(self._meta.path_for(job.job_id, "outcome"))
        self._last_run_gen += 1
        origin: ExpectedStatus = "paused" if job.status == "paused" else "pending"
        token = RunToken(job.job_id, self._last_run_gen, origin)
        self._tokens[job.job_id] = token
        return token

    def _settle_refused_locked(
        self,
        job: Job | None,
        expect: ExpectedStatus,
        reason: AdmissionReason | None,
    ) -> LifecycleEffects | None:
        if job is None or expect != "pending" or job.status != "pending":
            return None
        if job.job_id in self._tokens:
            return None
        if reason in ("reset_gen", "cancel"):
            return self._settle_locked(job, "cancelled", None)
        return self._settle_locked(
            job, "failed", "Another job is already running", code="JOB_CONFLICT"
        )

    def start(self, token: RunToken) -> bool:
        """The start gate: True while *token* is live (checked right before
        the worker thread starts)."""
        with self.lock:
            return self._is_live_locked(token)

    def is_live(self, token: RunToken) -> bool:
        """True while *token* is the job's live run token."""
        with self.lock:
            return self._is_live_locked(token)

    def _is_live_locked(self, token: RunToken) -> bool:
        """The token fence (INV-LC-5): *token* is its job's live run token."""
        return self._tokens.get(token.job_id) == token

    def _same_reset_gen_locked(self, reset_gen: int) -> bool:
        """The generation fence (INV-LC-6): no reset since *reset_gen*."""
        return reset_gen == self._reset_gen

    def _revoke_locked(self, job_id: str) -> RunToken | None:
        """Remove *job_id*'s token (caller holds ``lock``), through the emit
        gate so no fenced frame of that run is in flight."""
        with self._emit_gate:
            return self._tokens.pop(job_id, None)

    # --- commit and abort ----------------------------------------------

    def commit(self, token: RunToken, outcome: Outcome) -> LifecycleEffects | None:
        """Publish *outcome* for a live *token*; ``None`` (logged) if revoked.

        A write that fails before it lands consumes nothing and raises, so the
        caller can commit ``failed`` with the same token (P-0119 §0.6).
        """
        with self.lock:
            return self._commit_locked(token, outcome)

    def _commit_locked(
        self, token: RunToken, outcome: Outcome
    ) -> LifecycleEffects | None:
        if not self._is_live_locked(token):
            _logger.warning(
                "event='lifecycle.stale_commit_dropped' job=%s run=%d status=%s",
                token.job_id,
                token.run_gen,
                outcome.status,
            )
            return None
        job = self._meta.load_job(token.job_id)
        final = self._resolve_locked(job, outcome)
        self._write_outcome_locked(job, final)
        self._revoke_locked(token.job_id)
        self._settle_flags_and_slot_locked(job.job_id, final.status)
        return self._effects(job, final)

    def abort(self, token: RunToken, error: str) -> LifecycleEffects | None:
        """Undo an admission whose worker never ran (join / start failure,
        missing data): ``cancelled`` with CANCEL, back to ``paused`` (slot
        kept) for an unpause, ``failed`` otherwise."""
        status = "paused" if token.origin == "paused" else "failed"
        return self.commit(token, Outcome(status=status, error=error, message=error))  # type: ignore[arg-type]

    def _resolve_locked(self, job: Job, outcome: Outcome) -> Outcome:
        """Apply the priorities: an accepted cancel wins over every other
        outcome (Q2, INV-LC-4)."""
        if not self._flags.is_cancel_requested(job.job_id):
            return outcome
        if outcome.status == "cancelled":
            return outcome
        return Outcome(
            status="cancelled", code=CANCELLED_CODE, message=CANCELLED_MESSAGE
        )

    def _write_outcome_locked(self, job: Job, outcome: Outcome) -> None:
        # A ``paused`` row carries no error and no completion time (an
        # unpause whose launch failed goes back to a clean ``paused``).
        paused = outcome.status == "paused"
        self._write_status_locked(
            job.job_id,
            outcome.status,
            error=None if paused else outcome.error,
            completed_at=None if paused else _now(),
        )

    def _settle_flags_and_slot_locked(self, job_id: str, status: str) -> None:
        if status == "paused":
            self._flags.clear_pause(job_id)
            return
        self._slot.release(job_id)
        self._flags.clear_cancel(job_id)
        self._flags.clear_pause(job_id)

    def _settle_locked(
        self, job: Job, status: str, error: str | None, code: str | None = None
    ) -> LifecycleEffects:
        """Token-less settle of a ``pending`` / ``paused`` job."""
        self._write_status_locked(job.job_id, status, error=error, completed_at=_now())
        self._settle_flags_and_slot_locked(job.job_id, status)
        message = CANCELLED_MESSAGE if status == "cancelled" else (error or "")
        if status == "cancelled":
            code = CANCELLED_CODE
        outcome = Outcome(status=status, error=error, code=code, message=message)  # type: ignore[arg-type]
        return self._effects(job, outcome)

    # --- the one status writer -----------------------------------------

    def _write_status_locked(
        self,
        job_id: str,
        status: str,
        *,
        error: str | None,
        completed_at: str | None,
    ) -> None:
        """Write a status under :data:`LEGAL_TRANSITIONS` (INV-3).

        If the write raises after it landed (the parent-directory ``fsync``),
        the re-read decides: a stored *status* counts as published.
        """
        current = self._meta.load_job(job_id).status
        if (current, status) not in LEGAL_TRANSITIONS:
            msg = (
                f"INV-3 violation: illegal transition {current!r} -> {status!r} "
                f"for job {job_id!r}"
            )
            raise IllegalTransitionError(msg)
        try:
            self._meta.write_status_locked(
                job_id, status, error=error, completed_at=completed_at
            )
        except Exception:
            if self._stored_status(job_id) != status:
                raise
            _logger.exception(
                "event='lifecycle.write_error_after_publish' job=%s status=%s",
                job_id,
                status,
            )

    def _stored_status(self, job_id: str) -> str | None:
        job = self._meta.get(job_id)
        return None if job is None else job.status

    @staticmethod
    def _effects(job: Job, outcome: Outcome) -> LifecycleEffects:
        status = outcome.status
        if status == "completed":
            frame = "completed"
        elif status == "paused":
            frame = "paused"
        else:
            frame = "error"
        metric = status if status in TERMINAL_STATUSES else None
        return LifecycleEffects(
            job_id=job.job_id,
            job_type=job.job_type,
            status=status,
            frame=frame,  # type: ignore[arg-type]
            code=outcome.code,
            message=outcome.message or "",
            metric_status=metric,  # type: ignore[arg-type]
        )


__all__ = [
    "AdmissionRefused",
    "JobLifecycle",
    "LifecycleEffects",
    "Outcome",
    "RecoverRefusedError",
    "RunToken",
]
