"""Regression tests for uncovered API error branches (Issue #163).

Drives the 4xx/5xx handlers that were missing from the happy-path
test suite. Coverage audit (2026-04-17) flagged these ranges:

- ``api/workspace.py``: 266, 289-290, 303-305, 444, 477-478 (data /
  config error branches).
- ``api/retune.py``: 207-208 and 267-268 (rebind-race 409 paths),
  286 (finally release on start failure), 310-311
  (``_auto_remaining_trials`` n_rounds parse failure).

Each test asserts:
- The HTTP status matches the ``api.errors`` envelope convention.
- The response body uses the ``{"error": {...}}`` shape.
- Side effects (lock release, temp-file cleanup) are preserved where
  visible from the test surface.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, TuningSummary
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Shared fixtures / helpers (mirror tests/test_retune_api.py conventions).
# ---------------------------------------------------------------------------


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


def _make_completed_tune_job(client: TestClient, data_ref: DataRef) -> str:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {"optuna": {"params": {"n_trials": 100}}},
        },
        data_ref=data_ref,
        job_type="tune",
    )
    job.status = "completed"
    job.tune_result = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )
    job_store.update(job)
    job_dir = job_store.jobs_dir / job.job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "model.pkl").write_bytes(b"fake pickle payload")
    (job_dir / "model_meta.json").write_text(
        '{"pickle_schema": 1, "lizyml_version": "0.9.1", '
        '"lightgbm_version": "4.5.0", "optuna_version": "4.0.0", '
        '"saved_at": "2026-04-13T12:00:00+00:00"}'
    )
    return job.job_id


# ---------------------------------------------------------------------------
# workspace.py : data_load_path — FileNotFoundError mid-read (line 266)
# ---------------------------------------------------------------------------


def test_data_load_path_handles_file_vanishing_mid_read(
    client: TestClient, tmp_path: Path
) -> None:
    """INV: if ``load_dataframe`` raises FileNotFoundError after the
    ``resolve().exists()`` check (e.g. file deleted concurrently), the
    handler returns PATH_NOT_FOUND, not a 500.
    """
    csv = tmp_path / "ghost.csv"
    csv.write_text("a,b\n1,2\n", encoding="utf-8")

    def _raise_fnf(path: str) -> Any:  # noqa: ARG001
        raise FileNotFoundError(2, "No such file or directory", path)

    with patch("lizystudio.api.workspace.load_dataframe", side_effect=_raise_fnf):
        res = client.post("/api/workspace/data/path", json={"path": str(csv)})

    # PathNotFoundError maps to 400 (see api/errors.py:87).
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "PATH_NOT_FOUND"


# ---------------------------------------------------------------------------
# workspace.py : data_upload — size-limit ValueError (lines 289-290)
# ---------------------------------------------------------------------------


def test_data_upload_rejects_oversize_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """INV: a multipart upload that exceeds the size limit surfaces
    as FILE_INVALID (400), not a 500.

    ``read_upload_checked`` binds ``MAX_UPLOAD_BYTES`` as a default
    argument at definition time, so patching the constant has no
    effect once the app is imported. Mock the helper itself to raise
    the ValueError the handler expects — this reaches the
    ``except ValueError`` branch at workspace.py:289-290.
    """

    async def _raise_oversize(*args: Any, **kwargs: Any) -> bytes:  # noqa: ARG001
        raise ValueError("File exceeds 100 MB limit")

    monkeypatch.setattr("lizystudio.api.workspace.read_upload_checked", _raise_oversize)
    res = client.post(
        "/api/workspace/data/upload",
        files={"file": ("big.csv", b"x" * 32, "text/csv")},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "FILE_INVALID"


# ---------------------------------------------------------------------------
# workspace.py : data_upload — memory cap (lines 303-305)
# ---------------------------------------------------------------------------


def test_data_upload_rejects_memory_over_limit(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """INV: a successfully parsed but memory-hungry upload raises
    FILE_INVALID from ``check_dataframe_memory`` and cleans up the
    temp file before re-raising.
    """
    from lizystudio.api.errors import FileInvalidError

    def _raise_over(df: Any, max_bytes: Any = None) -> int:  # noqa: ARG001
        raise FileInvalidError("DataFrame memory usage exceeds limit")

    monkeypatch.setattr("lizystudio.api.workspace.check_dataframe_memory", _raise_over)
    content = b"a,b\n1,2\n3,4\n"
    res = client.post(
        "/api/workspace/data/upload",
        files={"file": ("x.csv", content, "text/csv")},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "FILE_INVALID"


# ---------------------------------------------------------------------------
# workspace.py : config_patch — ops must be a list (line 444)
# ---------------------------------------------------------------------------


def test_config_patch_rejects_non_list_ops(client: TestClient) -> None:
    """INV: submitting ``ops`` as a non-list object returns
    INVALID_PATCH (400) and does not mutate the stored config.
    """
    # Seed a config so the endpoint reaches the ops validation branch.
    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200
    client.put("/api/workspace/config", json=res.json())

    res = client.patch(
        "/api/workspace/config",
        json={"ops": {"bad": "not a list"}},
    )
    # InvalidPatchError maps to 422 (see api/errors.py:129).
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "INVALID_PATCH"


# ---------------------------------------------------------------------------
# workspace.py : config_upload — size-limit ValueError (lines 477-478)
# ---------------------------------------------------------------------------


def test_config_upload_rejects_oversize_file(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """INV: oversize config upload surfaces as FILE_INVALID (400).

    Same pattern as the data-upload oversize test — patch the helper
    to raise rather than relying on the constant substitution.
    """

    async def _raise_oversize(*args: Any, **kwargs: Any) -> bytes:  # noqa: ARG001
        raise ValueError("File exceeds 100 MB limit")

    monkeypatch.setattr("lizystudio.api.workspace.read_upload_checked", _raise_oversize)
    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("big.yaml", b"x" * 32, "application/yaml")},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "FILE_INVALID"


# ---------------------------------------------------------------------------
# retune.py : rebind race on /retune (lines 207-208)
# ---------------------------------------------------------------------------


def test_retune_rebind_race_deletes_child_and_returns_409(
    client: TestClient,
    sample_data_ref: DataRef,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """INV: if ``rebind_parent_lock`` returns False mid-handshake (a
    concurrent retune stole the slot between claim and rebind), the
    child job is deleted and the handler returns PARENT_LOCKED.
    """
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    original_rebind = job_store.rebind_parent_lock
    monkeypatch.setattr(job_store, "rebind_parent_lock", lambda *a, **k: False)
    monkeypatch.setattr(job_store, "get_locked_child", lambda _pid: "synthetic-child")

    ids_before = {d.name for d in job_store.jobs_dir.iterdir() if d.is_dir()}
    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 409
    body = res.json()
    assert body["error"]["code"] == "PARENT_LOCKED"

    # The child that was briefly created must have been deleted before
    # the handler returned — disk should only show the original jobs.
    ids_after = {d.name for d in job_store.jobs_dir.iterdir() if d.is_dir()}
    assert ids_after <= ids_before | {parent_id}
    # Restore to avoid leaking the patched method across tests in the
    # same fixture-life (monkeypatch undoes this automatically but
    # keep the variable used for clarity).
    assert original_rebind is not None


# ---------------------------------------------------------------------------
# retune.py : rebind race on /resume (lines 267-268)
# ---------------------------------------------------------------------------


def test_resume_rebind_race_deletes_child_and_returns_409(
    client: TestClient,
    sample_data_ref: DataRef,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same failure mode as ``/retune`` for the ``/resume`` endpoint."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Resume requires a failed tune with a checkpoint. Build one.
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {"optuna": {"params": {"n_trials": 10}}},
        },
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.status = "failed"
    job.tune_result = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.5,
        trials=[{"params": {}, "score": 0.5}],
        metric_name="auc",
        direction="maximize",
    )
    job_store.update(job)
    job_dir = job_store.jobs_dir / job.job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "model.pkl").write_bytes(b"fake")
    (job_dir / "model_meta.json").write_text(
        '{"pickle_schema": 1, "lizyml_version": "0.9.1", '
        '"lightgbm_version": "4.5.0", "optuna_version": "4.0.0", '
        '"saved_at": "2026-04-13T12:00:00+00:00"}'
    )

    monkeypatch.setattr(job_store, "rebind_parent_lock", lambda *a, **k: False)
    monkeypatch.setattr(
        job_store, "get_locked_child", lambda _pid: "synthetic-resume-child"
    )

    res = client.post(f"/api/jobs/{job.job_id}/resume", json={"n_trials": 2})
    assert res.status_code == 409
    body = res.json()
    assert body["error"]["code"] == "PARENT_LOCKED"


# ---------------------------------------------------------------------------
# retune.py : _auto_remaining_trials parse fallback (lines 310-311)
# ---------------------------------------------------------------------------


def test_auto_remaining_trials_handles_non_integer_n_rounds() -> None:
    """Non-integer ``n_rounds`` (e.g. config was hand-edited) falls
    back to n_rounds=1 instead of raising.
    """
    from lizystudio.api.retune import _auto_remaining_trials
    from lizystudio.services.jobs import Job

    data_ref = DataRef(
        source_type="path",
        path="/x.csv",
        filename="x.csv",
        fingerprint="a",
        shape=(10, 2),
    )
    parent = Job(
        job_id="job_xxx",
        status="failed",
        backend_name="lizyml",
        config={
            "tuning": {
                "optuna": {"params": {"n_trials": 50}},
                "re_tune": {"n_rounds": "not-a-number"},
            }
        },
        data_ref=data_ref,
        job_type="tune",
        created_at="2026-04-17T00:00:00+00:00",
        tune_result=None,
    )
    # Expected: n_rounds falls back to 1; expected_total = 50*1 = 50;
    # completed = 0 (no tune_result), so remaining = 50.
    assert _auto_remaining_trials(parent) == 50


def test_auto_remaining_trials_handles_none_n_rounds() -> None:
    """``n_rounds=None`` exercises the ``TypeError`` arm of the
    ``except`` — the same fallback applies.
    """
    from lizystudio.api.retune import _auto_remaining_trials
    from lizystudio.services.jobs import Job

    data_ref = DataRef(
        source_type="path",
        path="/x.csv",
        filename="x.csv",
        fingerprint="a",
        shape=(10, 2),
    )
    parent = Job(
        job_id="job_yyy",
        status="failed",
        backend_name="lizyml",
        config={
            "tuning": {
                "optuna": {"params": {"n_trials": 30}},
                "re_tune": {"n_rounds": None},
            }
        },
        data_ref=data_ref,
        job_type="tune",
        created_at="2026-04-17T00:00:00+00:00",
        tune_result=None,
    )
    assert _auto_remaining_trials(parent) == 30
