"""Relaunch paths re-check rules added after a stored job (P-0116 D5, #721).

``/fit`` and ``/tune`` refuse a regression config that asks for
stratification with a 422 before a job starts.  ``/retune``, ``/resume`` and
``/unpause`` start a job from a stored config instead; they apply the same
refusal, so such a config does not start another job that fails later.  A
stored config is not re-run through the full schema gate: it already passed
that when its job was created.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration

_STRATIFIED_REGRESSION: dict[str, Any] = {
    "task": "regression",
    "data": {"target": "y"},
    "split": {"method": "stratified_kfold", "n_splits": 3},
    "tuning": {"optuna": {"params": {"n_trials": 10}}},
}


@pytest.fixture()
def data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(4, 2),
    )


def _store(client: TestClient) -> JobStore:
    return client.app.state.job_store  # type: ignore[union-attr,no-any-return]


def _skip_checkpoint_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    from lizystudio.api import retune as retune_api

    monkeypatch.setattr(
        retune_api, "_require_tune_job_with_checkpoint", lambda *a: None
    )


def _assert_refused(res: Any) -> None:
    assert res.status_code == 422, res.text
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    paths = [e["path"] for e in body["error"]["details"]["errors"]]
    assert paths == ["split.method"]


def test_retune_refuses_a_stored_stratified_regression_config(
    client: TestClient, data_ref: DataRef, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = _store(client).create(
        backend_name="lizyml",
        config=_STRATIFIED_REGRESSION,
        data_ref=data_ref,
        job_type="tune",
    )
    job.status = "completed"
    _store(client).update(job)
    _skip_checkpoint_gate(monkeypatch)

    _assert_refused(client.post(f"/api/jobs/{job.job_id}/retune", json={"n_trials": 5}))
    assert _store(client).get_child_job_ids(job.job_id) == []


def test_resume_refuses_a_stored_stratified_regression_config(
    client: TestClient, data_ref: DataRef, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = _store(client).create(
        backend_name="lizyml",
        config=_STRATIFIED_REGRESSION,
        data_ref=data_ref,
        job_type="tune",
    )
    job.status = "failed"
    _store(client).update(job)
    _skip_checkpoint_gate(monkeypatch)

    _assert_refused(client.post(f"/api/jobs/{job.job_id}/resume", json={"n_trials": 5}))
    assert _store(client).get_child_job_ids(job.job_id) == []


def test_unpause_refuses_a_stored_stratified_regression_config(
    client: TestClient, data_ref: DataRef, monkeypatch: pytest.MonkeyPatch
) -> None:
    from lizystudio.api import jobs as jobs_api

    ws = client.app.state.workspace  # type: ignore[union-attr]
    ws.set_data(pd.DataFrame({"y": [0.1, 0.5, 0.9, 1.3], "x": [1, 2, 3, 4]}), data_ref)
    store = _store(client)
    job = store.create(
        backend_name="lizyml",
        config=_STRATIFIED_REGRESSION,
        data_ref=data_ref,
        job_type="tune",
    )
    store.set_status(job.job_id, "running")
    store.set_status(job.job_id, "paused")
    store.claim_active(job.job_id)
    store.request_pause(job.job_id)
    started: list[Any] = []
    monkeypatch.setattr(jobs_api, "start_tune_async", lambda **kw: started.append(kw))

    _assert_refused(client.post(f"/api/jobs/{job.job_id}/unpause"))
    assert started == []
    # The pause flag stays set: the refused unpause changed nothing.
    assert store.is_pause_requested(job.job_id) is True


def test_a_minimal_stored_config_is_not_re_run_through_the_schema_gate(
    client: TestClient,
) -> None:
    # Stored configs passed the full gate when their job was created; the
    # relaunch gate only re-checks the newer rules, so schema errors in an
    # old minimal config do not block it.
    from lizystudio.api.workspace import require_relaunchable_config

    ws = client.app.state.workspace  # type: ignore[union-attr]
    require_relaunchable_config(ws, {"task": "binary"})
