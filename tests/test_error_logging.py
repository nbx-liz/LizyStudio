"""Tests for StudioError observability logging (Issue #513).

The error handler must emit a WARNING-level log line on the
``lizystudio.errors`` logger for every ``StudioError`` so operators
can grep server logs for user-facing 4xx incidents.

Acceptance criteria from Issue #513:
- WARNING for every StudioError
- Log line includes code / status_code / HTTP method / URL path
- No ``details`` payload at WARNING level (may carry user-supplied data)
- ``BackendError`` exception-path logging is unchanged
"""

from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

ERRORS_LOGGER = "lizystudio.errors"


def _warning_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        r
        for r in caplog.records
        if r.name == ERRORS_LOGGER and r.levelno == logging.WARNING
    ]


def test_studio_error_emits_warning_log(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """A 4xx StudioError emits a WARNING line on the `lizystudio.errors` logger.

    The line must include the error code, status code, HTTP method, and
    URL path so operators can grep the log after a user-reported
    incident (Issue #513 rationale).
    """
    caplog.set_level(logging.WARNING, logger=ERRORS_LOGGER)
    resp = client.get("/api/jobs/nonexistent-job-id")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "JOB_NOT_FOUND"

    records = _warning_records(caplog)
    assert len(records) == 1, f"expected exactly one WARNING, got {records}"
    msg = records[0].getMessage()
    assert "JOB_NOT_FOUND" in msg
    assert "404" in msg
    assert "GET" in msg
    assert "/api/jobs/nonexistent-job-id" in msg


def test_studio_error_warning_does_not_leak_details_payload(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    """The WARNING-level log must NOT contain the ``details`` payload.

    ``details`` can carry user-supplied input (file paths, validation
    snippets). Issue #513's "What NOT to do" pins this to DEBUG or
    lower; the WARNING line stays PII-free so it can be safely
    centralized.
    """
    caplog.set_level(logging.WARNING, logger=ERRORS_LOGGER)
    secret_marker = "this-secret-marker-must-not-leak"
    resp = client.post(
        "/api/workspace/data/path",
        json={"path": f"/tmp/{secret_marker}.csv"},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "PATH_NOT_FOUND"

    records = _warning_records(caplog)
    assert len(records) == 1
    msg = records[0].getMessage()
    assert "PATH_NOT_FOUND" in msg
    assert secret_marker not in msg, (
        "WARNING-level log line leaked a user-supplied path; "
        "details payload must stay off the WARNING channel"
    )


def test_backend_error_exception_path_unchanged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """``BackendError.__init__`` still calls ``_backend_logger.exception(...)``.

    The handler-level WARNING is additive; we must not regress the
    existing exception-with-traceback emission for 500-class backend
    failures (errors.py:115).
    """
    caplog.set_level(logging.DEBUG, logger=ERRORS_LOGGER)
    from lizystudio.api.errors import BackendError

    BackendError(RuntimeError("simulated backend failure"))

    exception_records = [
        r
        for r in caplog.records
        if r.name == ERRORS_LOGGER and r.levelno == logging.ERROR
    ]
    assert len(exception_records) >= 1, (
        "BackendError must still log via _backend_logger.exception"
    )
