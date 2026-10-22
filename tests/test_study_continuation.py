"""Unit tests for the unpause continuation planner (P-0116 D3, child 6).

``plan_continuation`` maps a stored study's lineage and the number of
rounds ``tuning.re_tune`` planned to what an unpause does: restore the
stored result, run the remaining rounds, or refuse. The lineages are
built from lizyml's own ``StudyLineage`` / ``RoundRecord`` so a change of
their shape breaks these tests rather than passing them silently.
"""

from __future__ import annotations

from typing import Any

import pytest
from lizyml.tuning import RoundRecord, StudyLineage

from lizystudio.backends.exceptions import (
    CheckpointIncompatibleError,
    StudyNotResumableError,
)
from lizystudio.backends.lizyml import study_continuation
from lizystudio.backends.lizyml.study_continuation import (
    Continuation,
    plan_continuation,
    read_continuation,
    require_continuable,
    verify_continuable,
)

pytestmark = pytest.mark.unit


def _round(k: int, status: Any = "completed", n_trials: int = 3) -> RoundRecord:
    return RoundRecord(
        round=k,
        status=status,
        n_trials=n_trials,
        n_finished=n_trials if status != "open" else 1,
        best_score_before=None if k == 1 else 0.8,
        best_score_after=0.9 if status == "completed" else None,
    )


def _completed(n_rounds: int) -> StudyLineage:
    return StudyLineage(
        state="completed",
        rounds=tuple(_round(k) for k in range(1, n_rounds + 1)),
    )


@pytest.mark.parametrize("state", ["legacy", "unreadable", "inconsistent"])
def test_unresumable_states_refuse(state: Any) -> None:
    with pytest.raises(StudyNotResumableError) as excinfo:
        plan_continuation(StudyLineage(state=state), planned_rounds=2)
    err = excinfo.value
    assert err.state == state
    assert err.kind == "study_not_resumable"
    assert err.recovery_hint == "Start a new Tune"
    # The API layer catches the base type (PICKLE_INCOMPATIBLE envelope).
    assert isinstance(err, CheckpointIncompatibleError)


def test_completed_with_all_planned_rounds_restores() -> None:
    plan = plan_continuation(_completed(2), planned_rounds=2)
    assert plan.kind == "restore"
    assert plan.state == "completed"
    assert plan.closed == 2


def test_completed_with_more_rounds_than_planned_restores() -> None:
    plan = plan_continuation(_completed(3), planned_rounds=1)
    assert plan.kind == "restore"


def test_completed_with_fewer_rounds_than_planned_runs_the_rest() -> None:
    plan = plan_continuation(_completed(1), planned_rounds=3)
    assert plan == Continuation(
        kind="run",
        first_round=2,
        last_round=3,
        finish_open=False,
        state="completed",
        closed=1,
        open_round=None,
    )


def test_open_round_is_finished_then_the_rest_runs() -> None:
    lineage = StudyLineage(
        state="open",
        rounds=(_round(1), _round(2, status="open")),
        open_round=2,
    )
    plan = plan_continuation(lineage, planned_rounds=3)
    assert plan.kind == "run"
    assert plan.first_round == 2
    assert plan.last_round == 3
    assert plan.finish_open is True
    assert plan.open_round == 2


def test_open_round_beyond_the_plan_is_still_finished() -> None:
    lineage = StudyLineage(
        state="open",
        rounds=(_round(1), _round(2, status="open")),
        open_round=2,
    )
    plan = plan_continuation(lineage, planned_rounds=1)
    assert (plan.kind, plan.first_round, plan.last_round) == ("run", 2, 2)
    assert plan.finish_open is True


def test_open_state_without_an_open_round_refuses() -> None:
    # DC1: a lineage that contradicts itself is refused, not guessed at.
    with pytest.raises(StudyNotResumableError) as excinfo:
        plan_continuation(StudyLineage(state="open", rounds=()), planned_rounds=1)
    assert excinfo.value.state == "open"


@pytest.mark.parametrize("state", ["absent", "uninitialized", "no_round"])
def test_studies_without_a_round_run_from_round_one(state: Any) -> None:
    plan = plan_continuation(StudyLineage(state=state), planned_rounds=2)
    assert (plan.kind, plan.first_round, plan.last_round) == ("run", 1, 2)
    assert plan.finish_open is False
    assert plan.closed == 0


def test_planned_rounds_below_one_is_rejected() -> None:
    with pytest.raises(ValueError, match="planned_rounds"):
        plan_continuation(_completed(1), planned_rounds=0)


def test_read_continuation_reads_the_lineage_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Any, Any]] = []

    def fake_read(storage: Any, study_name: Any) -> StudyLineage:
        calls.append((storage, study_name))
        return _completed(1)

    monkeypatch.setattr(study_continuation, "read_study_lineage", fake_read)
    plan = read_continuation("sqlite:///x.db", "studio-tune-x", planned_rounds=2)
    assert calls == [("sqlite:///x.db", "studio-tune-x")]
    assert (plan.kind, plan.first_round, plan.last_round) == ("run", 2, 2)


def test_read_continuation_without_a_study_name_is_refused() -> None:
    with pytest.raises(ValueError, match="study_name"):
        read_continuation("sqlite:///x.db", None, planned_rounds=1)


def test_read_continuation_propagates_lineage_read_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # DC1: an unreadable storage is not "nothing persisted yet".
    def failing_read(storage: Any, study_name: Any) -> StudyLineage:
        raise RuntimeError("storage exploded")

    monkeypatch.setattr(study_continuation, "read_study_lineage", failing_read)
    with pytest.raises(RuntimeError, match="storage exploded"):
        read_continuation("sqlite:///x.db", "studio-tune-x", planned_rounds=1)


# --- P-0116 D4 (child 7): the unpause preflight shares the refusal rule ---


@pytest.mark.parametrize("state", ["legacy", "unreadable", "inconsistent"])
def test_require_continuable_refuses_the_unresumable_states(state: Any) -> None:
    with pytest.raises(StudyNotResumableError) as excinfo:
        require_continuable(StudyLineage(state=state))
    assert excinfo.value.state == state


def test_require_continuable_refuses_an_open_study_without_its_round() -> None:
    with pytest.raises(StudyNotResumableError) as excinfo:
        require_continuable(StudyLineage(state="open", open_round=None))
    assert excinfo.value.state == "open"


@pytest.mark.parametrize(
    "lineage",
    [
        StudyLineage(state="absent"),
        StudyLineage(state="uninitialized"),
        StudyLineage(state="no_round"),
        StudyLineage(state="completed", rounds=(_round(1),)),
        StudyLineage(state="open", rounds=(_round(1), _round(2, "open")), open_round=2),
    ],
    ids=lambda lineage: lineage.state,
)
def test_require_continuable_admits_what_plan_continuation_plans(
    lineage: StudyLineage,
) -> None:
    require_continuable(lineage)
    # The worker plans the same lineage without refusing it.
    plan_continuation(lineage, planned_rounds=2)


def test_verify_continuable_reads_the_lineage_and_refuses_legacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Any, Any]] = []

    def fake_read(storage: Any, study_name: Any) -> StudyLineage:
        calls.append((storage, study_name))
        return StudyLineage(state="legacy")

    monkeypatch.setattr(study_continuation, "read_study_lineage", fake_read)
    with pytest.raises(StudyNotResumableError) as excinfo:
        verify_continuable("sqlite:///x.db", "studio-tune-x")
    assert excinfo.value.state == "legacy"
    assert calls == [("sqlite:///x.db", "studio-tune-x")]


def test_verify_continuable_propagates_lineage_read_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_read(storage: Any, study_name: Any) -> StudyLineage:
        raise RuntimeError("storage exploded")

    monkeypatch.setattr(study_continuation, "read_study_lineage", failing_read)
    with pytest.raises(RuntimeError, match="storage exploded"):
        verify_continuable("sqlite:///x.db", "studio-tune-x")
