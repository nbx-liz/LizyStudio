"""Jobs written by lizyml 0.15 refuse what 0.20 cannot do, clearly (P-0116 D4, child 7).

The fixtures under ``tests/fixtures/lizyml015/jobs/`` are real jobs a
LizyStudio server on lizyml 0.15.0 wrote (see that directory's README):
a Fit, a completed Tune and a paused Tune.  Under lizyml 0.20:

* unpausing the paused Tune is refused with 400 ``PICKLE_INCOMPATIBLE``
  before the job starts, because its study has no lizyml record;
* SHAP importance and the SHAP plots are refused with 400
  ``REFIT_REQUIRED`` (the artifacts lack ``pipeline_state_per_fold``);
* export-code on the Tuned job is refused with 400 ``REFIT_REQUIRED``
  (its ``model.params`` hold names lizyml 0.20 routes elsewhere);
* everything else keeps working.

The refusals are narrow: the same lizyml error codes raised for other
reasons by jobs written under 0.20 stay generic.
"""

from __future__ import annotations

import json
import shutil
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from lizyml import Model
from lizyml.core.exceptions import LizyMLError

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.server import create_app
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.training import run_fit, run_tune

pytestmark = pytest.mark.integration

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
LEGACY_JOBS = _FIXTURES / "lizyml015" / "jobs"
# The 0.15 jobs were trained on this file (byte-identical copy).
LEGACY_DATA = _FIXTURES / "lizyml" / "binary_no_cal" / "data.csv"
TUNE_FIXTURE = _FIXTURES / "lizyml" / "tune"

FIT_JOB = "job_1802e487"
TUNED_JOB = "job_92ea6d27"
PAUSED_JOB = "job_a157e1ae"

# What D1 routes out of ``model.params`` in the Tuned job's stored config.
ROUTED_NAMES = {
    "early_stopping.rounds",
    "min_data_in_bin_ratio",
    "min_data_in_leaf_ratio",
    "num_leaves_ratio",
    "validation_ratio",
}


def _copy_legacy_jobs(jobs_dir: Path) -> None:
    """Copy the fixture jobs into *jobs_dir*, pointing ``model_path`` at the copy.

    A missing fixture fails the test (DC1): nothing here is optional.
    """
    jobs_dir.mkdir(parents=True, exist_ok=True)
    for job_id in (FIT_JOB, TUNED_JOB, PAUSED_JOB):
        src = LEGACY_JOBS / job_id
        assert (src / "meta.json").is_file(), f"fixture missing: {src}"
        dst = jobs_dir / job_id
        shutil.copytree(src, dst)
        meta_path = dst / "meta.json"
        meta = json.loads(meta_path.read_text())
        if meta["model_path"] is not None:
            meta["model_path"] = str(dst / "model")
        meta_path.write_text(json.dumps(meta))


def _client(jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture()
def legacy_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    jobs_dir = tmp_path / "jobs"
    _copy_legacy_jobs(jobs_dir)
    yield from _client(jobs_dir, monkeypatch)


def _error(res: Any) -> dict[str, Any]:
    body: dict[str, Any] = res.json()["error"]
    return body


# --- unpause ---------------------------------------------------------------


def test_unpause_of_a_015_paused_tune_is_refused_before_the_job_starts(
    legacy_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    app: Any = legacy_client.app
    job_store: JobStore = app.state.job_store
    job_dir = job_store.job_dir(PAUSED_JOB)
    assert (job_dir / "optuna.db").is_file()
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
    assert error["details"]["kind"] == "study_not_resumable"
    assert error["details"]["recovery_hint"] == "Start a new Tune"
    assert launched == []
    assert job_store.is_pause_requested(PAUSED_JOB) is True
    reloaded = job_store.get(PAUSED_JOB)
    assert reloaded is not None and reloaded.status == "paused"


# --- SHAP ------------------------------------------------------------------


@pytest.mark.parametrize("job_id", [FIT_JOB, TUNED_JOB])
@pytest.mark.parametrize(
    "path",
    [
        "importance?kind=shap",
        "plot/importance?kind=shap",
        "plot/shap-summary",
    ],
)
def test_shap_on_a_015_job_is_refused_as_refit_required(
    legacy_client: TestClient, job_id: str, path: str
) -> None:
    res = legacy_client.get(f"/api/jobs/{job_id}/{path}")

    assert res.status_code == 400, res.text
    error = _error(res)
    assert error["code"] == "REFIT_REQUIRED"
    assert error["details"]["kind"] == "shap_per_fold_state_missing"
    assert error["details"]["recovery_hint"]


# --- export-code -----------------------------------------------------------


def test_export_code_on_a_015_tuned_job_is_refused_as_refit_required(
    legacy_client: TestClient,
) -> None:
    res = legacy_client.get(f"/api/jobs/{TUNED_JOB}/export-code")

    assert res.status_code == 400, res.text
    error = _error(res)
    assert error["code"] == "REFIT_REQUIRED"
    assert error["details"]["kind"] == "export_param_names"
    assert set(error["details"]["names"]) == ROUTED_NAMES
    assert len(error["details"]["names"]) == len(ROUTED_NAMES)


def test_export_code_on_a_015_fit_job_is_not_refused(
    legacy_client: TestClient,
) -> None:
    res = legacy_client.get(f"/api/jobs/{FIT_JOB}/export-code")

    assert res.status_code == 200, res.text
    assert res.headers["content-type"] == "application/zip"


# --- what keeps working ----------------------------------------------------


def test_list_and_detail_of_015_jobs_keep_working(
    legacy_client: TestClient,
) -> None:
    res = legacy_client.get("/api/jobs")
    assert res.status_code == 200, res.text
    listed = {j["job_id"] for j in res.json()}
    assert {FIT_JOB, TUNED_JOB, PAUSED_JOB} <= listed
    for job_id in (FIT_JOB, TUNED_JOB, PAUSED_JOB):
        detail = legacy_client.get(f"/api/jobs/{job_id}")
        assert detail.status_code == 200, detail.text


@pytest.mark.parametrize("job_id", [FIT_JOB, TUNED_JOB])
def test_split_importance_and_metrics_of_015_jobs_keep_working(
    legacy_client: TestClient, job_id: str
) -> None:
    imp = legacy_client.get(f"/api/jobs/{job_id}/importance?kind=split")
    assert imp.status_code == 200, imp.text
    assert imp.json()
    metrics = legacy_client.get(f"/api/jobs/{job_id}/metrics")
    assert metrics.status_code == 200, metrics.text


def test_inference_with_shap_on_a_015_tuned_job_keeps_working(
    legacy_client: TestClient, tmp_path: Path
) -> None:
    data = tmp_path / "infer.csv"
    shutil.copyfile(LEGACY_DATA, data)

    res = legacy_client.post(
        "/api/inference/run",
        json={
            "job_id": TUNED_JOB,
            "data": {"source_type": "path", "path": str(data)},
            "return_shap": True,
        },
    )

    assert res.status_code == 200, res.text


def test_inference_shap_plot_on_a_015_tuned_job_is_refused_as_refit_required(
    legacy_client: TestClient, tmp_path: Path
) -> None:
    # The inference plots come from the parent job's model, so the SHAP plot
    # there meets the same 0.15 artifact as the job's own plot route.
    data = tmp_path / "infer.csv"
    shutil.copyfile(LEGACY_DATA, data)
    run = legacy_client.post(
        "/api/inference/run",
        json={"job_id": TUNED_JOB, "data": {"source_type": "path", "path": str(data)}},
    )
    assert run.status_code == 200, run.text

    res = legacy_client.get(
        f"/api/inference/{run.json()['inf_id']}/plot/shap-summary",
        params={"job_id": TUNED_JOB},
    )

    assert res.status_code == 400, res.text
    error = _error(res)
    assert error["code"] == "REFIT_REQUIRED"
    assert error["details"]["kind"] == "shap_per_fold_state_missing"


# --- the refusals stay narrow ------------------------------------------------


def _data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path=str(TUNE_FIXTURE / "data.csv"),
        filename="data.csv",
        fingerprint="fixture",
        shape=(150, 6),
    )


def _tune_config() -> dict[str, Any]:
    config: dict[str, Any] = json.loads((TUNE_FIXTURE / "config.json").read_text())
    config["split"]["n_splits"] = 3
    config["tuning"]["optuna"]["params"]["n_trials"] = 2
    config["tuning"]["optuna"]["space"] = {
        "learning_rate": {"type": "float", "low": 0.01, "high": 0.2, "log": True},
        "early_stopping.rounds": {"type": "int", "low": 20, "high": 60},
    }
    return config


def _new_job(
    job_store: JobStore, config: dict[str, Any], job_type: Literal["fit", "tune"]
) -> Job:
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config=config,
        data_ref=_data_ref(),
        job_type=job_type,
    )
    assert job is not None
    return job


def test_export_code_on_a_020_tuned_job_is_not_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    jobs_dir = tmp_path / "jobs"
    job_store = JobStore(jobs_dir)
    config = _tune_config()
    job = _new_job(job_store, config, "tune")
    done = run_tune(
        job=job,
        job_store=job_store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=pd.read_csv(TUNE_FIXTURE / "data.csv"),
    )
    assert done.status == "completed", done.error
    assert done.model_path is not None
    # The tuned values are in the stored model.params, and lizyml 0.20 routed
    # the tuned rounds out of them: the preflight has names to judge.
    cfg = Model.load(done.model_path).fit_result.run_meta.config_normalized
    stored = cfg["model"]["params"]
    assert "learning_rate" in stored
    assert "early_stopping_rounds" not in stored

    for client in _client(jobs_dir, monkeypatch):
        res = client.get(f"/api/jobs/{job.job_id}/export-code")
        assert res.status_code == 200, res.text


def test_other_shap_model_not_fit_on_a_020_job_stays_a_backend_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    jobs_dir = tmp_path / "jobs"
    job_store = JobStore(jobs_dir)
    config = json.loads((TUNE_FIXTURE / "config.json").read_text())
    config.pop("tuning", None)
    config["split"]["n_splits"] = 3
    job = _new_job(job_store, config, "fit")
    done = run_fit(
        job=job,
        job_store=job_store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=pd.read_csv(TUNE_FIXTURE / "data.csv"),
    )
    assert done.status == "completed", done.error
    assert done.model_path is not None
    # A 0.20 artifact without diagnostic data: lizyml's own export writes no
    # analysis_context.pkl for a model holding no training data (and removes
    # the earlier one).  Its SHAP raises MODEL_NOT_FIT without ``missing``.
    # Deleting the file instead breaks the 0.20 manifest.
    model = Model.load(done.model_path)
    model._X = None
    model.export(done.model_path)
    assert not (Path(done.model_path) / "analysis_context.pkl").exists()
    with pytest.raises(LizyMLError) as caught:
        Model.load(done.model_path).importance(kind="shap")
    assert caught.value.code.value == "MODEL_NOT_FIT"
    assert "missing" not in (caught.value.context or {})

    for client in _client(jobs_dir, monkeypatch):
        res = client.get(f"/api/jobs/{job.job_id}/importance?kind=shap")
        assert res.status_code == 500, res.text
        assert _error(res)["code"] == "BACKEND_ERROR"
