"""Tests for GET /api/metrics (BLUEPRINT §5.9, H-0065).

Issue #30 Phase 2 — Prometheus text format exposition.

NOTE on test isolation: prometheus_client uses a process-global
default registry, and Counter values cannot be reset by design.
Assertions here are all relative (baseline-then-delta) or check
structural properties (content-type, series presence, label
exclusion). Do NOT add tests that assert a Counter / Histogram
equals an absolute numeric value — earlier tests in the same
session will have already incremented it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_metrics_returns_200_and_prometheus_content_type(
    client: TestClient,
) -> None:
    """GET /api/metrics must return 200 + Prometheus text format."""
    resp = client.get("/api/metrics")
    assert resp.status_code == 200
    content_type = resp.headers.get("content-type", "")
    assert content_type.startswith("text/plain")
    # prometheus_client uses version=0.0.4 in the content-type param.
    assert "version=" in content_type


def test_metrics_contains_all_declared_series(client: TestClient) -> None:
    """Declared series names must appear in the response body.

    Counter / Histogram / Gauge are all registered at module import time
    so the text output contains their HELP/TYPE blocks even with zero
    samples. This guards against accidental metric renames.
    """
    resp = client.get("/api/metrics")
    body = resp.text
    assert "lizystudio_requests_total" in body
    assert "lizystudio_request_duration_seconds" in body
    assert "lizystudio_jobs_total" in body
    assert "lizystudio_active_jobs" in body


def test_requests_total_increments_after_a_request(client: TestClient) -> None:
    """Any request through the middleware must bump requests_total."""
    # Prime: fetch baseline count.
    client.get("/api/workspace/status")
    first = client.get("/api/metrics").text

    # Fire a known request.
    client.get("/api/workspace/status")
    second = client.get("/api/metrics").text

    # Extract the counter line for /api/workspace/status and confirm it grew.
    def _extract(body: str) -> float:
        for line in body.splitlines():
            if (
                line.startswith("lizystudio_requests_total{")
                and ("/api/workspace/status" in line)
                and not line.startswith("#")
            ):
                return float(line.rsplit(" ", 1)[1])
        return 0.0

    assert _extract(second) >= _extract(first) + 1.0


def test_metrics_endpoint_itself_is_excluded_from_counter(
    client: TestClient,
) -> None:
    """`/api/metrics` scrapes must not pollute lizystudio_requests_total."""
    # Hit /api/metrics many times; its own line should never appear in
    # lizystudio_requests_total.
    for _ in range(3):
        client.get("/api/metrics")
    body = client.get("/api/metrics").text
    for line in body.splitlines():
        if line.startswith("lizystudio_requests_total") and not line.startswith("#"):
            assert '"/api/metrics"' not in line, (
                f"metrics endpoint leaked into requests_total: {line}"
            )


def test_path_label_uses_route_template_not_raw_id(client: TestClient) -> None:
    """Path labels must be the FastAPI route template, not raw job ids.

    Cardinality guard — H-0065 acceptance (f).
    """
    # Trigger a 404 against a job-detail route so the metric emits a path.
    client.get("/api/jobs/job_does_not_exist_xyz")
    body = client.get("/api/metrics").text

    # No raw id should ever appear as a label value.
    assert "job_does_not_exist_xyz" not in body

    # Instead, the route template should appear.
    assert "/api/jobs/{job_id}" in body or 'path="unmatched"' in body


def test_unmatched_paths_collapse_to_single_label(client: TestClient) -> None:
    """4xx paths that do not match any FastAPI route must collapse.

    Without this guard, spraying random URLs at the server would grow
    the series set unboundedly.
    """
    client.get("/this/does/not/exist/1")
    client.get("/this/does/not/exist/2")
    body = client.get("/api/metrics").text

    # Neither raw path should appear.
    assert "/this/does/not/exist/1" not in body
    assert "/this/does/not/exist/2" not in body


def test_asset_paths_do_not_explode_cardinality(client: TestClient) -> None:
    """Static assets / SPA fallback paths must not leak raw URLs.

    When the frontend bundle is mounted, hundreds of hashed asset
    filenames would otherwise each become a distinct series. Assert
    that random asset-shaped paths neither appear raw nor crash the
    middleware.
    """
    client.get("/assets/chunk-abc123.js")
    client.get("/assets/chunk-def456.js")
    body = client.get("/api/metrics").text

    # Neither hashed filename should appear as a label value.
    assert "chunk-abc123.js" not in body
    assert "chunk-def456.js" not in body


def test_jobs_duration_histogram_is_declared(client: TestClient) -> None:
    """H-0066: the duration histogram must appear in the text output.

    Declared at module-import time so the HELP/TYPE headers are
    present even before the first job finishes.
    """
    body = client.get("/api/metrics").text
    assert "# TYPE lizystudio_jobs_duration_seconds histogram" in body


def test_jobs_duration_uses_ml_workload_buckets(client: TestClient) -> None:
    """H-0066 (c): buckets must cover seconds through one hour.

    The prometheus_client default (5ms -> 10s) would collapse every
    real fit / tune into the `+Inf` bucket, making the histogram
    useless for ML latency analysis. Lock the custom ladder in so a
    future refactor cannot regress it.

    Note: prometheus_client only emits `_bucket` lines after the first
    observation — prime the histogram with one sample before reading.
    """
    from lizystudio.metrics import record_job_terminal

    record_job_terminal("fit", "completed", duration=0.5)

    body = client.get("/api/metrics").text
    # A handful of bucket edges we promised in BLUEPRINT §5.9.
    for edge in ("1.0", "10.0", "60.0", "600.0", "3600.0"):
        assert f'le="{edge}"' in body, (
            f"expected bucket le={edge} missing from /api/metrics"
        )


def test_record_job_terminal_accepts_duration(client: TestClient) -> None:
    """`record_job_terminal` should accept a `duration` keyword.

    The helper is the single entry point used across the training
    service; adding a duration arg keeps the call sites uniform.
    """
    from lizystudio.metrics import record_job_terminal

    # Should not raise; duration is optional.
    record_job_terminal("fit", "completed", duration=1.23)
    record_job_terminal("tune", "failed")  # backward-compat: no duration


def test_active_jobs_gauge_starts_at_zero(client: TestClient) -> None:
    """A freshly-started app has no active job; gauge must read 0."""
    body = client.get("/api/metrics").text
    for line in body.splitlines():
        if line.startswith("lizystudio_active_jobs") and not line.startswith("#"):
            # Samples like "lizystudio_active_jobs 0.0"
            value = float(line.rsplit(" ", 1)[1])
            assert value == 0.0
            return
    raise AssertionError("lizystudio_active_jobs sample line not found")
