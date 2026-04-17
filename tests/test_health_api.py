"""Tests for GET /api/health and /api/health/ready (BLUEPRINT §5.8, H-0064).

Covers Issue #30 Phase 1.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from lizystudio import __version__

pytestmark = pytest.mark.integration


def test_liveness_returns_200_with_status_and_version(client: TestClient) -> None:
    """Liveness endpoint must be 200 as long as the process is responsive."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["version"] == __version__


def test_readiness_returns_200_when_fully_initialized(client: TestClient) -> None:
    """After lifespan startup completes, readiness should be ready."""
    resp = client.get("/api/health/ready")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["version"] == __version__
    assert body["backend"] == "lizyml"
    assert body["jobs_dir"] is True


def test_readiness_returns_503_when_jobs_dir_missing() -> None:
    """If the JobStore's base_dir disappears after startup, ready=false/503."""
    # Build an app whose lifespan initializes normally, then delete the
    # jobs_dir so the readiness check observes the regression.
    import os
    from pathlib import Path

    from lizystudio.server import create_app

    os.environ["LIZYSTUDIO_JOBS_DIR"] = "/tmp/lizystudio_health_test_jobs"
    app: FastAPI = create_app()
    with TestClient(app) as c:
        # Confirm it starts ready.
        assert c.get("/api/health/ready").status_code == 200

        # Point the JobStore at a non-existent path to simulate a lost
        # mount / deleted directory.
        app.state.job_store.jobs_dir = Path("/nonexistent/lizystudio_jobs_xyz")

        resp = c.get("/api/health/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "not_ready"
        assert body["jobs_dir"] is False


def test_liveness_survives_broken_app_state() -> None:
    """Liveness must return 200 even when app.state is corrupted.

    Hardens H-0064 acceptance (d): a flaky backend or missing
    workspace must NEVER make k8s restart the pod.
    """
    from lizystudio.server import create_app

    app: FastAPI = create_app()
    with TestClient(app) as c:
        # Remove core state attributes. Liveness must not touch them.
        del app.state.workspace
        del app.state.job_store
        resp = c.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


def test_readiness_reports_not_ready_when_workspace_missing() -> None:
    """If `workspace` is unavailable, readiness reports backend=null / 503."""
    from lizystudio.server import create_app

    app: FastAPI = create_app()
    with TestClient(app) as c:
        del app.state.workspace
        resp = c.get("/api/health/ready")
        assert resp.status_code == 503
        body = resp.json()
        assert body["status"] == "not_ready"
        assert body["backend"] is None


def test_readiness_returns_json_content_type(client: TestClient) -> None:
    """Readiness must hit the API router (JSON), not the SPA fallback."""
    resp = client.get("/api/health/ready")
    assert resp.headers["content-type"].startswith("application/json")


def test_liveness_is_not_swallowed_by_spa_fallback(client: TestClient) -> None:
    """/api/health must hit the API router, not the SPA catch-all.

    server.py serves index.html for any unmatched path when the static
    build is present. The /api/ prefix guard must keep /api/health
    flowing to the health router.
    """
    resp = client.get("/api/health")
    # An SPA fallback would return HTML (index.html), not JSON.
    assert resp.headers["content-type"].startswith("application/json")
