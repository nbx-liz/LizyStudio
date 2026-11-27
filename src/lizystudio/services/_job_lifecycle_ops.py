"""The API-facing operations of the job lifecycle primitive (P-0119).

A mixin of :class:`lizystudio.services._job_lifecycle.JobLifecycle`: cancel,
pause, reset, force-release, startup recovery, the delete release and the
settle of a reservation whose launch failed. Every method takes the
lifecycle lock for its whole read-check-write and returns the effects it
owes; nothing here broadcasts or counts a metric.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from lizystudio.services._job_lifecycle_types import (
    CANCELLED_CODE,
    CANCELLED_MESSAGE,
    TERMINAL_STATUSES,
    CancelResult,
    LifecycleEffects,
    Outcome,
    RecoverRefusedError,
    RunToken,
)

if TYPE_CHECKING:
    from lizystudio.services._job_active_slot import ActiveJobSlot
    from lizystudio.services._job_control_flags import JobControlFlags
    from lizystudio.services._job_metadata import Job, JobMetadataStore

_logger = logging.getLogger(__name__)

_RESTART_FAILED = "Server restarted before this job could complete"
_EXTRA_PAUSED = (
    "Multiple paused jobs found at startup; only the newest "
    "is preserved (INV-1: at most one paused job)"
)


class LifecycleOps:
    """Cancel / pause / reset / force-release / recover / delete (P-0119)."""

    _meta: JobMetadataStore
    _slot: ActiveJobSlot
    _flags: JobControlFlags
    lock: threading.Lock
    _tokens: dict[str, RunToken]
    _reset_gen: int
    _started: bool
    _emit_gate: threading.Lock

    if TYPE_CHECKING:

        def _settle_locked(
            self, job: Job, status: str, error: str | None
        ) -> LifecycleEffects: ...

        def _write_status_locked(
            self,
            job_id: str,
            status: str,
            *,
            error: str | None,
            completed_at: str | None,
        ) -> None: ...

        @staticmethod
        def _effects(job: Job, outcome: Outcome) -> LifecycleEffects: ...

        def _revoke_locked(self, job_id: str) -> RunToken | None: ...

        def _is_live_locked(self, token: RunToken) -> bool: ...

    # --- the token-fenced frame (Codex r1-4) ---------------------------

    def emit_if_live(self, token: RunToken, send: Callable[[], None]) -> bool:
        """Call *send* (one broadcast) only while *token* is live; a frame of
        a revoked run is dropped and logged (INV-LC-5, Codex r1-4)."""
        with self._emit_gate:
            if not self._is_live_locked(token):
                _logger.info(
                    "event='lifecycle.stale_frame_dropped' job=%s run=%d",
                    token.job_id,
                    token.run_gen,
                )
                return False
            send()
            return True

    # --- cancel and pause ----------------------------------------------

    def cancel(self, job_id: str) -> CancelResult:
        """``POST /cancel``: flag a live run, settle a token-less job.

        - live token: CANCEL is set; the run's commit writes ``cancelled``;
        - ``pending`` / ``paused`` without a token: settled ``cancelled`` now;
        - terminal: refused (``accepted`` False, the API answers 400).

        Raises ``FlagNotPersistedError`` when the CANCEL file cannot be
        written: the cancel is then not accepted (Codex r2-2).

        A ``running`` row without a live token is not reachable in this
        process (only admission writes ``running``, and every path that drops
        the token writes another status); for such a row the flag is set as
        before P-0119.
        """
        with self.lock:
            job = self._meta.get(job_id)
            if job is None or job.status in TERMINAL_STATUSES:
                return CancelResult(False, "missing" if job is None else job.status)
            if job_id in self._tokens or job.status == "running":
                self._flags.request_cancel(job_id)
                return CancelResult(True, job.status)
            effects = self._settle_locked(job, "cancelled", None)
            return CancelResult(True, "cancelled", effects)

    def pause(self, job_id: str) -> bool:
        """``POST /pause``: set PAUSE for a live run without CANCEL (P-0119)."""
        with self.lock:
            if job_id not in self._tokens:
                return False
            if self._flags.is_cancel_requested(job_id):
                return False
            self._flags.request_pause(job_id)
            return True

    # --- reset and force-release ----------------------------------------

    def reset_cancel_active(self) -> list[LifecycleEffects]:
        """Advance the reset generation and cancel the slot holder, in one
        lock section (INV-LC-6): a live run gets CANCEL; a token-less
        ``pending`` / ``paused`` holder is settled ``cancelled``."""
        with self.lock:
            self._reset_gen += 1
            holder = self._slot.active_job_id
            if holder is None:
                return []
            if holder in self._tokens:
                self._flags.request_cancel(holder)
                return []
            job = self._meta.get(holder)
            if job is None or job.status not in ("pending", "paused"):
                return []
            return [self._settle_locked(job, "cancelled", None)]

    def force_release(self, job_id: str) -> LifecycleEffects | None:
        """Write ``cancelled`` unless the row is terminal, then revoke
        *job_id*'s run and release its slot. CANCEL stays (a still-running
        child reads it).

        The run keeps its authority until the ``cancelled`` write is
        published (Codex r2-1): if the write raises, nothing is revoked or
        released and the error propagates, so the run's own later commit can
        still publish a terminal and settle the slot.
        """
        with self.lock:
            job = self._meta.get(job_id)
            effects = None
            if job is not None and job.status not in TERMINAL_STATUSES:
                self._write_status_locked(
                    job_id, "cancelled", error=None, completed_at=_now()
                )
                outcome = Outcome(
                    status="cancelled", code=CANCELLED_CODE, message=CANCELLED_MESSAGE
                )
                effects = self._effects(job, outcome)
            revoked = self._revoke_locked(job_id)
            if revoked is not None:
                _logger.warning(
                    "event='lifecycle.force_release' job=%s run=%d",
                    job_id,
                    revoked.run_gen,
                )
            self._slot.force_release_if(job_id)
            return effects

    def holder_is_settled(self, job_id: str) -> bool:
        """True when *job_id* holds the slot with no live run and a terminal
        row (reset's wait loop then force-releases it at once)."""
        with self.lock:
            if job_id in self._tokens or self._slot.active_job_id != job_id:
                return False
            job = self._meta.get(job_id)
            return job is None or job.status in TERMINAL_STATUSES

    # --- failure settles --------------------------------------------------

    def settle_reservation(self, job_id: str, error: str) -> LifecycleEffects | None:
        """Fail a reserved ``pending`` job whose launch raised before admission
        (no live token); a job already admitted or settled is left alone."""
        with self.lock:
            job = self._meta.get(job_id)
            if job is None or job.status != "pending" or job_id in self._tokens:
                return None
            return self._settle_locked(job, "failed", error)

    def abandon(self, token: RunToken) -> bool:
        """Drop a live run whose terminal write keeps failing: release its slot
        and the PAUSE flag without a status write (#765 cleanup,
        token-conditioned). CANCEL is kept: no terminal was published, and an
        accepted cancel must survive until one is — a restart's ``recover``
        then writes ``cancelled`` (INV-LC-4 / Q6, Codex r1-3)."""
        with self.lock:
            if not self._is_live_locked(token):
                return False
            self._revoke_locked(token.job_id)
            self._slot.release(token.job_id)
            self._flags.clear_pause(token.job_id)
            _logger.error("event='lifecycle.run_abandoned' job=%s", token.job_id)
            return True

    # --- delete (Q5) -----------------------------------------------------

    def release_for_delete(self, job_ids: list[str]) -> bool:
        """Before ``rmtree``: flag live runs to stop; for token-less jobs,
        release the slot they hold and clear their flags (no status write —
        the rows are about to be removed).

        Refuses (returns False, changing nothing) when the first id — the job
        the request deletes — has a live run: the route's ``running`` check
        read the row outside the lock, and a run admitted since then must not
        lose its directory.
        """
        with self.lock:
            if job_ids and job_ids[0] in self._tokens:
                return False
            for job_id in job_ids:
                if job_id in self._tokens:
                    # The directory is about to be removed: the flag only has
                    # to reach the run (in-memory; its poll loop reads it).
                    self._flags.mark_cancel_in_memory(job_id)
                    continue
                self._slot.release(job_id)
                self._flags.clear_cancel(job_id)
                self._flags.clear_pause(job_id)
            return True

    # --- startup recovery (Q6) -------------------------------------------

    def mark_started(self) -> None:
        """Close ``recover``: the API and the launchers may now run."""
        with self.lock:
            self._started = True

    def recover(self) -> list[LifecycleEffects]:
        """Settle what a previous process left (INV-restart-1..3, P-0119 Q6).

        ``running`` / ``pending`` / ``paused`` rows with a CANCEL file become
        ``cancelled``; CANCEL-less ``running`` / ``pending`` become ``failed``;
        the newest CANCEL-less ``paused`` survivor gets the slot back (the
        others ``failed``). Terminal rows are never rewritten. Refused once
        :meth:`mark_started` ran.

        Returns the effects of every terminal it published (one frame and one
        terminal metric each, INV-LC-2; Codex r2-3). The caller emits them
        once its broadcaster exists, so the frame is in the P-0093 replay
        cache for a client that reconnects.
        """
        with self.lock:
            if self._started:
                msg = "recover() is only allowed before the process starts"
                raise RecoverRefusedError(msg)
            effects: list[LifecycleEffects] = []
            paused = self._recover_rows_locked(effects)
            self._recover_paused_locked(paused, effects)
            return effects

    def _recover_rows_locked(self, effects: list[LifecycleEffects]) -> list[Job]:
        paused: list[Job] = []
        for job in self._meta.list():
            if job.status in TERMINAL_STATUSES:
                continue
            if self._flags.is_cancel_requested(job.job_id):
                self._recover_one_locked(job, "cancelled", None, effects)
            elif job.status == "paused":
                paused.append(job)
            else:
                self._recover_one_locked(job, "failed", _RESTART_FAILED, effects)
        return paused

    def _recover_paused_locked(
        self, paused: list[Job], effects: list[LifecycleEffects]
    ) -> None:
        if not paused:
            return
        paused.sort(key=lambda j: j.created_at, reverse=True)
        survivor = paused[0]
        for job in paused[1:]:
            self._recover_one_locked(job, "failed", _EXTRA_PAUSED, effects)
        self._slot.reattach(survivor.job_id)
        _logger.info(
            "Re-attached paused job %s to active slot at startup", survivor.job_id
        )

    def _recover_one_locked(
        self,
        job: Job,
        status: str,
        error: str | None,
        effects: list[LifecycleEffects],
    ) -> None:
        """Recover one row; its effects join *effects* only once published.

        A row whose write fails is logged at ERROR and left non-terminal, so
        the next startup retries it; the other rows are still recovered and
        their effects returned (Codex r3). Startup is not aborted: one bad row
        must not keep the server down.
        """
        try:
            effects.append(self._recover_write_locked(job, status, error))
        except Exception:  # noqa: BLE001 — logged; the next startup retries
            _logger.exception(
                "event='lifecycle.recover_row_failed' job=%s target=%s",
                job.job_id,
                status,
            )

    def _recover_write_locked(
        self, job: Job, status: str, error: str | None
    ) -> LifecycleEffects:
        _logger.warning(
            "Reconciling orphaned %s job %s to %s at startup",
            job.status,
            job.job_id,
            status,
        )
        self._write_status_locked(job.job_id, status, error=error, completed_at=_now())
        self._flags.clear_cancel(job.job_id)
        self._flags.clear_pause(job.job_id)
        if status == "cancelled":
            outcome = Outcome(
                status="cancelled", code=CANCELLED_CODE, message=CANCELLED_MESSAGE
            )
        else:
            outcome = Outcome(status="failed", error=error, message=error)
        return self._effects(job, outcome)


def _now() -> str:
    return datetime.now(UTC).isoformat()
