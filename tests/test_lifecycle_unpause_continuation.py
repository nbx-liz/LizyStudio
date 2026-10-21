"""Adapter tests for the unpause continuation (P-0116 D3, child 6).

``LizyMLAdapter.tune(resume=True, storage=...)`` is the unpause call. It
reads the stored study's rounds and either restores the stored result or
runs the remaining rounds, each with the kwargs lizyml 0.20 accepts. A fake
model records every ``tune`` / ``restore_tuning`` call; the lineage read is
replaced where the planner uses it. Calls are counted (CLAUDE.md §7).
"""

from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from lizyml import TuneProgressInfo
from lizyml.tuning import RoundRecord, StudyLineage

from lizystudio.backends.exceptions import StudyNotResumableError
from lizystudio.backends.lizyml import LizyMLAdapter, study_continuation

pytestmark = pytest.mark.unit

STORAGE = "sqlite:///tmp/unpause.db"
STUDY = "studio-tune-unpause"
RE_TUNE_3 = {"n_rounds": 3, "n_trials": 2, "expand_boundary": True}


def _result() -> SimpleNamespace:
    return SimpleNamespace(
        best_params={"learning_rate": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
        rounds=None,
        boundary_report=None,
    )


class _FakeModel:
    """Records ``tune`` and ``restore_tuning``; ``tune`` reports one trial."""

    def __init__(self) -> None:
        self._tuning_result = None
        self.tune_calls: list[dict[str, Any]] = []
        self.restore_calls: list[tuple[Any, ...]] = []

    def tune(self, **kwargs: Any) -> SimpleNamespace:
        callback = kwargs.pop("progress_callback", None)
        self.tune_calls.append(kwargs)
        if callback is not None:
            callback(
                TuneProgressInfo(
                    current_trial=1,
                    total_trials=2,
                    elapsed_seconds=0.1,
                    best_score=0.9,
                    latest_score=0.9,
                    latest_state="complete",
                )
            )
        return _result()

    def restore_tuning(self, *args: Any, **kwargs: Any) -> SimpleNamespace:
        self.restore_calls.append((*args, *kwargs.values()))
        return _result()


class _Progress:
    def __init__(self) -> None:
        self.frames: list[dict[str, Any]] = []

    def __call__(self, **kwargs: Any) -> None:
        self.frames.append(kwargs)


def _completed(n_rounds: int) -> StudyLineage:
    return StudyLineage(
        state="completed",
        rounds=tuple(
            RoundRecord(
                round=k,
                status="completed",
                n_trials=3,
                n_finished=3,
                best_score_before=None,
                best_score_after=0.9,
            )
            for k in range(1, n_rounds + 1)
        ),
    )


def _open(open_round: int) -> StudyLineage:
    closed = tuple(
        RoundRecord(
            round=k,
            status="completed",
            n_trials=3,
            n_finished=3,
            best_score_before=None,
            best_score_after=0.9,
        )
        for k in range(1, open_round)
    )
    return StudyLineage(
        state="open",
        rounds=(
            *closed,
            RoundRecord(
                round=open_round,
                status="open",
                n_trials=3,
                n_finished=1,
                best_score_before=None,
                best_score_after=None,
            ),
        ),
        open_round=open_round,
    )


@pytest.fixture()
def lineage_reads(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Patch the lineage read; set ``state["lineage"]`` before tuning."""
    state: dict[str, Any] = {"lineage": None, "calls": []}

    def fake_read(storage: Any, study_name: Any) -> StudyLineage:
        state["calls"].append((storage, study_name))
        return state["lineage"]

    monkeypatch.setattr(study_continuation, "read_study_lineage", fake_read)
    return state


def _unpause(
    model: _FakeModel,
    *,
    re_tune: dict[str, Any] | None,
    on_progress: Any = None,
    checkpoint_dir: Path | None = None,
    adapter: LizyMLAdapter | None = None,
) -> Any:
    return (adapter or LizyMLAdapter()).tune(
        model,
        on_progress=on_progress,
        re_tune=re_tune,
        checkpoint_dir=checkpoint_dir,
        resume=True,
        storage=STORAGE,
        study_name=STUDY,
    )


# --- run: closed rounds fewer than planned ----------------------------------


def test_completed_round_one_of_three_runs_rounds_two_and_three(
    lineage_reads: dict[str, Any],
) -> None:
    lineage_reads["lineage"] = _completed(1)
    model = _FakeModel()

    _unpause(model, re_tune=RE_TUNE_3)

    assert lineage_reads["calls"] == [(STORAGE, STUDY)]
    assert len(model.restore_calls) == 0
    assert len(model.tune_calls) == 2
    for kwargs in model.tune_calls:
        assert kwargs == {
            "storage": STORAGE,
            "study_name": STUDY,
            "resume": True,
            "n_trials": 2,
            "expand_boundary": True,
        }


def test_absent_study_runs_every_planned_round_with_round_one_on_config_budget(
    lineage_reads: dict[str, Any],
) -> None:
    lineage_reads["lineage"] = StudyLineage(state="absent")
    model = _FakeModel()

    _unpause(model, re_tune=RE_TUNE_3)

    assert len(model.tune_calls) == 3
    # Round 1 keeps the config's n_trials: no per-round re_tune kwargs.
    assert model.tune_calls[0] == {
        "storage": STORAGE,
        "study_name": STUDY,
        "resume": True,
    }
    for kwargs in model.tune_calls[1:]:
        assert kwargs["n_trials"] == 2
        assert kwargs["expand_boundary"] is True


# --- run: an open round -----------------------------------------------------


def test_open_round_is_finished_without_a_budget_then_the_rest_runs(
    lineage_reads: dict[str, Any],
) -> None:
    lineage_reads["lineage"] = _open(2)
    model = _FakeModel()

    _unpause(model, re_tune=RE_TUNE_3)

    assert len(model.tune_calls) == 2
    # lizyml refuses an n_trials / expand_boundary other than the recorded one.
    assert model.tune_calls[0] == {
        "storage": STORAGE,
        "study_name": STUDY,
        "resume": True,
    }
    assert model.tune_calls[1]["n_trials"] == 2
    assert model.tune_calls[1]["expand_boundary"] is True


def test_open_round_one_gets_no_budget(lineage_reads: dict[str, Any]) -> None:
    lineage_reads["lineage"] = _open(1)
    model = _FakeModel()

    _unpause(model, re_tune={"n_rounds": 1, "n_trials": 7})

    assert len(model.tune_calls) == 1
    assert "n_trials" not in model.tune_calls[0]
    assert "expand_boundary" not in model.tune_calls[0]
    assert model.tune_calls[0]["resume"] is True


def test_round_labels_count_from_the_first_continued_round(
    lineage_reads: dict[str, Any],
) -> None:
    lineage_reads["lineage"] = _completed(1)
    model = _FakeModel()
    progress = _Progress()

    _unpause(model, re_tune=RE_TUNE_3, on_progress=progress)

    trial_frames = [f for f in progress.frames if f.get("trial_results")]
    # One trial frame per continued round (the fake reports one trial each).
    assert len(trial_frames) == 2
    assert [(f["round"], f["total_rounds"]) for f in trial_frames] == [
        (2, 3),
        (3, 3),
    ]
    assert trial_frames[0]["message"].startswith("Round 2/3 · ")
    starts = [f["message"] for f in progress.frames if "Starting round" in f["message"]]
    assert starts == ["Starting round 3/3..."]


# --- restore: every planned round closed ------------------------------------


def test_all_planned_rounds_closed_restores_without_a_trial(
    lineage_reads: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    lineage_reads["lineage"] = _completed(3)
    model = _FakeModel()
    progress = _Progress()
    adapter = LizyMLAdapter()
    saves: list[Path] = []
    monkeypatch.setattr(adapter, "save_checkpoint", lambda m, p: saves.append(p))

    with caplog.at_level(logging.INFO):
        summary = _unpause(
            model,
            re_tune=RE_TUNE_3,
            on_progress=progress,
            checkpoint_dir=tmp_path,
            adapter=adapter,
        )

    assert len(model.tune_calls) == 0
    assert model.restore_calls == [(STORAGE, STUDY)]
    # The final save keeps the restored study in model.pkl for a later /retune.
    assert saves == [tmp_path]
    assert summary.best_score == 0.9
    assert progress.frames[-1]["message"] == "Tuning complete."
    lineage_lines = [
        r.getMessage()
        for r in caplog.records
        if "event='tune.unpause.lineage'" in r.getMessage()
    ]
    assert len(lineage_lines) == 1
    assert "branch=restore" in lineage_lines[0]
    assert "closed=3" in lineage_lines[0]
    assert "planned=3" in lineage_lines[0]


def test_default_re_tune_plans_one_round(lineage_reads: dict[str, Any]) -> None:
    lineage_reads["lineage"] = _completed(1)
    model = _FakeModel()

    _unpause(model, re_tune=None)

    assert len(model.tune_calls) == 0
    assert len(model.restore_calls) == 1


# --- refuse ------------------------------------------------------------------


def test_legacy_study_is_refused_before_any_tune(
    lineage_reads: dict[str, Any],
) -> None:
    lineage_reads["lineage"] = StudyLineage(state="legacy")
    model = _FakeModel()

    with pytest.raises(StudyNotResumableError) as excinfo:
        _unpause(model, re_tune=None)

    assert excinfo.value.state == "legacy"
    assert len(model.tune_calls) == 0
    assert len(model.restore_calls) == 0


# --- other paths read no lineage ---------------------------------------------


def test_initial_tune_reads_no_lineage(lineage_reads: dict[str, Any]) -> None:
    model = _FakeModel()

    LizyMLAdapter().tune(
        model, re_tune={"n_rounds": 2}, storage=STORAGE, study_name=STUDY
    )

    assert lineage_reads["calls"] == []
    assert len(model.tune_calls) == 2
    assert "resume" not in model.tune_calls[0]


def test_retune_without_storage_reads_no_lineage(
    lineage_reads: dict[str, Any],
) -> None:
    model = _FakeModel()

    LizyMLAdapter().tune(model, re_tune={"n_rounds": 1, "n_trials": 5}, resume=True)

    assert lineage_reads["calls"] == []
    assert model.tune_calls == [{"resume": True, "n_trials": 5}]
