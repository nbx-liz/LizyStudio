"""Regression test for Issue #554 — unpause must preserve the original n_trials budget.

R-1.4 (Tune resumability) INV-4: after a pause → unpause round-trip, the
Optuna study attached to the same ``job_id`` MUST end up with the budget the
Tune planned, never a second copy of it, regardless of which phase observed
the PAUSE flag.

Pre-fix bug
-----------
``POST /jobs/{id}/unpause`` (P-0099 v3-20d) called ``start_tune_async``
which re-entered ``run_tune`` from the top and ran the configured
``n_trials`` again onto the persisted study (CI 16, expected 8).

Fix history
-----------
The #554 fix counted the persisted Optuna trials in the service and either
skipped ``backend.tune`` or rewrote ``n_trials`` to the remainder. lizyml
0.20 counts budgets per round and records its rounds in the study, so
P-0116 D3 (child 6) moved the decision into the lizyml adapter: the service
passes ``resume=True`` with the job's storage, and the adapter reads the
study's rounds (``read_study_lineage``) and either restores the stored result
(every planned round closed: no trial runs), finishes an open round with its
recorded budget, or runs the remaining planned rounds.

The tests below pin:
- the service hands the unpause to the backend once, with ``resume=True``,
  the job's storage and study name, and the config's ``re_tune``;
- a study the backend cannot continue fails the job (no new transition);
- INV-4 at the adapter: a study whose planned rounds all closed runs no
  trial, and an open round is finished without a fresh budget;
- the initial tune path is unchanged.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import optuna
import pytest
from lizyml.tuning import RoundRecord, StudyLineage

from lizystudio.backends.exceptions import StudyNotResumableError
from lizystudio.backends.lizyml import LizyMLAdapter, study_continuation
from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import (
    _build_optuna_storage_url,
    _build_optuna_study_name,
    run_tune,
)

pytestmark = pytest.mark.unit


# --- Helpers ----------------------------------------------------------------


def _count_study_trials(storage_url: str, study_name: str) -> int:
    study = optuna.load_study(storage=storage_url, study_name=study_name)
    return len(study.trials)


class _StubBackend:
    """Minimal :class:`BackendAdapter` stub for exercising ``run_tune``.

    ``tune`` records its arguments. On the initial (non-resume) path it
    simulates lizyml by appending the configured ``n_trials`` to the
    persisted study, so the baseline test can count them. ``tune_error``
    makes ``tune`` raise instead.
    """

    def __init__(self, tune_error: Exception | None = None) -> None:
        self.tune_calls: list[dict[str, Any]] = []
        self.fit_calls: list[Any] = []
        self.tune_error = tune_error

    def preflight_checkpoint_dir(self, _job_dir: Path) -> None:
        return None

    def create_model(self, config: dict[str, Any], _dataframe: Any) -> Any:
        self._last_create_config = config
        return object()

    def compute_effective_tuning(self, task: str, overrides: Any) -> Any:
        raise NotImplementedError  # INV-T3 check logs and returns

    def tune(
        self,
        _model: Any,
        *,
        on_progress: Any = None,
        re_tune: dict[str, Any] | None = None,
        checkpoint_dir: Any = None,
        resume: bool = False,
        storage: str | None = None,
        study_name: str | None = None,
    ) -> TuningSummary:
        cfg = self._last_create_config
        n_trials = (
            cfg.get("tuning", {}).get("optuna", {}).get("params", {}).get("n_trials", 0)
        )
        self.tune_calls.append(
            {
                "n_trials": n_trials,
                "resume": resume,
                "storage": storage,
                "study_name": study_name,
                "re_tune": re_tune,
            }
        )
        if self.tune_error is not None:
            raise self.tune_error
        if not resume and storage is not None and study_name is not None:
            study = optuna.create_study(
                storage=storage, study_name=study_name, direction="minimize"
            )
            space = {"x": optuna.distributions.FloatDistribution(0.0, 1.0)}
            for _ in range(n_trials):
                trial = study.ask(space)
                study.tell(trial, 0.5)
        return TuningSummary(
            best_params={"x": 0.5},
            best_score=0.0,
            trials=[],
            metric_name="rmse",
            direction="minimize",
        )

    def fit(
        self, _model: Any, *, params: Any = None, on_progress: Any = None
    ) -> FitSummary:
        self.fit_calls.append(params)
        return FitSummary(metrics={}, fold_count=1, params=[])

    def export_model(self, _model: Any, path: str) -> str:
        Path(path).mkdir(parents=True, exist_ok=True)
        return path

    def plot(self, _model: Any, _kind: str) -> Any:
        class _P:
            plotly_json = "{}"

        return _P()


def _make_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )


def _tune_config(n_trials: int) -> dict[str, Any]:
    return {
        "task": "regression",
        "data": {"target": "y"},
        "evaluation": {"metrics": ["rmse"]},
        "tuning": {
            "optuna": {"params": {"n_trials": n_trials, "direction": "minimize"}}
        },
    }


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _claim(job_store: JobStore, config: dict[str, Any]) -> Any:
    job = job_store.create_and_claim_active(
        backend_name="stub",
        config=config,
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job is not None
    return job


# --- Service: unpause hands the decision to the backend ---------------------


def test_unpause_calls_tune_once_with_resume_and_the_jobs_study(
    job_store: JobStore,
) -> None:
    """The service no longer counts trials or rewrites ``n_trials``."""
    config = _tune_config(8)
    config["tuning"]["re_tune"] = {"n_rounds": 3, "n_trials": 2}
    backend = _StubBackend()
    job = _claim(job_store, config)

    done = run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=config,
        dataframe=object(),
        resume_from_existing_study=True,
    )

    assert done.status == "completed"
    assert backend.tune_calls == [
        {
            "n_trials": 8,
            "resume": True,
            "storage": _build_optuna_storage_url(job_store.job_dir(job.job_id)),
            "study_name": _build_optuna_study_name(job.job_id),
            "re_tune": {"n_rounds": 3, "n_trials": 2},
        }
    ]
    assert len(backend.fit_calls) == 1


def test_unpause_of_a_study_the_backend_cannot_continue_fails_the_job(
    job_store: JobStore,
) -> None:
    """A refused study fails through the existing transitions (P-0116 D3)."""
    backend = _StubBackend(
        tune_error=StudyNotResumableError("legacy study", state="legacy")
    )
    job = _claim(job_store, _tune_config(4))

    done = run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=_tune_config(4),
        dataframe=object(),
        resume_from_existing_study=True,
    )

    assert done.status == "failed"
    assert done.error is not None
    assert "StudyNotResumableError" in done.error
    assert len(backend.tune_calls) == 1
    assert len(backend.fit_calls) == 0
    assert job_store.active_job_id is None


# --- INV-4 at the adapter: the budget is not spent twice --------------------


class _FakeModel:
    def __init__(self) -> None:
        self._tuning_result = None
        self.tune_calls: list[dict[str, Any]] = []
        self.restore_calls = 0

    def _result(self) -> SimpleNamespace:
        return SimpleNamespace(
            best_params={"x": 0.5},
            best_score=0.1,
            trials=[],
            metric_name="rmse",
            direction="minimize",
            rounds=None,
            boundary_report=None,
        )

    def tune(self, **kwargs: Any) -> SimpleNamespace:
        kwargs.pop("progress_callback", None)
        self.tune_calls.append(kwargs)
        return self._result()

    def restore_tuning(self, storage: Any, study_name: Any) -> SimpleNamespace:
        self.restore_calls += 1
        return self._result()


def _record(k: int, status: Any) -> RoundRecord:
    return RoundRecord(
        round=k,
        status=status,
        n_trials=8,
        n_finished=8 if status == "completed" else 5,
        best_score_before=None,
        best_score_after=0.1 if status == "completed" else None,
    )


def _adapter_unpause(
    monkeypatch: pytest.MonkeyPatch, lineage: StudyLineage, model: _FakeModel
) -> None:
    monkeypatch.setattr(
        study_continuation, "read_study_lineage", lambda storage, name: lineage
    )
    LizyMLAdapter().tune(
        model,
        re_tune=None,
        resume=True,
        storage="sqlite:///unused.db",
        study_name="studio-tune-554",
    )


def test_unpause_after_the_budget_was_spent_runs_no_trial(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pause arrived AFTER the tune loop completed: the round is closed.

    Pre-fix, the configured ``n_trials`` ran again (total ``2N``).
    """
    model = _FakeModel()
    lineage = StudyLineage(state="completed", rounds=(_record(1, "completed"),))

    _adapter_unpause(monkeypatch, lineage, model)

    assert len(model.tune_calls) == 0
    assert model.restore_calls == 1


def test_unpause_of_an_open_round_runs_only_its_remaining_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pause arrived mid-round: lizyml finishes the round's recorded budget.

    The adapter must not pass ``n_trials`` (pre-fix it passed the full
    budget; the #554 fix passed the remainder, which lizyml 0.20 refuses).
    """
    model = _FakeModel()
    lineage = StudyLineage(state="open", rounds=(_record(1, "open"),), open_round=1)

    _adapter_unpause(monkeypatch, lineage, model)

    assert model.restore_calls == 0
    assert len(model.tune_calls) == 1
    assert model.tune_calls[0] == {
        "storage": "sqlite:///unused.db",
        "study_name": "studio-tune-554",
        "resume": True,
    }


# --- Baseline: non-resume path is unchanged --------------------------------


def test_initial_tune_path_unchanged_without_resume_flag(job_store: JobStore) -> None:
    """The default ``resume_from_existing_study=False`` MUST preserve the
    legacy single-shot behaviour. Regression guard against an accidental
    flip that would break initial Tune jobs."""
    target_n_trials = 4
    backend = _StubBackend()
    job = _claim(job_store, _tune_config(target_n_trials))

    run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=_tune_config(target_n_trials),
        dataframe=object(),
        # Default: resume_from_existing_study=False
    )

    assert len(backend.tune_calls) == 1
    assert backend.tune_calls[0]["n_trials"] == target_n_trials, (
        "Initial tune path must forward the full configured n_trials. "
        f"Got: {backend.tune_calls[0]}"
    )
    assert backend.tune_calls[0]["resume"] is False

    # Study should have exactly target_n_trials after the stub's simulation.
    storage_url = _build_optuna_storage_url(job_store.job_dir(job.job_id))
    study_name = _build_optuna_study_name(job.job_id)
    assert _count_study_trials(storage_url, study_name) == target_n_trials
