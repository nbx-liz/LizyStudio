"""Regression test for HIGH-8: inference upload temp file cleanup.

Previously an uploaded file was only removed on ``ws.reset()``,
leaving ``/tmp`` filling up across repeated uploads. The fix adds
``WorkspaceState.consume_temp_file`` and calls it from
``/api/inference/run`` whenever ``source_type == 'upload'``. Path mode
runs never touch the user's original file.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/test.csv",
        filename="test.csv",
        fingerprint="abc",
        shape=(10, 2),
    )


def _seed_job(client: TestClient, sample_data_ref: DataRef) -> str:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "regression",
            "data": {"target": "y"},
            "model": {"name": "lgbm"},
        },
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={}, fold_count=5, params=[])
    job.model_path = "/fake/model/path"
    job_store.update(job)
    return job.job_id


def test_upload_source_temp_file_is_removed_after_run(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After /inference/run finishes, an upload-mode temp file is gone."""
    # Seed a completed job.
    job_id = _seed_job(client, sample_data_ref)

    # Place a real temp CSV inside the workspace-tracked list.
    app = client.app  # type: ignore[union-attr]
    ws = app.state.workspace
    upload_file = tmp_path / "upload_abc.csv"
    upload_file.write_text("x,y\n1,2\n3,4\n", encoding="utf-8")
    ws.track_temp_file(str(upload_file))

    # Stub out run_inference so we don't need a real backend.
    from lizystudio.api import inference as inference_api
    from lizystudio.services.inference import InferenceRecord

    def _fake_run(**kwargs):  # type: ignore[no-untyped-def]
        return InferenceRecord(
            inf_id="inf_fake",
            job_id=kwargs["job"].job_id,
            data_ref=sample_data_ref,
            has_ground_truth=False,
            created_at="2026-04-14T00:00:00Z",
            row_count=2,
            warnings=[],
        )

    monkeypatch.setattr(inference_api, "run_inference", _fake_run)
    # Also shortcut path validation for the tmp file.
    monkeypatch.setattr(inference_api, "validate_path_within", lambda p, _root: p)

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "upload", "path": str(upload_file)},
        },
    )

    assert res.status_code == 200, res.text
    assert not upload_file.exists(), (
        "upload-mode temp file must be deleted after /inference/run"
    )
    assert str(upload_file) not in ws._temp_files


def test_path_source_temp_file_is_not_touched(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """source_type='path' must never delete the user's file."""
    job_id = _seed_job(client, sample_data_ref)

    user_file = tmp_path / "user_data.csv"
    user_file.write_text("a,b\n1,2\n", encoding="utf-8")
    df = pd.read_csv(user_file)
    assert len(df) == 1  # sanity

    from lizystudio.api import inference as inference_api
    from lizystudio.services.inference import InferenceRecord

    def _fake_run(**kwargs):  # type: ignore[no-untyped-def]
        return InferenceRecord(
            inf_id="inf_fake2",
            job_id=kwargs["job"].job_id,
            data_ref=sample_data_ref,
            has_ground_truth=False,
            created_at="2026-04-14T00:00:00Z",
            row_count=1,
            warnings=[],
        )

    monkeypatch.setattr(inference_api, "run_inference", _fake_run)
    monkeypatch.setattr(inference_api, "validate_path_within", lambda p, _root: p)

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(user_file)},
        },
    )

    assert res.status_code == 200, res.text
    assert user_file.exists(), "path-mode file must be left alone"
