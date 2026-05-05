"""Contract tests for ``GET /api/diagnostic/export`` (R-3.4 / P-0097).

Locks the diagnostic export skeleton introduced for the v0.4 business-
readiness Exit Criteria. The endpoint returns a JSON snapshot a user
can attach to a support request without exposing data outside the
JobStore.

- INV: missing ``job_id`` → 422.
- INV: unknown ``job_id`` → 404 with ``JOB_NOT_FOUND``.
- INV: known ``job_id`` → 200 + JSON containing
  ``{schema_version, job, system, lizyml_version, timestamp}``.
- INV: schema_version is a stable integer that increments with
  breaking changes (currently 1).
- INV: ``system`` block has the platform / python_version /
  lizystudio_version fields the SPA / support team need to
  reproduce a bug.
- INV: ``job.config`` and ``job.data_ref`` are echoed verbatim so the
  user does not have to attach extra files.
- INV: no on-disk fit_result / metadata bytes are inlined (the
  response is small, the heavy artefacts stay in the JobStore).
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_csv(tmp_path: Path) -> str:
    csv_path = tmp_path / "diag.csv"
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["x", "y", "target"])
        for i in range(20):
            w.writerow([i, i * 2, i % 2])
    return str(csv_path)


def _seed_job(client: TestClient) -> str:
    """Inject a minimal completed Job so the diagnostic export has
    something to echo back."""
    from lizystudio.backends.types import DataRef
    from lizystudio.services.jobs import JobStore

    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "target"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/diag.csv",
            filename="diag.csv",
            fingerprint="diag-fp",
            shape=(20, 3),
        ),
        job_type="fit",
    )
    job.status = "completed"
    job_store.update(job)
    return job.job_id


def test_export_missing_job_id_returns_422(client: TestClient) -> None:
    r = client.get("/api/diagnostic/export")
    assert r.status_code == 422


def test_export_unknown_job_id_returns_404(client: TestClient) -> None:
    r = client.get("/api/diagnostic/export?job_id=doesnotexist")
    assert r.status_code == 404
    body = r.json()
    code = body.get("detail", body).get("error", {}).get("code")
    assert code == "JOB_NOT_FOUND"


def test_export_known_job_returns_envelope(client: TestClient) -> None:
    job_id = _seed_job(client)

    r = client.get(f"/api/diagnostic/export?job_id={job_id}")
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()

    # Envelope shape locked.
    assert body["schema_version"] == 1
    assert "timestamp" in body
    assert isinstance(body["timestamp"], str)

    # Job block echoes config + data_ref verbatim, plus status.
    job = body["job"]
    assert job["job_id"] == job_id
    assert job["status"] == "completed"
    assert job["config"]["task"] == "binary"
    assert job["data_ref"]["filename"] == "diag.csv"
    assert job["data_ref"]["fingerprint"] == "diag-fp"

    # System block carries reproducer info.
    sys = body["system"]
    assert "platform" in sys
    assert "python_version" in sys
    assert "lizystudio_version" in sys
    assert "lizyml_version" in sys

    # No heavy artefacts inlined (the snapshot must stay tiny).
    encoded_size = len(r.content)
    assert encoded_size < 16 * 1024, (
        f"diagnostic export too large: {encoded_size} bytes — "
        "heavy artefacts should stay in the JobStore"
    )


def test_export_does_not_leak_internal_paths(client: TestClient) -> None:
    """The response must not echo the on-disk JobStore root path.
    Support attachments leave user laptops, so absolute filesystem
    paths under the user's home directory must not show up."""
    job_id = _seed_job(client)

    r = client.get(f"/api/diagnostic/export?job_id={job_id}")
    assert r.status_code == 200
    text = r.text
    # data_ref.path *can* appear (it's user-supplied). What must NOT
    # appear is the JobStore's internal location.
    app = client.app  # type: ignore[union-attr]
    jobs_dir = str(app.state.job_store.jobs_dir)
    assert jobs_dir not in text, (
        f"diagnostic export leaked JobStore directory: {jobs_dir}"
    )
