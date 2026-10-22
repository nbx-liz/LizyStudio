"""Unpause continues the stored study from its rounds (P-0116 D3, child 6).

Real lizyml, real Optuna SQLite storage, real ``run_tune`` + ``JobStore``.
The pause is requested the way a user's click lands today (#719): a
broadcaster stub asks for it on the first trial frame. lizyml swallows the
``PausedError`` the progress callback raises inside a round, so the pause
takes effect at the adapter's next progress call after the round closes.

* Multi-round: the pause parks the job after round 1 of 3; the unpause runs
  rounds 2 and 3 with the per-round budget (pre-fix: the #554 skip ran no
  round and the job ended with 1 round).
* Single round: the round closed before the pause; the unpause runs no
  trial and restores the stored result.
* Open round (adapter level; unpause cannot reach it until #719): a resume
  finishes the round's recorded budget.
* Raw-Optuna study: refused as ``legacy``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import optuna
import pandas as pd
import pytest
from lizyml.tuning import read_study_lineage

from lizystudio.backends.exceptions import CancelledError, StudyNotResumableError
from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.training import (
    _build_optuna_storage_url,
    _build_optuna_study_name,
    run_tune,
)

pytestmark = pytest.mark.integration

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml" / "tune"

_CATALOG_SPACE = {
    "learning_rate": {"type": "float", "low": 0.01, "high": 0.2, "log": True},
    "early_stopping.rounds": {"type": "int", "low": 20, "high": 60},
}


def _config(n_trials: int, re_tune: dict[str, Any] | None = None) -> dict[str, Any]:
    config: dict[str, Any] = json.loads((FIXTURE_DIR / "config.json").read_text())
    config["split"]["n_splits"] = 3
    config["tuning"]["optuna"]["params"]["n_trials"] = n_trials
    config["tuning"]["optuna"]["space"] = json.loads(json.dumps(_CATALOG_SPACE))
    if re_tune is not None:
        config["tuning"]["re_tune"] = re_tune
    return config


def _dataframe() -> pd.DataFrame:
    return pd.read_csv(FIXTURE_DIR / "data.csv")


class _PauseOnFirstTrial:
    """Broadcaster stub: requests a pause on the first trial frame, once."""

    def __init__(self, job_store: JobStore) -> None:
        self.job_store = job_store
        self.fired = False
        self.paused_frames = 0

    def send_progress(self, job_id: str, **kwargs: Any) -> None:
        if not self.fired and kwargs.get("trial_results"):
            self.fired = True
            self.job_store.request_pause(job_id)

    def send_paused(self, job_id: str, **kwargs: Any) -> None:
        self.paused_frames += 1

    def send_completed(self, job_id: str, *args: Any, **kwargs: Any) -> None:
        return None

    def send_error(self, job_id: str, *args: Any, **kwargs: Any) -> None:
        return None


def _new_job(job_store: JobStore, config: dict[str, Any]) -> Job:
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(FIXTURE_DIR / "data.csv"),
            filename="data.csv",
            fingerprint="fixture",
            shape=(150, 6),
        ),
        job_type="tune",
    )
    assert job is not None
    return job


def _pause_then_unpause(
    tmp_path: Path,
    config: dict[str, Any],
    while_paused: Any = None,
) -> tuple[JobStore, Job, Job, str, str]:
    """Run until the pause parks the job, check it, then unpause it."""
    job_store = JobStore(tmp_path / "jobs")
    backend = LizyMLAdapter()
    df = _dataframe()
    job = _new_job(job_store, config)
    storage = _build_optuna_storage_url(job_store.job_dir(job.job_id))
    study_name = _build_optuna_study_name(job.job_id)
    broadcaster = _PauseOnFirstTrial(job_store)

    paused = run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=config,
        dataframe=df,
        broadcaster=broadcaster,  # type: ignore[arg-type]
    )
    assert paused.status == "paused", paused.error
    assert broadcaster.paused_frames == 1
    before = read_study_lineage(storage, study_name)
    assert before.state == "completed"
    assert len(before.rounds) == 1

    if while_paused is not None:
        while_paused(job_store.job_dir(job.job_id))
    # What POST /unpause does before relaunching.
    job_store.clear_pause(job.job_id)
    done = run_tune(
        job=paused,
        job_store=job_store,
        backend=backend,
        config=config,
        dataframe=df,
        broadcaster=broadcaster,  # type: ignore[arg-type]
        resume_from_existing_study=True,
    )
    return job_store, paused, done, storage, study_name


def test_unpause_runs_the_planned_rounds_left(tmp_path: Path) -> None:
    config = _config(3, re_tune={"n_rounds": 3, "n_trials": 2})

    _, _, done, storage, study_name = _pause_then_unpause(tmp_path, config)

    assert done.status == "completed", done.error
    lineage = read_study_lineage(storage, study_name)
    assert lineage.state == "completed"
    assert [r.status for r in lineage.rounds] == ["completed"] * 3
    assert [r.n_trials for r in lineage.rounds] == [3, 2, 2]
    study = optuna.load_study(storage=storage, study_name=study_name)
    assert len(study.trials) == 7
    assert done.tune_result is not None
    assert len(done.tune_result.trials) == 7
    assert done.fit_result is not None


def test_unpause_after_the_only_round_closed_restores_without_a_trial(
    tmp_path: Path,
) -> None:
    config = _config(3)

    def drop_checkpoint(job_dir: Path) -> None:
        # The checkpoint written before the pause is removed, so the one
        # found after the unpause is the restore path's own final save.
        (job_dir / "model.pkl").unlink()

    job_store, paused, done, storage, study_name = _pause_then_unpause(
        tmp_path, config, while_paused=drop_checkpoint
    )

    job_dir = job_store.job_dir(paused.job_id)
    assert done.status == "completed", done.error
    study = optuna.load_study(storage=storage, study_name=study_name)
    assert len(study.trials) == 3
    lineage = read_study_lineage(storage, study_name)
    assert [r.n_trials for r in lineage.rounds] == [3]
    assert done.tune_result is not None
    assert len(done.tune_result.trials) == 3
    assert done.fit_result is not None
    assert (job_dir / "tuning_plot.json").exists()
    model = LizyMLAdapter().load_checkpoint(job_dir, allowed_root=job_store.jobs_dir)
    assert model._study is not None


def test_resume_finishes_an_open_round_with_its_recorded_budget(
    tmp_path: Path,
) -> None:
    storage = f"sqlite:///{tmp_path / 'optuna.db'}"
    study_name = "c6-open-round"
    backend = LizyMLAdapter()
    df = _dataframe()
    frames: list[int] = []

    def cancel_on_second_trial(**kwargs: Any) -> None:
        if kwargs.get("trial_results"):
            frames.append(1)
            if len(frames) == 2:
                raise CancelledError

    with pytest.raises(KeyboardInterrupt):
        backend.tune(
            backend.create_model(_config(4), df),
            on_progress=cancel_on_second_trial,
            storage=storage,
            study_name=study_name,
        )

    interrupted = read_study_lineage(storage, study_name)
    # Precondition, not a skip: the branch under test needs an open round.
    assert interrupted.state == "open", interrupted
    assert interrupted.open_round == 1
    assert interrupted.rounds[0].n_finished == 2

    summary = backend.tune(
        backend.create_model(_config(4), df),
        resume=True,
        storage=storage,
        study_name=study_name,
    )

    lineage = read_study_lineage(storage, study_name)
    assert lineage.state == "completed"
    assert [(r.n_trials, r.n_finished) for r in lineage.rounds] == [(4, 4)]
    assert len(optuna.load_study(storage=storage, study_name=study_name).trials) == 4
    assert len(summary.trials) == 4


def test_raw_optuna_study_is_refused_as_legacy(tmp_path: Path) -> None:
    storage = f"sqlite:///{tmp_path / 'optuna.db'}"
    study_name = "c6-raw-optuna"
    raw = optuna.create_study(storage=storage, study_name=study_name)
    trial = raw.ask({"x": optuna.distributions.FloatDistribution(0.0, 1.0)})
    raw.tell(trial, 0.5)
    backend = LizyMLAdapter()

    with pytest.raises(StudyNotResumableError) as excinfo:
        backend.tune(
            backend.create_model(_config(2), _dataframe()),
            resume=True,
            storage=storage,
            study_name=study_name,
        )

    assert excinfo.value.state == "legacy"
    assert len(optuna.load_study(storage=storage, study_name=study_name).trials) == 1
