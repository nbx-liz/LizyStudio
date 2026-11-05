"""Jobs written by lizyml 0.20 keep working under 0.21, or refuse clearly (P-0117 D1).

The fixtures under ``tests/fixtures/lizyml020/jobs/`` are real jobs a
LizyStudio server on lizyml 0.20.0 wrote (see that directory's README): a
Fit, a completed Tune and a paused Tune.  Under the installed lizyml 0.21:

* the completed Fit and Tune read, show metrics and plots, give split and
  SHAP importance, predict with SHAP, export code and export the model;
* retune of the completed Tune is refused with 400 ``PICKLE_INCOMPATIBLE``
  before any child job is made, and the parent row stays;
* the paused Tune's detail, log and lineage are readable, and its unpause is
  refused with 400 ``PICKLE_INCOMPATIBLE`` before the job starts, because
  its study was written by another lizyml minor (D3): the job stays paused
  and no trial is added.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import optuna
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.server import create_app
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
LEGACY_JOBS = _FIXTURES / "lizyml020" / "jobs"
# The 0.20 jobs were trained on this file (byte-identical copy).
LEGACY_DATA = _FIXTURES / "lizyml" / "binary_no_cal" / "data.csv"

FIT_JOB = "job_cc625b97"
TUNED_JOB = "job_e1afdffa"
PAUSED_JOB = "job_44a36460"
COMPLETED_JOBS = (FIT_JOB, TUNED_JOB)
ALL_JOBS = (FIT_JOB, TUNED_JOB, PAUSED_JOB)


def _copy_legacy_jobs(jobs_dir: Path) -> None:
    """Copy the fixture jobs into *jobs_dir*, pointing ``model_path`` at the copy.

    A missing fixture fails the test (DC1): nothing here is optional.
    """
    jobs_dir.mkdir(parents=True, exist_ok=True)
    for job_id in ALL_JOBS:
        src = LEGACY_JOBS / job_id
        assert (src / "meta.json").is_file(), f"fixture missing: {src}"
        dst = jobs_dir / job_id
        shutil.copytree(src, dst)
        meta_path = dst / "meta.json"
        meta = json.loads(meta_path.read_text())
        if meta["model_path"] is not None:
            meta["model_path"] = str(dst / "model")
        meta_path.write_text(json.dumps(meta))


@pytest.fixture()
def legacy_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    jobs_dir = tmp_path / "jobs"
    _copy_legacy_jobs(jobs_dir)
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    with TestClient(create_app()) as c:
        yield c


def _error(res: Any) -> dict[str, Any]:
    body: dict[str, Any] = res.json()["error"]
    return body


def test_the_fixtures_were_written_by_lizyml_020() -> None:
    # The whole point of the corpus: artifacts 0.20 wrote, not the installed
    # lizyml (DC5).  A re-capture would silently turn every test below into a
    # same-version test.
    for job_id in COMPLETED_JOBS:
        metadata = json.loads(
            (LEGACY_JOBS / job_id / "model" / "metadata.json").read_text()
        )
        assert metadata["lizyml_version"] == "0.20.0"
        assert metadata["format_version"] == 4
    for job_id in (TUNED_JOB, PAUSED_JOB):
        sidecar = json.loads((LEGACY_JOBS / job_id / "model_meta.json").read_text())
        assert sidecar["lizyml_version"] == "0.20.0"


# --- read ------------------------------------------------------------------


def test_list_and_detail_of_020_jobs_keep_working(
    legacy_client: TestClient,
) -> None:
    res = legacy_client.get("/api/jobs")
    assert res.status_code == 200, res.text
    listed = {j["job_id"]: j["status"] for j in res.json()}
    assert listed[FIT_JOB] == "completed"
    assert listed[TUNED_JOB] == "completed"
    assert listed[PAUSED_JOB] == "paused"
    for job_id in ALL_JOBS:
        detail = legacy_client.get(f"/api/jobs/{job_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["job_id"] == job_id


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
def test_metrics_of_020_jobs_keep_working(
    legacy_client: TestClient, job_id: str
) -> None:
    res = legacy_client.get(f"/api/jobs/{job_id}/metrics")
    assert res.status_code == 200, res.text
    assert res.json()


_BINARY_PLOTS = [
    "learning-curve",
    "roc-curve",
    "importance",
    "oof-distribution",
    "shap-summary",
]
# The exact list each 0.20 job offers.  /plots drops a plot whose probe
# raises, so a count or a discovered list would let a compatibility
# regression shrink the tested set instead of failing (DC1/DC2).
EXPECTED_PLOTS = {
    FIT_JOB: _BINARY_PLOTS,
    TUNED_JOB: [*_BINARY_PLOTS, "tuning"],
}


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
def test_every_expected_plot_of_020_jobs_renders(
    legacy_client: TestClient, job_id: str
) -> None:
    listed = legacy_client.get(f"/api/jobs/{job_id}/plots")
    assert listed.status_code == 200, listed.text
    plot_types: list[str] = listed.json()
    assert plot_types == EXPECTED_PLOTS[job_id]
    for plot_type in EXPECTED_PLOTS[job_id]:
        res = legacy_client.get(f"/api/jobs/{job_id}/plot/{plot_type}")
        assert res.status_code == 200, f"{plot_type}: {res.text}"


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
@pytest.mark.parametrize("kind", ["split", "shap"])
def test_importance_of_020_jobs_keeps_working(
    legacy_client: TestClient, job_id: str, kind: str
) -> None:
    res = legacy_client.get(f"/api/jobs/{job_id}/importance?kind={kind}")
    assert res.status_code == 200, res.text
    assert res.json()


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
def test_inference_with_shap_on_020_jobs_keeps_working(
    legacy_client: TestClient, tmp_path: Path, job_id: str
) -> None:
    data = tmp_path / "infer.csv"
    shutil.copyfile(LEGACY_DATA, data)

    res = legacy_client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(data)},
            "return_shap": True,
        },
    )

    assert res.status_code == 200, res.text
    inf_id = res.json()["inf_id"]
    preds = legacy_client.get(
        f"/api/inference/{inf_id}/predictions", params={"job_id": job_id}
    )
    assert preds.status_code == 200, preds.text


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
def test_export_code_of_020_jobs_keeps_working(
    legacy_client: TestClient, job_id: str
) -> None:
    res = legacy_client.get(f"/api/jobs/{job_id}/export-code")

    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"


@pytest.mark.parametrize("job_id", COMPLETED_JOBS)
def test_model_export_of_020_jobs_keeps_working(
    legacy_client: TestClient, tmp_path: Path, job_id: str
) -> None:
    out = tmp_path / f"export_{job_id}"

    res = legacy_client.post(
        f"/api/jobs/{job_id}/export",
        json={"export_type": "model", "output_path": str(out)},
    )

    assert res.status_code == 200, res.text
    exported = Path(res.json()["exported_path"])
    metadata = json.loads((exported / "metadata.json").read_text())
    # Written by the installed lizyml in format 5, which 0.20 cannot read
    # (one way).  ``lizyml_version`` is the training run's, so it stays 0.20.
    assert metadata["format_version"] == 5
    assert metadata["lizyml_version"] == "0.20.0"


# --- retune ------------------------------------------------------------------


def test_retune_of_a_020_tune_is_refused_and_the_row_stays(
    legacy_client: TestClient,
) -> None:
    app: Any = legacy_client.app
    job_store: JobStore = app.state.job_store
    before = {j.job_id for j in job_store.list()}

    res = legacy_client.post(f"/api/jobs/{TUNED_JOB}/retune", json={"n_trials": 2})

    assert res.status_code == 400, res.text
    error = _error(res)
    assert error["code"] == "PICKLE_INCOMPATIBLE"
    assert error["details"]["kind"] == "lizyml_version_mismatch"
    assert "0.20.0" in error["message"]
    # No child job was made, and the parent is still a completed Tune.
    assert {j.job_id for j in job_store.list()} == before
    parent = job_store.get(TUNED_JOB)
    assert parent is not None and parent.status == "completed"
    assert job_store.get_locked_child(TUNED_JOB) is None


# --- the paused Tune -----------------------------------------------------------


def test_detail_log_and_lineage_of_a_020_paused_tune_are_readable(
    legacy_client: TestClient,
) -> None:
    detail = legacy_client.get(f"/api/jobs/{PAUSED_JOB}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["status"] == "paused"

    log = legacy_client.get(f"/api/jobs/{PAUSED_JOB}/log")
    assert log.status_code == 200, log.text
    # The log 0.20 wrote, as committed (only the venv prefix is scrubbed):
    # the route must return its content, not the missing-file default.
    committed = (LEGACY_JOBS / PAUSED_JOB / "execution.log").read_text()
    assert committed.count("PausedError") == 11, committed
    assert log.json() == {"log": committed}

    lineage = legacy_client.get(f"/api/jobs/{PAUSED_JOB}/lineage")
    assert lineage.status_code == 200, lineage.text
    assert lineage.json()["tree"]["job_id"] == PAUSED_JOB


def _trial_count(job_dir: Path, job_id: str) -> int:
    study = optuna.load_study(
        storage=f"sqlite:///{(job_dir / 'optuna.db').resolve()}",
        study_name=f"studio-tune-{job_id}",
    )
    return len(study.trials)


def test_unpause_of_a_020_paused_tune_is_refused_before_the_job_starts(
    legacy_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    app: Any = legacy_client.app
    job_store: JobStore = app.state.job_store
    job_dir = job_store.job_dir(PAUSED_JOB)
    trials_before = _trial_count(job_dir, PAUSED_JOB)
    assert trials_before == 30
    sidecar_before = (job_dir / "model_meta.json").read_bytes()
    job = job_store.get(PAUSED_JOB)
    assert job is not None and job.status == "paused"
    assert job_store.is_pause_requested(PAUSED_JOB) is True
    app.state.workspace.set_data(pd.read_csv(LEGACY_DATA), job.data_ref)

    launched: list[object] = []
    from lizystudio.api import jobs as jobs_api

    monkeypatch.setattr(jobs_api, "start_tune_async", lambda **kw: launched.append(kw))

    res = legacy_client.post(f"/api/jobs/{PAUSED_JOB}/unpause")

    assert res.status_code == 400, res.text
    error = _error(res)
    assert error["code"] == "PICKLE_INCOMPATIBLE"
    assert error["details"]["kind"] == "lizyml_version_mismatch"
    assert error["details"]["recovery_hint"] == "Start a new Tune"
    assert "0.20.0" in error["message"]
    assert "Start a new Tune" in error["message"]
    # Refused before the start: no worker, the PAUSE flag and the status
    # kept, the study and the sidecar untouched.
    assert launched == []
    assert job_store.is_pause_requested(PAUSED_JOB) is True
    reloaded = job_store.get(PAUSED_JOB)
    assert reloaded is not None and reloaded.status == "paused"
    assert json.loads((job_dir / "meta.json").read_text())["status"] == "paused"
    assert _trial_count(job_dir, PAUSED_JOB) == trials_before
    assert (job_dir / "model_meta.json").read_bytes() == sidecar_before
