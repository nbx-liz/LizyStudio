"""Tests for the per-app MetricsRegistry (A-9).

The registry replaces the module-level Counter / Histogram / Gauge
globals so that pytest can build two FastAPI apps in the same process
without `prometheus_client.core.Collector._metrics` raising
``Duplicated timeseries`` on the second app's import.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from prometheus_client import Counter, Gauge, Histogram

from lizystudio.metrics import MetricsRegistry
from lizystudio.server import create_app

pytestmark = pytest.mark.integration


def test_metrics_registry_has_all_declared_instruments() -> None:
    """Every metric name referenced by the codebase must exist on the registry."""
    registry = MetricsRegistry()

    # Counters
    assert isinstance(registry.requests_total, Counter)
    assert isinstance(registry.jobs_total, Counter)
    assert isinstance(registry.progress_dropped_total, Counter)

    # Histograms
    assert isinstance(registry.request_duration, Histogram)
    assert isinstance(registry.jobs_duration, Histogram)

    # Gauges
    assert isinstance(registry.active_jobs, Gauge)


def test_metrics_registry_instances_are_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two registry instances must not collide on the prometheus global.

    Before A-9, re-importing the module would raise ``ValueError:
    Duplicated timeseries in CollectorRegistry`` because Counter /
    Histogram / Gauge construction registers on the default global
    ``REGISTRY``. After A-9 each registry owns its own
    ``CollectorRegistry``.
    """
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))

    first = MetricsRegistry()
    second = MetricsRegistry()

    # Each must be a distinct Python object with its own registry.
    assert first is not second
    assert first.registry is not second.registry
    # Counter instances differ too.
    assert first.jobs_total is not second.jobs_total


def test_two_apps_can_coexist_in_the_same_process(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Two FastAPI apps must be instantiable in the same pytest process.

    This is the core A-9 acceptance: module-level globals used to make
    the second ``create_app()`` raise when prometheus re-registered
    ``lizystudio_requests_total`` etc. After A-9 each app has its own
    ``app.state.metrics`` and survives side-by-side instantiation.
    """
    jobs_a = tmp_path / "jobs_a"
    jobs_b = tmp_path / "jobs_b"
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_a))

    app_a = create_app()
    # Swap env so the second app does not share job storage (otherwise
    # it would use the same JobStore dir, which is orthogonal to the
    # metrics isolation question but keeps the fixture realistic).
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_b))
    app_b = create_app()

    with TestClient(app_a) as client_a, TestClient(app_b) as client_b:
        body_a = client_a.get("/api/metrics").text
        body_b = client_b.get("/api/metrics").text

        # Both apps must expose the declared series names.
        assert "lizystudio_requests_total" in body_a
        assert "lizystudio_requests_total" in body_b

        # Each app's registry is independent: traffic against app_a
        # must not bump app_b's counter.
        client_a.get("/api/workspace/status")
        client_a.get("/api/workspace/status")
        client_a.get("/api/workspace/status")

        def _status_count(body: str) -> float:
            for line in body.splitlines():
                if (
                    line.startswith("lizystudio_requests_total{")
                    and "/api/workspace/status" in line
                    and not line.startswith("#")
                ):
                    return float(line.rsplit(" ", 1)[1])
            return 0.0

        body_a_after = client_a.get("/api/metrics").text
        body_b_after = client_b.get("/api/metrics").text

        # app_a saw three hits; app_b saw zero. Registry isolation
        # means the second app's status counter is still at or below 0.
        assert _status_count(body_a_after) >= 3.0
        assert _status_count(body_b_after) == 0.0


def test_app_state_metrics_is_wired(
    client: TestClient,
) -> None:
    """``app.state.metrics`` must expose the active :class:`MetricsRegistry`."""
    metrics = client.app.state.metrics  # type: ignore[attr-defined]
    assert isinstance(metrics, MetricsRegistry)


def test_record_job_terminal_is_a_method(
    client: TestClient,
) -> None:
    """``record_job_terminal`` moved from module-level to an instance method.

    Callers now reach it via ``app.state.metrics.record_job_terminal(...)``
    (or through ``Depends(get_metrics)`` in routers).
    """
    metrics = client.app.state.metrics  # type: ignore[attr-defined]
    assert callable(getattr(metrics, "record_job_terminal", None))

    # Smoke: must not raise; backward-compatible signature.
    metrics.record_job_terminal("fit", "completed", duration=0.25)
    metrics.record_job_terminal("tune", "failed")
