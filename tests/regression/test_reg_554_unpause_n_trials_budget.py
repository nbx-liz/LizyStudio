"""Regression test for Issue #554 — unpause must preserve the original n_trials budget.

R-1.4 (Tune resumability) INV-4: after a pause → unpause round-trip, the
Optuna study attached to the same ``job_id`` MUST end up with exactly
``n_trials`` completed trials, regardless of which phase observed the
PAUSE flag.

Pre-fix bug
-----------
``POST /jobs/{id}/unpause`` (P-0099 v3-20d) called ``start_tune_async``
which re-entered ``run_tune`` from the top. ``run_tune`` constructed a
fresh model from the original config and called
``backend.tune(..., storage=..., study_name=...)``. lizyml attaches to
the persisted study via ``load_if_exists=True`` and then runs
``study.optimize(n_trials=original_n_trials)`` — which under Optuna
semantics **appends** ``original_n_trials`` MORE trials, totalling
``2 * n_trials`` whenever the pause arrived after the tune loop
completed (CI 16, expected 8).

Fix shape
---------
``run_tune`` learns an opt-in ``resume_from_existing_study`` flag.
When ``True`` (only the unpause path sets it):

1. Inspect the persisted Optuna study at ``storage_url`` / ``study_name``
2. ``remaining = max(0, target - existing)``
3. If ``remaining > 0`` — mutate ``tune_config[...n_trials...]`` so the
   subsequent ``backend.tune(...)`` only runs ``remaining`` more trials.
4. If ``remaining == 0`` — skip ``backend.tune(...)`` entirely. The
   previous tune phase already populated the study to capacity; the
   unpause job proceeds straight to the auto-fit phase using the
   persisted best_params.

Both branches enforce INV-4: ``len(study.trials) == n_trials`` after
unpause completion, never ``2 * n_trials``.

Working pattern reference
-------------------------
``training_retune.py:104`` already passes ``resume=True`` to
``backend.tune`` from the H-0062 retune path; the fix here is to mirror
that resume-aware behaviour for the unpause flow but with the additional
``remaining`` math (lizyml's ``model.tune(resume=True, n_trials=N)`` does
NOT cap at N total — see lizyml ``tuner.py::Tuner.tune`` which calls
``study.optimize(n_trials=N)`` unconditionally).

The tests below pin both:
- INV-4 holds when the pre-existing study is already at capacity
  (``existing == target``) — the fix must SKIP ``backend.tune``.
- INV-4 holds when the pre-existing study is partially filled
  (``existing < target``) — the fix must run only ``remaining`` trials.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import optuna
import pytest

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import (
    _build_optuna_storage_url,
    _build_optuna_study_name,
    run_tune,
)

pytestmark = pytest.mark.unit


# --- Helpers ----------------------------------------------------------------


def _seed_optuna_study(
    *,
    storage_url: str,
    study_name: str,
    n_trials: int,
    direction: str = "minimize",
) -> None:
    """Pre-populate a persisted Optuna study with N completed trials.

    Mirrors lizyml's storage shape so the SUT can re-attach via
    ``load_if_exists=True``. Trials use a single ``x`` FloatDistribution
    over [0, 1]; the values are deterministic so the test does not
    depend on TPE sampler entropy.
    """
    study = optuna.create_study(
        storage=storage_url, study_name=study_name, direction=direction
    )
    space = {"x": optuna.distributions.FloatDistribution(0.0, 1.0)}
    for i in range(n_trials):
        trial = study.ask(space)
        study.tell(trial, float(i) / max(1, n_trials))


def _count_study_trials(storage_url: str, study_name: str) -> int:
    study = optuna.load_study(storage=storage_url, study_name=study_name)
    return len(study.trials)


class _StubBackend:
    """Minimal :class:`BackendAdapter` stub for exercising ``run_tune``.

    ``tune`` simulates lizyml's behaviour: it loads the persisted study
    via ``load_if_exists=True`` and ``study.optimize(n_trials=N)`` runs
    N MORE trials. Recorded on ``tune_n_trials_seen`` so the test can
    assert how many trials the SUT requested.
    """

    def __init__(self) -> None:
        self.tune_calls: list[dict[str, Any]] = []
        self.fit_calls: list[Any] = []
        self.load_checkpoint_calls: list[Path] = []

    def preflight_checkpoint_dir(self, _job_dir: Path) -> None:
        return None

    def create_model(self, config: dict[str, Any], _dataframe: Any) -> Any:
        # Stash the config for later inspection (the fix mutates n_trials here)
        self._last_create_config = config
        return object()

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
        # Read n_trials from the model's config (what lizyml reads).
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
        # Simulate lizyml: optuna.create_study(load_if_exists=True) +
        # study.optimize(n_trials=N) appends N MORE trials to whatever
        # is already persisted. The SUT either:
        #   - mutates cfg n_trials to `remaining` and calls us once OR
        #   - skips this method entirely.
        # Either way, we append exactly the n_trials-many trials the
        # caller requested into the persisted study.
        if storage is not None and study_name is not None and n_trials > 0:
            study = optuna.create_study(
                storage=storage,
                study_name=study_name,
                direction="minimize",
                load_if_exists=True,
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
        # Return a stub PlotData-shaped object; _save_tuning_plot
        # swallows exceptions so even returning None would be fine.
        class _P:
            plotly_json = "{}"

        return _P()

    def load_checkpoint(self, path: Path, *, allowed_root: Path | None = None) -> Any:
        self.load_checkpoint_calls.append(path)
        return object()


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


# --- INV-4 regression: full budget already spent ---------------------------


def test_unpause_skips_tune_when_existing_equals_target(job_store: JobStore) -> None:
    """Pause arrived AFTER the tune loop completed: existing == target.

    INV-4: the persisted study MUST still have exactly ``target_n_trials``
    after unpause completes. Pre-fix, ``backend.tune`` was invoked and
    Optuna appended ``target_n_trials`` MORE trials (total ``2N``).
    """
    target_n_trials = 8
    backend = _StubBackend()
    job = job_store.create_and_claim_active(
        backend_name="stub",
        config=_tune_config(target_n_trials),
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job is not None

    storage_url = _build_optuna_storage_url(job_store.job_dir(job.job_id))
    study_name = _build_optuna_study_name(job.job_id)
    _seed_optuna_study(
        storage_url=storage_url,
        study_name=study_name,
        n_trials=target_n_trials,
    )

    run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=_tune_config(target_n_trials),
        dataframe=object(),
        resume_from_existing_study=True,
    )

    assert _count_study_trials(storage_url, study_name) == target_n_trials, (
        f"INV-4 violated: study has {_count_study_trials(storage_url, study_name)} "
        f"trials after unpause, expected {target_n_trials}"
    )
    assert len(backend.tune_calls) == 0, (
        "backend.tune MUST be skipped when the study already holds the "
        "full n_trials budget (existing == target); calling it would "
        f"append {target_n_trials} more trials. Got: {backend.tune_calls}"
    )
    assert len(backend.fit_calls) == 1, (
        "Auto-fit phase MUST still run after unpause (best_params from "
        f"the persisted study). Got fit_calls={backend.fit_calls!r}"
    )


# --- INV-4 regression: partial budget spent --------------------------------


def test_unpause_runs_only_remaining_trials(job_store: JobStore) -> None:
    """Pause arrived mid-tune: existing < target.

    INV-4: backend.tune MUST be called with ``n_trials = target - existing``,
    not ``n_trials = target``. Pre-fix the full ``target`` was forwarded
    and the final study had ``existing + target = 13`` trials instead of 8.
    """
    target_n_trials = 8
    existing = 5
    expected_remaining = target_n_trials - existing
    backend = _StubBackend()
    job = job_store.create_and_claim_active(
        backend_name="stub",
        config=_tune_config(target_n_trials),
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job is not None

    storage_url = _build_optuna_storage_url(job_store.job_dir(job.job_id))
    study_name = _build_optuna_study_name(job.job_id)
    _seed_optuna_study(
        storage_url=storage_url, study_name=study_name, n_trials=existing
    )

    run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=_tune_config(target_n_trials),
        dataframe=object(),
        resume_from_existing_study=True,
    )

    assert _count_study_trials(storage_url, study_name) == target_n_trials, (
        "INV-4 violated: study has "
        f"{_count_study_trials(storage_url, study_name)} trials after "
        f"unpause, expected {target_n_trials}"
    )
    assert len(backend.tune_calls) == 1, (
        f"backend.tune must run exactly once when remaining > 0. "
        f"Got: {backend.tune_calls}"
    )
    assert backend.tune_calls[0]["n_trials"] == expected_remaining, (
        f"backend.tune received n_trials={backend.tune_calls[0]['n_trials']}, "
        f"expected {expected_remaining} (= target {target_n_trials} - "
        f"existing {existing}). Pre-fix this was {target_n_trials}, doubling "
        "the budget."
    )


# --- Baseline: non-resume path is unchanged --------------------------------


def test_initial_tune_path_unchanged_without_resume_flag(job_store: JobStore) -> None:
    """The default ``resume_from_existing_study=False`` MUST preserve the
    legacy single-shot behaviour. Regression guard against an accidental
    flip that would break initial Tune jobs."""
    target_n_trials = 4
    backend = _StubBackend()
    job = job_store.create_and_claim_active(
        backend_name="stub",
        config=_tune_config(target_n_trials),
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job is not None

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

    # Study should have exactly target_n_trials after the stub's simulation.
    storage_url = _build_optuna_storage_url(job_store.job_dir(job.job_id))
    study_name = _build_optuna_study_name(job.job_id)
    assert _count_study_trials(storage_url, study_name) == target_n_trials
