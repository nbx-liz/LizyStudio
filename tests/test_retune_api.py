"""Integration tests for H-0062 Re-tune / Resume / Lineage API endpoints."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, TuningSummary
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


def _make_completed_tune_job(
    client: TestClient,
    sample_data_ref: DataRef,
    *,
    with_checkpoint: bool = True,
) -> str:
    """Create a completed tune job and optionally drop a fake model.pkl."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {"optuna": {"params": {"n_trials": 100}}},
        },
        data_ref=sample_data_ref,
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

    if with_checkpoint:
        job_dir = job_store.jobs_dir / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "model.pkl").write_bytes(b"fake pickle payload")
        (job_dir / "model_meta.json").write_text(
            '{"pickle_schema": 1, "lizyml_version": "0.9.1", '
            '"lightgbm_version": "4.5.0", "optuna_version": "4.0.0", '
            '"saved_at": "2026-04-13T12:00:00+00:00"}'
        )

    return job.job_id


def _make_failed_tune_job(
    client: TestClient,
    sample_data_ref: DataRef,
    *,
    completed_trials: int = 40,
    original_n_trials: int = 100,
    with_checkpoint: bool = True,
) -> str:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {"optuna": {"params": {"n_trials": original_n_trials}}},
        },
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.status = "failed"
    job.error = "synthetic crash"
    job.tune_result = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.7,
        trials=[{"number": i} for i in range(completed_trials)],
        metric_name="auc",
        direction="maximize",
    )
    job_store.update(job)

    if with_checkpoint:
        job_dir = job_store.jobs_dir / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "model.pkl").write_bytes(b"fake pickle payload")

    return job.job_id


def _make_completed_fit_job(client: TestClient, sample_data_ref: DataRef) -> str:
    """A fit job can never be a retune target; used to assert 400."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)
    return job.job_id


# ---------------------------------------------------------------------------
# Lineage endpoint
# ---------------------------------------------------------------------------


def test_lineage_endpoint_returns_tree(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    parent = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    res = client.get(f"/api/jobs/{parent.job_id}/lineage")
    assert res.status_code == 200
    tree = res.json()["tree"]
    assert tree["job_id"] == parent.job_id
    assert len(tree["children"]) == 1
    assert tree["children"][0]["job_id"] == child.job_id


def test_lineage_endpoint_404_for_missing_root(client: TestClient) -> None:
    res = client.get("/api/jobs/nonexistent/lineage")
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Cascade delete
# ---------------------------------------------------------------------------


def test_delete_without_cascade_rejects_parent_with_active_children(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    # Create an active child (pending by default)
    job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent_id,
    )
    res = client.delete(f"/api/jobs/{parent_id}")
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "PARENT_HAS_ACTIVE_CHILDREN"


def test_delete_cascade_removes_subtree(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent_id,
    )
    # Mark child as completed so the cascade guard does not trip
    child.status = "completed"
    job_store.update(child)

    res = client.delete(f"/api/jobs/{parent_id}?cascade=true")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "deleted"
    assert set(body["removed_job_ids"]) == {parent_id, child.job_id}
    assert job_store.get(parent_id) is None
    assert job_store.get(child.job_id) is None


# ---------------------------------------------------------------------------
# Re-tune endpoint validation
# ---------------------------------------------------------------------------


def test_retune_rejects_fit_job(client: TestClient, sample_data_ref: DataRef) -> None:
    fit_id = _make_completed_fit_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{fit_id}/retune", json={"n_trials": 50})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_retune_rejects_without_checkpoint(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref, with_checkpoint=False)
    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 50})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CHECKPOINT_MISSING"


def test_retune_rejects_not_completed(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
    )  # status=pending
    res = client.post(f"/api/jobs/{job.job_id}/retune", json={"n_trials": 10})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_COMPLETED"


def test_retune_rejects_grandchild(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """A job that already has a parent_job_id cannot be retuned."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent_id,
    )
    child.status = "completed"
    job_store.update(child)
    # Give the child its own checkpoint so only the parent_job_id rule fires.
    child_dir = job_store.jobs_dir / child.job_id
    (child_dir / "model.pkl").write_bytes(b"fake")

    res = client.post(f"/api/jobs/{child.job_id}/retune", json={"n_trials": 10})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_retune_rejects_invalid_n_trials(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 0})
    assert res.status_code == 400


def test_retune_rejects_n_trials_above_limit(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 10_001})
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Resume endpoint validation
# ---------------------------------------------------------------------------


def test_resume_rejects_completed_job(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{parent_id}/resume", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "JOB_NOT_FAILED"


def test_resume_rejects_failed_job_without_checkpoint(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_failed_tune_job(client, sample_data_ref, with_checkpoint=False)
    res = client.post(f"/api/jobs/{parent_id}/resume", json={})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "CHECKPOINT_MISSING"


# ---------------------------------------------------------------------------
# n_trials auto-computation helper
# ---------------------------------------------------------------------------


def test_auto_remaining_trials_subtracts_completed(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """_auto_remaining_trials computes N - completed, clamped at >= 1."""
    from lizystudio.api.jobs import _auto_remaining_trials

    parent_id = _make_failed_tune_job(
        client,
        sample_data_ref,
        completed_trials=40,
        original_n_trials=100,
    )
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    parent = job_store.get(parent_id)
    assert parent is not None
    assert _auto_remaining_trials(parent) == 60


def test_auto_remaining_trials_clamped_when_overshoot(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    from lizystudio.api.jobs import _auto_remaining_trials

    parent_id = _make_failed_tune_job(
        client,
        sample_data_ref,
        completed_trials=200,  # somehow more than the original request
        original_n_trials=50,
    )
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    parent = job_store.get(parent_id)
    assert parent is not None
    assert _auto_remaining_trials(parent) == 1


def test_auto_remaining_trials_with_no_tune_result(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Trial-0 crash: tune failed before any trial committed.

    When ``tune_result`` is None the subtraction must still return at
    least 1 so the dialog shows a sensible default.
    """
    from lizystudio.api.jobs import _auto_remaining_trials

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {"optuna": {"params": {"n_trials": 100}}},
        },
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.status = "failed"
    job.tune_result = None
    job_store.update(job)

    parent = job_store.get(job.job_id)
    assert parent is not None
    assert _auto_remaining_trials(parent) == 100


def test_auto_remaining_trials_multi_round_uses_n_rounds(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """H-0062 CRITICAL-2: Phase A multi-round parents must compute
    ``expected_total = n_rounds * n_trials`` so a crash mid-round-2 does
    not produce the absurd "1 remaining" that the naive single-round
    subtraction yields.

    Scenario: n_rounds=3 x n_trials=50 = 150 expected trials, the tune
    failed after 80 cumulative trials (round 2 partial). Remaining must
    be 70, not 1.
    """
    from lizystudio.api.jobs import _auto_remaining_trials

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "target": "y",
            "tuning": {
                "optuna": {"params": {"n_trials": 50}},
                "re_tune": {"n_rounds": 3},
            },
        },
        data_ref=sample_data_ref,
        job_type="tune",
    )
    job.status = "failed"
    job.tune_result = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.7,
        trials=[{"number": i} for i in range(80)],
        metric_name="auc",
        direction="maximize",
    )
    job_store.update(job)

    parent = job_store.get(job.job_id)
    assert parent is not None
    assert _auto_remaining_trials(parent) == 70


def test_auto_remaining_trials_legacy_single_round_unchanged(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Legacy parents without re_tune still behave as n_rounds=1."""
    from lizystudio.api.jobs import _auto_remaining_trials

    parent_id = _make_failed_tune_job(
        client,
        sample_data_ref,
        completed_trials=42,
        original_n_trials=100,
    )
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    parent = job_store.get(parent_id)
    assert parent is not None
    assert _auto_remaining_trials(parent) == 58


def test_lineage_tree_marks_truncated_at_max_depth(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Lineage tree exposes ``truncated: true`` for nodes beyond max depth.

    The intent is that the UI surfaces an explicit indicator instead of
    silently dropping descendants. Build a synthetic 22-deep chain and
    assert the depth-20 node is flagged.
    """
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Create a 22-level chain.
    parent_id: str | None = None
    chain: list[str] = []
    for _ in range(22):
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
            parent_job_id=parent_id,
        )
        chain.append(job.job_id)
        parent_id = job.job_id

    res = client.get(f"/api/jobs/{chain[0]}/lineage")
    assert res.status_code == 200
    tree = res.json()["tree"]

    # Walk to depth 20.
    node: dict[str, object] = tree
    for _ in range(20):
        children = node.get("children")
        assert isinstance(children, list)
        assert len(children) == 1
        node = children[0]  # type: ignore[assignment]

    # Depth 20 node has descendants but the tree was truncated there.
    assert node.get("truncated") is True
    assert node.get("children") == []


def test_retune_returns_409_when_concurrent(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """A second Re-tune on the same parent returns PARENT_LOCKED.

    We pre-acquire the parent lock manually to simulate an in-flight
    retune child without having to actually run a tune.
    """
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job_store.acquire_parent_lock(parent_id, "child_synthetic")

    try:
        res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 10})
        assert res.status_code == 409
        body = res.json()
        assert body["error"]["code"] == "PARENT_LOCKED"
        # Holder is exposed in details for the UI to surface.
        assert body["error"]["details"]["parent_job_id"] == parent_id
        assert body["error"]["details"]["holder"] == "child_synthetic"
    finally:
        job_store.release_parent_lock(parent_id)
