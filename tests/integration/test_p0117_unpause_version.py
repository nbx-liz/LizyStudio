"""An unpause across lizyml minors is refused before the job starts (P-0117 D3).

Real lizyml, a real paused Tune written by the installed lizyml through
``run_tune``, and the real ``POST /api/jobs/{id}/unpause`` route.  The
preflight compares the paused job's checkpoint sidecar (``model_meta.json``
``lizyml_version``) with the installed lizyml on major.minor (Decision A-2):

* the same minor proceeds, and the relaunched job continues the study;
* another minor is refused with 400 ``PICKLE_INCOMPATIBLE``
  (``lizyml_version_mismatch``), the job stays paused;
* a sidecar the preflight cannot read is refused too (fail closed, DC1):
  a missing file (``missing_meta``), unreadable JSON or a non-object
  (``corrupt_meta``), and a missing, non-string or unparseable version
  (``lizyml_version_mismatch``).

The real 0.20 paused job is in ``test_p0117_legacy_020_jobs.py``.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import lizyml
import optuna
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.exceptions import CheckpointIncompatibleError
from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.lizyml.pickle_compat import major_minor
from lizystudio.server import create_app
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import (
    _build_optuna_storage_url,
    _build_optuna_study_name,
    run_tune,
)
from tests.integration.test_unpause_study_continuation import (
    FIXTURE_DIR,
    _config,
    _dataframe,
    _new_job,
    _PauseOnFirstTrial,
)

pytestmark = pytest.mark.integration

# Two planned rounds: the pause parks the job after round 1, so the unpause
# runs round 2 (2 trials) instead of restoring.
_CONFIG = _config(3, re_tune={"n_rounds": 2, "n_trials": 2})
_TRIALS_BEFORE = 3
_TRIALS_AFTER = 5


@dataclass(frozen=True)
class _PausedJob:
    jobs_dir: Path
    job_id: str


@pytest.fixture(scope="module")
def paused_job(tmp_path_factory: pytest.TempPathFactory) -> _PausedJob:
    """A Tune the installed lizyml paused after its first round, once per module."""
    jobs_dir = tmp_path_factory.mktemp("paused") / "jobs"
    job_store = JobStore(jobs_dir)
    job = _new_job(job_store, _CONFIG)
    paused = run_tune(
        job=job,
        job_store=job_store,
        backend=LizyMLAdapter(),
        config=_CONFIG,
        dataframe=_dataframe(),
        broadcaster=_PauseOnFirstTrial(job_store),  # type: ignore[arg-type]
    )
    assert paused.status == "paused", paused.error
    sidecar = json.loads(
        (job_store.job_dir(job.job_id) / "model_meta.json").read_text()
    )
    # The sidecar run_tune's checkpoint saves wrote, not a hand-made one (DC7).
    assert sidecar["lizyml_version"] == lizyml.__version__
    return _PausedJob(jobs_dir=jobs_dir, job_id=job.job_id)


@dataclass
class _Server:
    client: TestClient
    job_store: JobStore
    job_dir: Path
    job_id: str
    launched: list[dict[str, Any]]


@pytest.fixture()
def server(
    paused_job: _PausedJob, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[_Server]:
    """A server over a copy of the paused job, with data loaded and launch captured."""
    jobs_dir = tmp_path / "jobs"
    shutil.copytree(paused_job.jobs_dir, jobs_dir)
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    launched: list[dict[str, Any]] = []
    from lizystudio.api import jobs as jobs_api

    monkeypatch.setattr(jobs_api, "start_tune_async", lambda **kw: launched.append(kw))
    with TestClient(create_app()) as client:
        app: Any = client.app
        job_store: JobStore = app.state.job_store
        job = job_store.get(paused_job.job_id)
        assert job is not None and job.status == "paused"
        assert job_store.is_pause_requested(job.job_id) is True
        app.state.workspace.set_data(
            pd.read_csv(FIXTURE_DIR / "data.csv"), job.data_ref
        )
        yield _Server(
            client=client,
            job_store=job_store,
            job_dir=job_store.job_dir(job.job_id),
            job_id=job.job_id,
            launched=launched,
        )


def _trial_count(job_dir: Path, job_id: str) -> int:
    study = optuna.load_study(
        storage=_build_optuna_storage_url(job_dir),
        study_name=_build_optuna_study_name(job_id),
    )
    return len(study.trials)


def _installed_minor() -> tuple[int, int]:
    mm = major_minor(lizyml.__version__)
    assert mm is not None, lizyml.__version__
    return mm


def _write_sidecar(job_dir: Path, payload: object) -> None:
    (job_dir / "model_meta.json").write_text(json.dumps(payload), encoding="utf-8")


def _sidecar_with_version(version: object) -> Callable[[Path], None]:
    def mutate(job_dir: Path) -> None:
        meta = json.loads((job_dir / "model_meta.json").read_text())
        meta["lizyml_version"] = version
        _write_sidecar(job_dir, meta)

    return mutate


# --- the same minor proceeds -----------------------------------------------------


def test_same_version_paused_tune_unpauses_and_continues_the_study(
    server: _Server,
) -> None:
    assert _trial_count(server.job_dir, server.job_id) == _TRIALS_BEFORE

    res = server.client.post(f"/api/jobs/{server.job_id}/unpause")

    assert res.status_code == 200, res.text
    assert res.json() == {"status": "unpause_started", "job_id": server.job_id}
    assert len(server.launched) == 1
    assert server.job_store.is_pause_requested(server.job_id) is False
    # Run the launch the route asked for, as the thread worker would.
    kw = server.launched[0]
    assert kw["resume_from_existing_study"] is True
    done = run_tune(
        job=kw["job"],
        job_store=kw["job_store"],
        backend=kw["ws"].backend,
        config=kw["config"],
        dataframe=kw["dataframe"],
        resume_from_existing_study=True,
    )
    assert done.status == "completed", done.error
    assert _trial_count(server.job_dir, server.job_id) == _TRIALS_AFTER


def test_another_patch_of_the_installed_minor_unpauses(server: _Server) -> None:
    major, minor = _installed_minor()
    _sidecar_with_version(f"{major}.{minor}.999")(server.job_dir)

    res = server.client.post(f"/api/jobs/{server.job_id}/unpause")

    assert res.status_code == 200, res.text
    assert len(server.launched) == 1


# --- refusals ---------------------------------------------------------------------


def _other_minor() -> str:
    major, minor = _installed_minor()
    return f"{major}.{minor + 1}.0"


def _drop_sidecar(job_dir: Path) -> None:
    (job_dir / "model_meta.json").unlink()


def _invalid_json(job_dir: Path) -> None:
    (job_dir / "model_meta.json").write_text("{", encoding="utf-8")


def _invalid_utf8(job_dir: Path) -> None:
    (job_dir / "model_meta.json").write_bytes(b'{"lizyml_version": "\xff"}')


def _not_an_object(job_dir: Path) -> None:
    _write_sidecar(job_dir, ["lizyml_version", lizyml.__version__])


def _no_version_key(job_dir: Path) -> None:
    meta = json.loads((job_dir / "model_meta.json").read_text())
    del meta["lizyml_version"]
    _write_sidecar(job_dir, meta)


REFUSALS: dict[str, tuple[Callable[[Path], None], str]] = {
    "other_minor": (_sidecar_with_version(_other_minor()), "lizyml_version_mismatch"),
    "missing_sidecar": (_drop_sidecar, "missing_meta"),
    "invalid_json": (_invalid_json, "corrupt_meta"),
    "invalid_utf8": (_invalid_utf8, "corrupt_meta"),
    "not_an_object": (_not_an_object, "corrupt_meta"),
    "no_version_key": (_no_version_key, "lizyml_version_mismatch"),
    "empty_version": (_sidecar_with_version(""), "lizyml_version_mismatch"),
    "non_string_version": (_sidecar_with_version(21), "lizyml_version_mismatch"),
    "unparseable_version": (
        _sidecar_with_version("unknown"),
        "lizyml_version_mismatch",
    ),
}


@pytest.mark.parametrize("case", sorted(REFUSALS))
def test_unpause_is_refused_before_the_job_starts(server: _Server, case: str) -> None:
    mutate, kind = REFUSALS[case]
    mutate(server.job_dir)
    sidecar = server.job_dir / "model_meta.json"
    sidecar_before = sidecar.read_bytes() if sidecar.exists() else None

    res = server.client.post(f"/api/jobs/{server.job_id}/unpause")

    assert res.status_code == 400, res.text
    error: dict[str, Any] = res.json()["error"]
    assert error["code"] == "PICKLE_INCOMPATIBLE"
    assert error["details"]["kind"] == kind
    assert error["details"]["recovery_hint"] == "Start a new Tune"
    assert "Start a new Tune" in error["message"]
    assert server.launched == []
    assert server.job_store.is_pause_requested(server.job_id) is True
    reloaded = server.job_store.get(server.job_id)
    assert reloaded is not None and reloaded.status == "paused"
    assert _trial_count(server.job_dir, server.job_id) == _TRIALS_BEFORE
    after = sidecar.read_bytes() if sidecar.exists() else None
    assert after == sidecar_before


def test_other_minor_message_names_both_versions(server: _Server) -> None:
    other = _other_minor()
    _sidecar_with_version(other)(server.job_dir)

    res = server.client.post(f"/api/jobs/{server.job_id}/unpause")

    assert res.status_code == 400, res.text
    message = res.json()["error"]["message"]
    assert other in message
    assert lizyml.__version__ in message


# --- adapter ---------------------------------------------------------------------


def test_a_storage_without_a_sidecar_location_is_refused_before_any_read() -> None:
    # Studio's storage is always a SQLite file beside the sidecar; any other
    # URL cannot name a sidecar, so it is refused before the lineage is read
    # (a read of this URL would fail with a connection error instead).
    with pytest.raises(CheckpointIncompatibleError) as excinfo:
        LizyMLAdapter().verify_study_continuable(
            "postgresql://studio@127.0.0.1:1/none", "studio-tune-x"
        )

    assert excinfo.value.kind == "missing_meta"
    assert excinfo.value.recovery_hint == "Start a new Tune"
