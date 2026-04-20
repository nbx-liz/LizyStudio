"""Regression test for missing failed-job metric on slot-claim failure (Issue #154).

``api/workspace.py`` called ``release_active`` on a failed handoff
(PreviousJobStillRunningError or a generic thread-start failure) but
did NOT call ``record_job_terminal(job_type, "failed")``. The
``lizystudio_jobs_total{status="failed"}`` counter undercounted these
failures. ``ACTIVE_JOBS`` recovered correctly via ``release_active``;
only the terminal counter was missing.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _jobs_total(client: TestClient, labels: dict[str, str]) -> float:
    """Read the current ``jobs_total`` value for the given label set.

    A-9: the counter now lives on the per-app :class:`MetricsRegistry`
    bound to ``app.state.metrics``.
    """
    metrics = client.app.state.metrics  # type: ignore[attr-defined]
    return metrics.jobs_total.labels(**labels)._value.get()  # type: ignore[attr-defined]


def _seed_workspace(client: TestClient, tmp_path: Path) -> None:
    """Load minimal CSV + default config so /fit and /tune reach the
    slot-claim stage (mirrors ``tests/test_workspace_api._load_data_and_config``).
    """
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, i % 2])

    r = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert r.status_code == 200, r.text

    r = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert r.status_code == 200, r.text
    config = r.json()
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200 and r.json()["saved"] is True, r.text


def test_fit_previous_job_running_emits_failed_metric(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """When start_fit_async raises PreviousJobStillRunningError after
    slot claim, the failed counter must increment by 1.
    """
    from lizystudio.api import workspace as ws_mod
    from lizystudio.services.training import PreviousJobStillRunningError

    _seed_workspace(client, tmp_path)

    def _raise_previous(**kwargs: Any) -> str:
        raise PreviousJobStillRunningError("already running")

    monkeypatch.setattr(ws_mod, "start_fit_async", _raise_previous)

    before = _jobs_total(client, {"job_type": "fit", "status": "failed"})
    response = client.post("/api/workspace/fit")
    assert response.status_code == 409, response.text
    after = _jobs_total(client, {"job_type": "fit", "status": "failed"})
    assert after - before == 1, (
        f"expected 1 failed-metric emission, got delta={after - before}"
    )


def test_tune_previous_job_running_emits_failed_metric(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Tune counterpart of test_fit_previous_job_running_emits_failed_metric."""
    from lizystudio.api import workspace as ws_mod
    from lizystudio.services.training import PreviousJobStillRunningError

    _seed_workspace(client, tmp_path)

    def _raise_previous(**kwargs: Any) -> str:
        raise PreviousJobStillRunningError("already running")

    monkeypatch.setattr(ws_mod, "start_tune_async", _raise_previous)

    before = _jobs_total(client, {"job_type": "tune", "status": "failed"})
    response = client.post("/api/workspace/tune")
    assert response.status_code == 409, response.text
    after = _jobs_total(client, {"job_type": "tune", "status": "failed"})
    assert after - before == 1


def test_fit_generic_thread_start_failure_emits_failed_metric(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """The broader ``except Exception`` branch also undercounted before
    the fix. Any post-claim exception must emit the failed metric and
    re-raise.

    Starlette's TestClient propagates server exceptions directly into
    the test (``raise_server_exceptions=True`` by default), so we
    assert with ``pytest.raises`` instead of status-code 500.
    """
    from lizystudio.api import workspace as ws_mod

    _seed_workspace(client, tmp_path)

    def _raise_runtime(**kwargs: Any) -> str:
        raise RuntimeError("thread start failed")

    monkeypatch.setattr(ws_mod, "start_fit_async", _raise_runtime)

    before = _jobs_total(client, {"job_type": "fit", "status": "failed"})
    with pytest.raises(RuntimeError, match="thread start failed"):
        client.post("/api/workspace/fit")
    after = _jobs_total(client, {"job_type": "fit", "status": "failed"})
    assert after - before == 1


def test_tune_generic_thread_start_failure_emits_failed_metric(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Tune counterpart of the generic-exception regression guard."""
    from lizystudio.api import workspace as ws_mod

    _seed_workspace(client, tmp_path)

    def _raise_runtime(**kwargs: Any) -> str:
        raise RuntimeError("thread start failed")

    monkeypatch.setattr(ws_mod, "start_tune_async", _raise_runtime)

    before = _jobs_total(client, {"job_type": "tune", "status": "failed"})
    with pytest.raises(RuntimeError, match="thread start failed"):
        client.post("/api/workspace/tune")
    after = _jobs_total(client, {"job_type": "tune", "status": "failed"})
    assert after - before == 1
