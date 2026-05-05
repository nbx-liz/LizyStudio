"""Contract tests for ``GET /api/jobs/{id}/importance?top_n=N`` (P-0097).

Locks the optional ``top_n`` query parameter introduced for the Wide
DataFrame UI (Issue #361):

- INV: ``top_n`` omitted → all features returned (backward compat).
- INV: ``top_n=N`` → at most N features, sorted by importance value
  descending so the SPA never renders a missing high-importance bar.
- INV: response is automatically capped to ``IMPORTANCE_PAYLOAD_LIMIT``
  bytes (~5MB). When the cap fires server-side we fall back to top-N
  and surface the truncation via the ``X-Truncated-By`` response
  header so the SPA can show "showing top N of M".
- INV: ``top_n=0`` / negative are rejected (422).
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def fake_importance_job(client: TestClient) -> Iterator[str]:
    """Inject a stub job + backend whose ``importance`` returns a wide
    feature-weight dict so the contract under test is exercised
    independently of a real fit."""
    from lizystudio.backends.types import DataRef
    from lizystudio.services.jobs import JobStore

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(100, 10000),
        ),
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)

    # Stub backend.importance: 3000 features, descending importance.
    fake_backend = MagicMock()
    fake_backend.importance.return_value = {
        f"f_{i:05d}": float(3000 - i) for i in range(3000)
    }

    # Patch the workspace dependency so the route handler picks up
    # the stubbed backend without needing a fitted model on disk.
    from lizystudio.services.workspace import WorkspaceState

    original_backend = app.state.workspace.backend
    app.state.workspace.backend = fake_backend
    # Bypass ModelCache.load by short-circuiting it.
    job_store.model_cache.load = lambda job, backend: object()  # type: ignore[assignment]

    try:
        yield job.job_id
    finally:
        app.state.workspace.backend = original_backend
        # Reset the cache method binding to its real implementation.
        from lizystudio.services.job_results import ModelCache

        job_store.model_cache.load = ModelCache.load.__get__(  # type: ignore[assignment]
            job_store.model_cache, ModelCache
        )
        # Silence unused-import warning under ruff.
        _ = WorkspaceState


def test_importance_without_top_n_returns_all_features(
    client: TestClient, fake_importance_job: str
) -> None:
    """Backward compat: omitting ``top_n`` returns every feature."""
    r = client.get(f"/api/jobs/{fake_importance_job}/importance")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 3000
    assert "X-Truncated-By" not in r.headers


def test_importance_top_n_caps_features(
    client: TestClient, fake_importance_job: str
) -> None:
    """``top_n=50`` returns the 50 highest-importance features."""
    r = client.get(f"/api/jobs/{fake_importance_job}/importance?top_n=50")
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 50
    # Sorted desc: f_00000=3000 ... f_00049=2951.
    items = list(body.items())
    assert items[0][0] == "f_00000"
    assert items[0][1] == 3000.0
    assert items[-1][1] >= 2950.0
    # X-Truncated-By only fires for SERVER-side truncation, not user
    # opt-in via top_n. Explicit top_n is honoured silently.
    assert "X-Truncated-By" not in r.headers


def test_importance_top_n_zero_rejected(
    client: TestClient, fake_importance_job: str
) -> None:
    r = client.get(f"/api/jobs/{fake_importance_job}/importance?top_n=0")
    assert r.status_code == 422


def test_importance_top_n_negative_rejected(
    client: TestClient, fake_importance_job: str
) -> None:
    r = client.get(f"/api/jobs/{fake_importance_job}/importance?top_n=-1")
    assert r.status_code == 422


def test_importance_payload_cap_falls_back_to_top_n_with_header(
    client: TestClient,
) -> None:
    """When the unbounded payload would exceed the 5MB cap, the server
    falls back to a top-N projection and surfaces the truncation via
    ``X-Truncated-By: top_n=<N>`` so the SPA can render an honest
    "showing top N of M" notice.

    Drives this with a tiny cap so the test does not need to ship a
    multi-megabyte fixture.
    """
    from lizystudio.backends.types import DataRef
    from lizystudio.services import job_results
    from lizystudio.services.jobs import JobStore

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(100, 5000),
        ),
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)

    # 5000 features, ~25 chars per name + 8 chars per float number => >130KB.
    payload = {f"feature_{i:05d}_name": float(5000 - i) for i in range(5000)}
    fake_backend = MagicMock()
    fake_backend.importance.return_value = payload
    app.state.workspace.backend = fake_backend
    job_store.model_cache.load = lambda job, backend: object()  # type: ignore[assignment]

    # Tighten the cap so we can verify behaviour without huge data.
    from lizystudio.api import jobs as jobs_api

    original_cap = jobs_api.IMPORTANCE_PAYLOAD_LIMIT
    jobs_api.IMPORTANCE_PAYLOAD_LIMIT = 4096

    try:
        r = client.get(f"/api/jobs/{job.job_id}/importance")
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body) < 5000, "server must fall back to top-N"
        assert len(body) > 0
        truncated_by = r.headers.get("X-Truncated-By", "")
        assert truncated_by.startswith("top_n="), truncated_by
        # The selected top-N is sorted desc by importance value.
        items = list(body.items())
        assert items[0][1] == 5000.0
        assert items[0][0] == "feature_00000_name"
    finally:
        jobs_api.IMPORTANCE_PAYLOAD_LIMIT = original_cap
        # Restore real backend / cache references via the same helper.
        from lizystudio.services.job_results import ModelCache

        job_store.model_cache.load = ModelCache.load.__get__(  # type: ignore[assignment]
            job_store.model_cache, ModelCache
        )
        _ = job_results
        _: dict[str, Any] = {}
        _ = json
