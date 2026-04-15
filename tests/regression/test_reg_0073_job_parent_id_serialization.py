"""Regression test: GET /api/jobs/{id} must expose parent_job_id.

The ``Job`` dataclass carries ``parent_job_id`` (optional, null for
root jobs, set for Re-tune / Resume children), and the field is
persisted to ``meta.json``. The public API consumers — the frontend
lineage panel and the Playwright retune-flow E2E suite — rely on
``parent_job_id`` being present on both the list (`GET /api/jobs/`)
and detail (`GET /api/jobs/{id}`) responses.

Before the fix, ``_job_summary`` did not copy the field into the
summary dict, so the key was simply absent from the serialized
response — ``undefined`` in TypeScript / JavaScript, which is not
equal to ``null`` for ``expect(...).toBeNull()`` assertions.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


def _seed_parent_and_child(job_store: JobStore) -> tuple[str, str]:
    """Create a root job and a child whose parent_job_id points at it."""
    parent = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(100, 5),
        ),
        job_type="tune",
    )
    parent.status = "completed"
    job_store.update(parent)

    child = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(100, 5),
        ),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    child.status = "completed"
    job_store.update(child)

    return parent.job_id, child.job_id


def test_get_job_detail_includes_parent_job_id_null_for_root(
    client: TestClient,
) -> None:
    """GET /api/jobs/{id} must return parent_job_id=null for a root job."""
    job_store: JobStore = client.app.state.job_store  # type: ignore[union-attr]
    parent_id, _ = _seed_parent_and_child(job_store)

    resp = client.get(f"/api/jobs/{parent_id}")
    assert resp.status_code == 200
    body = resp.json()

    assert "parent_job_id" in body, (
        f"parent_job_id key must always be present, got keys {sorted(body.keys())}"
    )
    assert body["parent_job_id"] is None


def test_get_job_detail_includes_parent_job_id_for_child(
    client: TestClient,
) -> None:
    """GET /api/jobs/{id} must return the parent id for a Re-tune child."""
    job_store: JobStore = client.app.state.job_store  # type: ignore[union-attr]
    parent_id, child_id = _seed_parent_and_child(job_store)

    resp = client.get(f"/api/jobs/{child_id}")
    assert resp.status_code == 200
    body = resp.json()

    assert body.get("parent_job_id") == parent_id


def test_list_jobs_includes_parent_job_id_on_every_entry(
    client: TestClient,
) -> None:
    """GET /api/jobs/ must include parent_job_id for every job in the list."""
    job_store: JobStore = client.app.state.job_store  # type: ignore[union-attr]
    parent_id, child_id = _seed_parent_and_child(job_store)

    resp = client.get("/api/jobs/")
    assert resp.status_code == 200
    jobs = resp.json()
    assert isinstance(jobs, list) and len(jobs) >= 2

    by_id = {j["job_id"]: j for j in jobs}
    assert parent_id in by_id and child_id in by_id

    for job_id, entry in by_id.items():
        assert "parent_job_id" in entry, (
            f"parent_job_id missing from list entry {job_id}: "
            f"keys={sorted(entry.keys())}"
        )

    assert by_id[parent_id]["parent_job_id"] is None
    assert by_id[child_id]["parent_job_id"] == parent_id
