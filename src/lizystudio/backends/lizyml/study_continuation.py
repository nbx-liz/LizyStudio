"""Decide how an unpause continues a stored study (P-0116 D3, child 6).

An unpaused Tune re-enters the adapter with ``resume=True`` and the job's
Optuna storage.  What it should do depends on the rounds lizyml recorded
in the study, read with :func:`lizyml.tuning.read_study_lineage`, against
the rounds ``tuning.re_tune`` planned (``n_rounds``, default 1):

* every planned round closed -> ``restore``: no trial runs, and
  ``Model.restore_tuning`` returns the stored result;
* a round left open -> ``run``: finish that round with the budget lizyml
  recorded for it, then run any planned rounds after it;
* fewer closed rounds than planned -> ``run`` the remaining rounds;
* no lizyml record (``legacy``), an unreadable or an inconsistent study ->
  :class:`StudyNotResumableError`.

lizyml records the rounds that ran, not the rounds that were planned, so
the plan is Studio's.  :func:`read_continuation` is the one entry point.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from lizyml.tuning import StudyLineage, read_study_lineage

from lizystudio.backends.exceptions import StudyNotResumableError

ContinuationKind = Literal["restore", "run"]

# lizyml study states an unpause cannot continue.
_NOT_RESUMABLE: frozenset[str] = frozenset({"legacy", "unreadable", "inconsistent"})


@dataclass(frozen=True)
class Continuation:
    """What an unpause does with a stored study.

    Attributes:
        kind: ``"restore"`` (no trial runs) or ``"run"``.
        first_round: The first round to run; for ``restore``, the last
            closed round.
        last_round: The last round to run; for ``restore``, the last
            closed round.  Also the round total the progress labels show.
        finish_open: ``first_round`` is an open round lizyml finishes with
            its recorded budget, so it must get no ``n_trials`` or
            ``expand_boundary``.
        state: lizyml's state of the study, for the log.
        closed: The rounds lizyml recorded, failed ones included (the open
            round excluded).
        open_round: The open round's number, else ``None``.
    """

    kind: ContinuationKind
    first_round: int
    last_round: int
    finish_open: bool
    state: str
    closed: int
    open_round: int | None


def plan_continuation(lineage: StudyLineage, planned_rounds: int) -> Continuation:
    """Map a study's lineage and the planned round count to a continuation.

    Pure: reads *lineage* only.

    Raises:
        StudyNotResumableError: for a ``legacy``, ``unreadable`` or
            ``inconsistent`` study, and for an ``open`` study without an
            open round.
        ValueError: when *planned_rounds* is below 1.
    """
    if planned_rounds < 1:
        raise ValueError(f"planned_rounds must be >= 1, got {planned_rounds}")
    state = lineage.state
    if state in _NOT_RESUMABLE:
        raise StudyNotResumableError(
            f"The stored study cannot be continued (lizyml state {state!r}).",
            state=state,
        )
    if state == "open":
        open_round = lineage.open_round
        if open_round is None:
            raise StudyNotResumableError(
                "The stored study has an open round lizyml did not number.",
                state=state,
            )
        return Continuation(
            kind="run",
            first_round=open_round,
            last_round=max(planned_rounds, open_round),
            finish_open=True,
            state=state,
            closed=open_round - 1,
            open_round=open_round,
        )
    # absent / uninitialized / no_round have no rounds; failed is not
    # reachable from a paused job and gets no special case.
    closed = len(lineage.rounds)
    if closed >= planned_rounds:
        return Continuation(
            kind="restore",
            first_round=closed,
            last_round=closed,
            finish_open=False,
            state=state,
            closed=closed,
            open_round=None,
        )
    return Continuation(
        kind="run",
        first_round=closed + 1,
        last_round=planned_rounds,
        finish_open=False,
        state=state,
        closed=closed,
        open_round=None,
    )


def read_continuation(
    storage: str, study_name: str | None, planned_rounds: int
) -> Continuation:
    """Read the stored study's lineage, then plan its continuation.

    Errors from reading the study propagate: an unreadable storage is not
    an empty one (DC1).

    Raises:
        ValueError: when *study_name* is ``None``; a storage holds many
            studies, so none of them is the job's by default.
    """
    if study_name is None:
        raise ValueError("Continuing a stored study needs its study_name.")
    lineage = read_study_lineage(storage, study_name)
    return plan_continuation(lineage, planned_rounds)


def round_kwargs(
    continuation: Continuation, round_number: int, extra_kwargs: dict[str, Any]
) -> dict[str, Any]:
    """The ``model.tune`` kwargs of one continued round, beyond its storage.

    The open round being finished gets nothing more, since lizyml refuses an
    ``n_trials`` or ``expand_boundary`` other than the recorded one.  Round
    1 gets nothing more either, so it keeps the config's budget.  Later
    rounds get the per-round ``re_tune`` kwargs.
    """
    kwargs: dict[str, Any] = {"resume": True}
    if continuation.finish_open and round_number == continuation.first_round:
        return kwargs
    if round_number == 1:
        return kwargs
    kwargs.update(extra_kwargs)
    return kwargs
