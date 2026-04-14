"""Integration tests for H-0062 Re-tune / Resume / Lineage API endpoints."""

from __future__ import annotations

from typing import Any

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


def test_retune_accepts_grandchild(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """H-0062 Decision 2026-04-14: a completed retune child may itself
    be retuned. Each child carries its own model.pkl that continues the
    Optuna study, so chaining A -> B -> C -> ... is a natural extension
    of the Re-tune UX and matches user expectations (see Bugfix 2026-04-14
    for the UX report). The only hard requirement is that the job is a
    tune job with a checkpoint — there is no upper bound on lineage depth
    beyond the lineage-tree display truncation at depth 20.
    """
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
    child.tune_result = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )
    job_store.update(child)
    # Give the child its own checkpoint + sidecar so the full happy path
    # runs and the API accepts the retune of a retune.
    child_dir = job_store.jobs_dir / child.job_id
    (child_dir / "model.pkl").write_bytes(b"fake pickle payload")
    (child_dir / "model_meta.json").write_text(
        '{"pickle_schema": 1, "lizyml_version": "0.9.1", '
        '"lightgbm_version": "4.5.0", "optuna_version": "4.0.0", '
        '"saved_at": "2026-04-14T12:00:00+00:00"}'
    )

    res = client.post(f"/api/jobs/{child.job_id}/retune", json={"n_trials": 10})
    assert res.status_code == 200
    body = res.json()
    assert body["parent_job_id"] == child.job_id
    assert body["job_id"] != child.job_id


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


# ---------------------------------------------------------------------------
# Happy path: the whole retune/resume handler pipeline runs end-to-end.
#
# These tests exercise every line of retune_job / resume_job / _claim_retune_slot
# / start_retune_async (through the "no dataframe" fast path which still
# covers the child-job creation, lock rebind, broadcaster event, and
# WorkspaceState.current_job_id update).
# ---------------------------------------------------------------------------


def test_retune_success_creates_child_and_releases_lock(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 7})
    assert res.status_code == 200
    body = res.json()
    assert body["parent_job_id"] == parent_id
    child_id = body["job_id"]

    child = job_store.get(child_id)
    assert child is not None
    assert child.parent_job_id == parent_id
    assert child.job_type == "tune"

    # ws.dataframe is None in the TestClient workspace, so start_retune_async
    # immediately marks the child as failed and releases the lock.
    assert job_store.get_locked_child(parent_id) is None


def test_retune_response_shows_in_children_list(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 5})
    assert res.status_code == 200
    child_id = res.json()["job_id"]

    children = job_store.get_child_job_ids(parent_id)
    assert child_id in children


def test_resume_success_auto_computes_remaining_trials(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_failed_tune_job(
        client,
        sample_data_ref,
        completed_trials=40,
        original_n_trials=100,
    )
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Omit n_trials in the body so the endpoint has to compute 100 - 40 = 60.
    res = client.post(f"/api/jobs/{parent_id}/resume", json={})
    assert res.status_code == 200
    child_id = res.json()["job_id"]
    assert job_store.get(child_id) is not None


def test_resume_success_with_explicit_n_trials(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_failed_tune_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{parent_id}/resume", json={"n_trials": 15})
    assert res.status_code == 200
    assert res.json()["parent_job_id"] == parent_id


# ---------------------------------------------------------------------------
# ws.current_job_id is updated even when the retune child immediately
# fails (ws.dataframe=None path). This is the fix for the deep-review
# HIGH finding where a failed retune used to leave the workspace
# pointing at the parent.
# ---------------------------------------------------------------------------


def test_retune_sets_workspace_current_job_id_to_child(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    ws = app.state.workspace

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 200
    child_id = res.json()["job_id"]

    # No dataframe loaded in the test workspace, so start_retune_async's
    # early-failed path runs. Even in that path, we must have set
    # current_job_id to the child so the UI does not show the parent.
    assert ws.current_job_id == child_id


# ---------------------------------------------------------------------------
# Expand_boundary / boundary_threshold forward through the request body.
# ---------------------------------------------------------------------------


def test_retune_forwards_expand_and_threshold(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(
        f"/api/jobs/{parent_id}/retune",
        json={
            "n_trials": 10,
            "expand_boundary": True,
            "boundary_threshold": 0.05,
        },
    )
    assert res.status_code == 200


def test_retune_rejects_extra_fields_on_body(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Pydantic extra='forbid' guard (security review MEDIUM)."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(
        f"/api/jobs/{parent_id}/retune",
        json={"n_trials": 10, "unknown_field": "junk"},
    )
    assert res.status_code == 422


def test_retune_rejects_invalid_boundary_threshold_range(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """The API layer mirrors lizyml's ``Model.tune`` constraint
    (boundary_threshold in (0.0, 0.5)) so an out-of-range value fails
    synchronously with 400 INVALID_PARAM instead of bubbling up as a
    failed child job. H-0062 Bugfix 2026-04-14 (test gap follow-up):
    previously this test asserted the 200 + async-fail behaviour, but
    that was a UX hole (the user only saw the failure after polling
    the child)."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(
        f"/api/jobs/{parent_id}/retune",
        json={"n_trials": 3, "boundary_threshold": 0.99},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


def test_retune_accepts_valid_boundary_threshold(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Edge case: a valid boundary_threshold in the open interval
    must NOT be rejected by the new guard."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(
        f"/api/jobs/{parent_id}/retune",
        json={"n_trials": 3, "boundary_threshold": 0.05},
    )
    assert res.status_code == 200


def test_retune_rejects_zero_boundary_threshold(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Edge case: 0.0 is rejected (open interval)."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(
        f"/api/jobs/{parent_id}/retune",
        json={"n_trials": 3, "boundary_threshold": 0.0},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "INVALID_PARAM"


# ---------------------------------------------------------------------------
# Lineage endpoint — previously only 200 / 404 were covered. Add:
# - leaf node with children: [] and truncated: false
# - multi-branch fan-out
# ---------------------------------------------------------------------------


def test_lineage_endpoint_leaf_has_empty_children(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.get(f"/api/jobs/{parent_id}/lineage")
    assert res.status_code == 200
    tree = res.json()["tree"]
    assert tree["children"] == []
    assert tree.get("truncated") is False


def test_lineage_endpoint_multi_branch(
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
    for _ in range(3):
        job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
            parent_job_id=parent.job_id,
        )
    res = client.get(f"/api/jobs/{parent.job_id}/lineage")
    assert res.status_code == 200
    tree = res.json()["tree"]
    assert len(tree["children"]) == 3


# ---------------------------------------------------------------------------
# Delete edge cases
# ---------------------------------------------------------------------------


def test_cascade_delete_returns_removed_id_list(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Create two children + one grandchild (even though MVP rejects
    # nested retune via API, the store itself allows the shape).
    child_a = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent_id,
    )
    grand = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=child_a.job_id,
    )
    child_b = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=sample_data_ref,
        job_type="tune",
        parent_job_id=parent_id,
    )
    for j in (child_a, grand, child_b):
        j.status = "completed"
        job_store.update(j)

    res = client.delete(f"/api/jobs/{parent_id}?cascade=true")
    assert res.status_code == 200
    body = res.json()
    removed = set(body["removed_job_ids"])
    assert removed == {parent_id, child_a.job_id, grand.job_id, child_b.job_id}


def test_delete_cascade_true_still_removes_single_job(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """cascade=true should not error when there are no children."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.delete(f"/api/jobs/{parent_id}?cascade=true")
    assert res.status_code == 200
    assert res.json()["removed_job_ids"] == [parent_id]


# ---------------------------------------------------------------------------
# PICKLE_INCOMPATIBLE synchronous check in _require_tune_job_with_checkpoint
# ---------------------------------------------------------------------------


def test_retune_rejects_incompatible_pickle_version(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """A parent with a stale lizyml version in model_meta.json must be
    rejected by the API layer synchronously, not as a failed child job."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    # Overwrite the sidecar with a mismatched lizyml major.minor.
    meta = job_store.jobs_dir / parent_id / "model_meta.json"
    meta.write_text(
        '{"pickle_schema": 1, "lizyml_version": "0.3.0", '
        '"lightgbm_version": "4.5.0", "optuna_version": "4.0.0", '
        '"saved_at": "2026-04-14T00:00:00+00:00"}',
        encoding="utf-8",
    )

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "PICKLE_INCOMPATIBLE"


def test_retune_rejects_corrupted_meta_json(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """A parent whose model_meta.json is unparseable (truncated write,
    partial atomic rename failure, manual edit) must surface as a
    structured 400 PICKLE_INCOMPATIBLE rather than crashing the API
    with a 500. H-0062 Bugfix 2026-04-14 (test gap follow-up)."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    meta = job_store.jobs_dir / parent_id / "model_meta.json"
    # Half-written JSON — common after a partial write.
    meta.write_text('{"pickle_schema": 1, "lizyml_version":', encoding="utf-8")

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "PICKLE_INCOMPATIBLE"


def test_retune_missing_meta_is_tolerated(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Legacy parents written before H-0062 have no model_meta.json.
    The API must still accept the retune and let the adapter decide.
    """
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    meta = job_store.jobs_dir / parent_id / "model_meta.json"
    meta.unlink()  # drop the sidecar

    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 200


def test_retune_response_body_schema(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Response shape must match LineageNode typescript expectation."""
    parent_id = _make_completed_tune_job(client, sample_data_ref)
    res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
    assert res.status_code == 200
    body = res.json()
    assert set(body.keys()) == {"job_id", "parent_job_id"}
    assert isinstance(body["job_id"], str)
    assert body["parent_job_id"] == parent_id


# ---------------------------------------------------------------------------
# _claim_retune_slot: placeholder lock release on child creation failure
# ---------------------------------------------------------------------------


def test_retune_release_lock_when_child_create_fails(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """If JobStore.create raises, the placeholder parent lock must be
    released so the parent can be retried."""
    from unittest.mock import patch

    parent_id = _make_completed_tune_job(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    with patch.object(
        job_store, "create", side_effect=RuntimeError("synthetic create error")
    ):
        try:
            res = client.post(f"/api/jobs/{parent_id}/retune", json={"n_trials": 3})
            assert res.status_code == 500
        except RuntimeError:
            # TestClient re-raises the original error; acceptable.
            pass

    # The parent lock must not be held by anyone.
    assert job_store.get_locked_child(parent_id) is None


# ---------------------------------------------------------------------------
# End-to-end with real lizyml backend (H-0062 regression)
# ---------------------------------------------------------------------------


@pytest.mark.slow
def test_retune_end_to_end_with_real_lizyml(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Full API round-trip against a real lizyml backend.

    Regression guard for the bug where POST /api/jobs/{id}/retune would
    fail inside the worker thread with lizyml "Cannot resume tuning: no
    previous tune() call" because the per-trial checkpoint bridge saved
    the model before `self._study = study` was assigned. Fix landed in
    LizyMLAdapter.tune (final save after tune() returns).
    """
    import numpy as np
    import pandas as pd

    from lizystudio.backends.types import DataRef as _DataRef
    from lizystudio.services.training import run_tune
    from lizystudio.services.workspace import WorkspaceState

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    ws: WorkspaceState = app.state.workspace

    rng = np.random.default_rng(42)
    n = 60
    df = pd.DataFrame(
        {
            "x1": rng.normal(size=n),
            "x2": rng.normal(size=n),
            "y": rng.integers(0, 2, size=n),
        }
    )
    ws.set_data(
        df,
        _DataRef(
            source_type="upload",
            path=None,
            filename="tiny.csv",
            fingerprint="tiny",
            shape=df.shape,
        ),
    )

    parent_config: dict[str, Any] = {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "y"},
        "model": {"name": "lgbm", "params": {"verbose": -1}},
        "split": {"method": "stratified_kfold", "n_splits": 3},
        "tuning": {
            "optuna": {
                "params": {"n_trials": 2, "direction": "maximize"},
            }
        },
    }
    parent_job = job_store.create(
        backend_name="lizyml",
        config=parent_config,
        data_ref=ws.data_ref,
        job_type="tune",
    )
    run_tune(
        job=parent_job,
        job_store=job_store,
        backend=ws.backend,
        config=parent_config,
        dataframe=df,
    )
    parent_reloaded = job_store.get(parent_job.job_id)
    assert parent_reloaded is not None
    assert parent_reloaded.status == "completed", parent_reloaded.error

    # Hit the real /retune endpoint. The worker runs in a daemon thread;
    # wait for it to finish so we can assert on the child status.
    res = client.post(
        f"/api/jobs/{parent_job.job_id}/retune",
        json={"n_trials": 1},
    )
    assert res.status_code == 200
    child_id = res.json()["job_id"]

    # Join the worker thread (daemon). Timeout is generous: even a tiny
    # tune can take a few seconds on first import.
    with ws._lock:
        thread = ws._job_thread
    if thread is not None:
        thread.join(timeout=60)
        assert not thread.is_alive(), "retune worker did not finish within 60s"

    child = job_store.get(child_id)
    assert child is not None
    assert child.status == "completed", (
        f"retune child failed: status={child.status} error={child.error}"
    )
    assert child.tune_result is not None
    # The critical regression guard: the child completed at all. Before
    # the fix, the child would reach "failed" with lizyml error
    # "Cannot resume tuning: no previous tune() call". We deliberately do
    # NOT assert an exact trial count because Optuna pruning behaviour
    # at n_trials=1 is not stable enough for CI.
    assert child.error is None
