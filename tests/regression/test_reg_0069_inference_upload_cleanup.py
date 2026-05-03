"""Regression tests for inference upload-mode lifecycle.

Two regressions are pinned here:

* HIGH-8: an uploaded file was only removed on ``ws.reset()``, so
  ``/tmp`` filled up across repeated uploads. The fix adds
  ``WorkspaceState.consume_temp_file`` and calls it from
  ``/api/inference/run`` whenever ``source_type == 'upload'``. Path
  mode runs never touch the user's original file.
* Issue #374: ``/api/inference/run`` validated *every* path against
  ``ALLOWED_FILES_ROOT``, which rejected legitimate ``source_type=
  upload`` requests (their tempfile lives under ``/tmp``, outside the
  user's home root). The fix splits validation by ``source_type`` and
  for ``upload`` instead checks membership in
  ``WorkspaceState._temp_files`` (server-staged uploads only). The
  tests therefore must NOT stub ``validate_path_within`` away — the
  real validation logic is what we are protecting against regressions.
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


def _stub_run_inference(
    monkeypatch: pytest.MonkeyPatch,
    sample_data_ref: DataRef,
    inf_id: str,
    row_count: int,
) -> None:
    from lizystudio.api import inference as inference_api
    from lizystudio.services.inference import InferenceRecord

    def _fake_run(**kwargs):  # type: ignore[no-untyped-def]
        return InferenceRecord(
            inf_id=inf_id,
            job_id=kwargs["job"].job_id,
            data_ref=sample_data_ref,
            has_ground_truth=False,
            created_at="2026-04-14T00:00:00Z",
            row_count=row_count,
            warnings=[],
        )

    monkeypatch.setattr(inference_api, "run_inference", _fake_run)


def test_upload_source_temp_file_is_removed_after_run(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After /inference/run finishes, an upload-mode temp file is gone."""
    # Seed a completed job.
    job_id = _seed_job(client, sample_data_ref)

    # Place a real temp CSV inside the workspace-tracked list. The
    # path lives under pytest's tmp_path, which is intentionally
    # outside ALLOWED_FILES_ROOT — Issue #374 ensures upload-mode
    # bypasses that check via the tracked-temp-file registry.
    app = client.app  # type: ignore[union-attr]
    ws = app.state.workspace
    upload_file = tmp_path / "upload_abc.csv"
    upload_file.write_text("x,y\n1,2\n3,4\n", encoding="utf-8")
    ws.track_temp_file(str(upload_file))

    _stub_run_inference(monkeypatch, sample_data_ref, "inf_fake", 2)

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
    assert not ws.is_tracked_temp_file(str(upload_file))


def test_upload_source_untracked_path_is_rejected(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """source_type=upload with an untracked path must be rejected (Issue #374).

    Without this guard a forged request like
    ``{source_type: "upload", path: "/etc/passwd"}`` would slip past
    the ALLOWED_FILES_ROOT check. The endpoint must verify the path
    was registered by ``/api/inference/upload`` first.
    """
    job_id = _seed_job(client, sample_data_ref)

    # Create a real file but DO NOT track it as a tempfile upload.
    untracked = tmp_path / "untracked.csv"
    untracked.write_text("x,y\n1,2\n", encoding="utf-8")

    _stub_run_inference(monkeypatch, sample_data_ref, "inf_should_not_run", 1)

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "upload", "path": str(untracked)},
        },
    )

    assert res.status_code == 400, res.text
    body = res.json()
    assert body["error"]["code"] == "PATH_NOT_FOUND"
    # Untouched: the request must not have called the run path.
    assert untracked.exists()


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

    # Re-point ALLOWED_FILES_ROOT at tmp_path so the user-supplied
    # path validates legitimately (no monkeypatch on
    # validate_path_within itself — Issue #374 lesson).
    import lizystudio.security as security_mod

    monkeypatch.setattr(security_mod, "ALLOWED_FILES_ROOT", tmp_path.resolve())

    _stub_run_inference(monkeypatch, sample_data_ref, "inf_fake2", 1)

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(user_file)},
        },
    )

    assert res.status_code == 200, res.text
    assert user_file.exists(), "path-mode file must be left alone"


def test_path_source_outside_allowed_root_is_rejected(
    client: TestClient,
    sample_data_ref: DataRef,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """source_type='path' must reject paths outside ALLOWED_FILES_ROOT."""
    job_id = _seed_job(client, sample_data_ref)

    user_file = tmp_path / "outside.csv"
    user_file.write_text("a,b\n1,2\n", encoding="utf-8")

    # Constrain ALLOWED_FILES_ROOT to a subdir that does NOT contain
    # the user_file path.
    sub = tmp_path / "allowed"
    sub.mkdir()
    import lizystudio.security as security_mod

    monkeypatch.setattr(security_mod, "ALLOWED_FILES_ROOT", sub.resolve())

    _stub_run_inference(monkeypatch, sample_data_ref, "inf_should_not_run", 1)

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(user_file)},
        },
    )

    assert res.status_code == 400, res.text
    body = res.json()
    assert body["error"]["code"] == "PATH_NOT_FOUND"
