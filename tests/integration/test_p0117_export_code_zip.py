"""The export-code ZIP Studio serves carries lizyml 0.21's input contract (P-0117 D5).

lizyml 0.21 adds ``column_name_policy: "str_alias_v1"`` (H-0141) and
``category_identity_version`` (H-0138) to the generated ``config.json``, and
the generated ``predict.py`` checks the input header.  This builds the ZIP
through Studio's ``GET /api/jobs/{id}/export-code`` for a completed Fit,
unpacks it, and runs its ``predict.py`` on the training data: the generated
project must predict what Studio predicts.
"""

from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.server import create_app
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import run_fit

pytestmark = pytest.mark.integration

SCENARIO = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml" / "binary_no_cal"


@pytest.fixture()
def exported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[dict[str, Any]]:
    data = tmp_path / "data.csv"
    shutil.copyfile(SCENARIO / "data.csv", data)
    df = pd.read_csv(data)
    config: dict[str, Any] = json.loads((SCENARIO / "config.json").read_text())
    jobs_dir = tmp_path / "jobs"
    job_store = JobStore(jobs_dir)
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(data),
            filename=data.name,
            fingerprint="export-code-zip",
            shape=df.shape,
        ),
        job_type="fit",
    )
    assert job is not None
    done = run_fit(
        job=job,
        job_store=job_store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=df,
    )
    assert done.status == "completed", done.error

    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    with TestClient(create_app()) as client:
        res = client.get(f"/api/jobs/{job.job_id}/export-code")
        assert res.status_code == 200, res.text
        assert res.headers["content-type"] == "application/zip"
        project = tmp_path / "project"
        zipfile.ZipFile(io.BytesIO(res.content)).extractall(project)
        yield {
            "client": client,
            "job_id": job.job_id,
            "data": data,
            "project": project,
        }


def test_generated_config_has_the_021_input_contract(
    exported: dict[str, Any],
) -> None:
    config = json.loads((exported["project"] / "config.json").read_text())

    assert config["column_name_policy"] == "str_alias_v1"
    assert "category_identity_version" in config


def test_generated_predict_matches_studio_predictions(
    exported: dict[str, Any],
) -> None:
    client: TestClient = exported["client"]
    job_id = exported["job_id"]
    run = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(exported["data"])},
        },
    )
    assert run.status_code == 200, run.text
    preds = client.get(
        f"/api/inference/{run.json()['inf_id']}/predictions",
        params={"job_id": job_id, "rows": 10000},
    )
    assert preds.status_code == 200, preds.text
    studio = pd.DataFrame(preds.json()["data"])

    out = exported["project"] / "predictions.csv"
    proc = subprocess.run(
        [
            sys.executable,
            str(exported["project"] / "predict.py"),
            str(exported["data"]),
            "-o",
            str(out),
        ],
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stderr
    generated = pd.read_csv(out)

    assert len(generated) == len(studio) == 418
    assert generated["pred"].tolist() == studio["pred"].tolist()
    assert generated["proba"].tolist() == pytest.approx(
        studio["proba"].tolist(), abs=1e-9
    )
