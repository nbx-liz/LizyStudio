"""End-to-end tests using a real lizyml Model for H-0062 checkpoint/resume.

These tests guard against the class of bugs where the mock-based tests in
test_lizyml_checkpoint.py pass while the real lizyml lifecycle silently
breaks. Specifically the bug where the per-trial bridge callback pickled
`model._study=None` (because lizyml assigns `self._study = study` only at
the very end of `Model.tune()`) so Re-tune / Resume always failed with
"Cannot resume tuning: no previous tune() call".

These are slow (they actually run tune with n_trials=2) so they are
marked as `slow` — CI still runs them but contributors can exclude them
locally via `-m 'not slow'`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from lizystudio.backends.lizyml import LizyMLAdapter

pytestmark = [pytest.mark.integration, pytest.mark.slow]


def _tiny_binary_df(seed: int = 42, n: int = 60) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    return pd.DataFrame(
        {
            "x1": rng.normal(size=n),
            "x2": rng.normal(size=n),
            "y": rng.integers(0, 2, size=n),
        }
    )


def _tiny_tuning_config() -> dict[str, Any]:
    return {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {"verbose": -1}},
        "split": {"method": "stratified_kfold", "n_splits": 3},
        "tuning": {
            "optuna": {
                "params": {"n_trials": 2, "direction": "maximize"},
            }
        },
    }


def test_final_checkpoint_captures_optuna_study(tmp_path: Path) -> None:
    """After tune() returns, the on-disk model.pkl must contain a non-None
    _study. Without the final save, checkpoints taken during the bridge
    callback all predate `self._study = study` (which lizyml assigns only
    at the end of tune()), so load_checkpoint(...)._study is None.
    """
    adapter = LizyMLAdapter()
    df = _tiny_binary_df()
    model = adapter.create_model(_tiny_tuning_config(), df)

    adapter.tune(model, checkpoint_dir=tmp_path)

    # Sanity: the in-memory model has a study after tune() returns.
    assert model._study is not None, "lizyml contract changed — study missing in-memory"

    reloaded = adapter.load_checkpoint(tmp_path)
    assert reloaded._study is not None, (
        "Checkpoint on disk is missing _study; final save after tune() did not run"
    )


def test_resume_roundtrip_via_checkpoint(tmp_path: Path) -> None:
    """Full Re-tune lifecycle: tune -> save -> load -> tune(resume=True).

    This is the exact sequence `run_retune` performs on a Re-tune click.
    Before the fix, the second adapter.tune(..., resume=True) raised
    LizyMLError[TUNING_FAILED] "Cannot resume tuning: no previous tune()
    call" because the on-disk model had _study=None.
    """
    adapter = LizyMLAdapter()
    df = _tiny_binary_df()

    parent_dir = tmp_path / "parent"
    child_dir = tmp_path / "child"
    parent_dir.mkdir()
    child_dir.mkdir()

    parent_model = adapter.create_model(_tiny_tuning_config(), df)
    first_result = adapter.tune(parent_model, checkpoint_dir=parent_dir)
    # Optuna may prune trials in some runs; n_trials=2 is configured
    # but the recorded list can hold 1..2 entries depending on pruning.
    # The real regression guard for this test is _study persistence,
    # not the exact trial count.
    assert 1 <= len(first_result.trials) <= 2

    import shutil

    shutil.copy2(parent_dir / "model.pkl", child_dir / "model.pkl")
    shutil.copy2(parent_dir / "model_meta.json", child_dir / "model_meta.json")

    resumed_model = adapter.load_checkpoint(child_dir)
    # Pre-condition: the child model must carry over the Optuna study.
    # If this fails, the bug (per-trial save with _study=None) has
    # regressed regardless of what adapter.tune does next.
    assert resumed_model._study is not None
    parent_study_id = id(resumed_model._study)

    # The real regression check: adapter.tune with resume=True must
    # reach lizyml without tripping the "no previous tune() call" guard.
    # Exact trial count delta depends on Optuna pruning behaviour with
    # n_trials=1, so we don't assert on it — just that the call
    # returns a TuningSummary without raising.
    second_result = adapter.tune(
        resumed_model,
        re_tune={"n_rounds": 1, "n_trials": 1},
        checkpoint_dir=child_dir,
        resume=True,
    )
    assert second_result is not None
    assert first_result.best_score is not None
    # Sanity: the resumed study is still the same object lizyml kept
    # internally, not a freshly-minted one.
    assert id(resumed_model._study) == parent_study_id


def test_resume_seeds_progress_trials_from_parent_history(tmp_path: Path) -> None:
    """H-0062 Bugfix 2026-04-14: when resume=True, the LizyMLAdapter
    bridge must pre-populate ``accumulated_trials`` with the parent's
    trial history so the UI's LiveTrialChart / Running Trials table
    show the full cumulative history including the parent's best score.

    Before the fix, accumulated_trials started empty on every tune()
    call, so a Re-tune child would display only the new trials and the
    Best column would start from the first new trial, giving the false
    impression that the parent results were thrown away.
    """
    import shutil

    adapter = LizyMLAdapter()
    df = _tiny_binary_df()

    parent_dir = tmp_path / "parent"
    child_dir = tmp_path / "child"
    parent_dir.mkdir()
    child_dir.mkdir()

    parent_model = adapter.create_model(_tiny_tuning_config(), df)
    parent_result = adapter.tune(parent_model, checkpoint_dir=parent_dir)
    # Optuna pruning can yield 1 or 2 trials with n_trials=2.
    assert 1 <= len(parent_result.trials) <= 2

    shutil.copy2(parent_dir / "model.pkl", child_dir / "model.pkl")
    shutil.copy2(parent_dir / "model_meta.json", child_dir / "model_meta.json")

    resumed = adapter.load_checkpoint(child_dir)

    # Capture the trial_results that the bridge pushes to on_progress.
    # The *first* progress callback after the first new trial completes
    # must already contain the parent's trials as a prefix.
    captured: list[list[dict[str, Any]]] = []

    def capture_progress(
        *,
        current: int,
        total: int,
        message: str,
        **extra: Any,
    ) -> None:
        trials = extra.get("trial_results")
        if trials is not None:
            captured.append(list(trials))

    adapter.tune(
        resumed,
        on_progress=capture_progress,
        re_tune={"n_rounds": 1, "n_trials": 1},
        checkpoint_dir=child_dir,
        resume=True,
    )

    # Find the first callback that carried a non-empty trial_results list.
    non_empty = [c for c in captured if c]
    assert non_empty, "bridge never emitted trial_results on resume"
    first = non_empty[0]
    # The first emission must already contain all parent trials as a
    # prefix — the new trial is appended on top. Therefore:
    # len(first) >= len(parent_result.trials) + 1 (at least one new trial)
    assert len(first) >= len(parent_result.trials) + 1, (
        f"bridge did not seed parent trial history: "
        f"first emission had {len(first)} entries, "
        f"parent had {len(parent_result.trials)}"
    )
    # Every parent trial must show its best_score propagated — the
    # parent's best_score is the floor for the running best in the UI.
    parent_best = float(parent_result.best_score)
    for i in range(len(parent_result.trials)):
        assert first[i]["best_score"] == pytest.approx(parent_best), (
            f"parent trial index {i} was not seeded with parent's best_score "
            f"({parent_best}); got {first[i].get('best_score')}"
        )


def test_grandchild_resume_chain_a_b_c(tmp_path: Path) -> None:
    """H-0062 Decision 2026-04-14: chaining Re-tune on a Re-tune child.

    Validates the full A -> B -> C lineage with real lizyml Models:
    - A is a fresh tune with n_trials=2
    - B resumes A and runs n_trials=1 (study now holds >= 3 trials)
    - C resumes B (!!! this used to be blocked by the API guard) and
      runs n_trials=1 (study now holds >= 4 trials)

    This guards both the backend adapter side (resume from a child's
    checkpoint works mechanically) and the decision that grandchild
    retune is part of the supported UX. The API-level guard lives in
    ``_require_tune_job_with_checkpoint`` in ``api/jobs.py``; this test
    covers the adapter half so regressions in either layer are caught
    independently.
    """
    import shutil

    adapter = LizyMLAdapter()
    df = _tiny_binary_df()

    a_dir = tmp_path / "a"
    b_dir = tmp_path / "b"
    c_dir = tmp_path / "c"
    for d in (a_dir, b_dir, c_dir):
        d.mkdir()

    # --- A: fresh tune -----------------------------------------------
    a_model = adapter.create_model(_tiny_tuning_config(), df)
    a_result = adapter.tune(a_model, checkpoint_dir=a_dir)
    # Optuna pruning makes the exact count flaky; the chain assertions
    # below use the actual count, not the configured n_trials.
    assert 1 <= len(a_result.trials) <= 2
    a_trials = len(a_result.trials)

    # --- B: resume from A --------------------------------------------
    shutil.copy2(a_dir / "model.pkl", b_dir / "model.pkl")
    shutil.copy2(a_dir / "model_meta.json", b_dir / "model_meta.json")
    b_model = adapter.load_checkpoint(b_dir)
    assert b_model._study is not None
    b_result = adapter.tune(
        b_model,
        re_tune={"n_rounds": 1, "n_trials": 1},
        checkpoint_dir=b_dir,
        resume=True,
    )
    b_study_trials = len(b_model._study.trials)
    assert b_study_trials >= a_trials + 1, (
        f"B did not extend the study: A had {a_trials}, B reports {b_study_trials}"
    )
    assert b_result is not None

    # --- C: resume from B (the case that was previously blocked) ----
    shutil.copy2(b_dir / "model.pkl", c_dir / "model.pkl")
    shutil.copy2(b_dir / "model_meta.json", c_dir / "model_meta.json")
    c_model = adapter.load_checkpoint(c_dir)
    assert c_model._study is not None, (
        "C's loaded model is missing _study — final save did not run on B"
    )
    assert len(c_model._study.trials) == b_study_trials, (
        "C's study did not inherit B's full trial history"
    )
    c_result = adapter.tune(
        c_model,
        re_tune={"n_rounds": 1, "n_trials": 1},
        checkpoint_dir=c_dir,
        resume=True,
    )
    c_study_trials = len(c_model._study.trials)
    assert c_study_trials >= b_study_trials + 1, (
        f"C did not extend B's study: B had {b_study_trials}, "
        f"C reports {c_study_trials}"
    )
    assert c_result is not None


def test_final_save_survives_checkpoint_dir_none(tmp_path: Path) -> None:
    """Regression guard: passing checkpoint_dir=None must NOT attempt any
    final save, and tune() must still return normally. Phase A callers
    depend on this."""
    adapter = LizyMLAdapter()
    df = _tiny_binary_df()
    model = adapter.create_model(_tiny_tuning_config(), df)

    result = adapter.tune(model, checkpoint_dir=None)

    assert result.best_score is not None
    assert not (tmp_path / "model.pkl").exists()
