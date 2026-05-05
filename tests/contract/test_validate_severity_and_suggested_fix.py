"""Validate API severity + suggested_fix contract (PR-B4 / R-3.4).

The pre-PR-B4 ``validate_config`` returned ``[{path, message}]``. PR-B4
extends each error dict with two structured fields the frontend can
render directly:

- ``severity``: one of ``"error" | "warning" | "info"``. Errors block
  Fit/Tune; warnings surface a yellow banner but allow the user to
  proceed; info entries are tooltip-level guidance.
- ``suggested_fix``: optional human-readable next-action string. ``None``
  when the validator does not know how to repair the field.

This file pins the schema of the new fields so frontend ergonomics do
not silently regress when validators are added or refactored.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit


def _get_valid_binary_config(client: TestClient) -> dict[str, Any]:
    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    assert res.status_code == 200, res.text
    return res.json()


def test_validate_error_dict_has_severity_field(client: TestClient) -> None:
    """Every entry in the validation errors list must carry ``severity``.

    The default for backend Pydantic errors is ``"error"`` because they
    block Fit/Tune; this test fails today (severity field absent) and
    passes once the service layer adds it.
    """
    res = client.post(
        "/api/workspace/config/validate",
        json={"task": "invalid_task"},
    )
    assert res.status_code == 200, res.text
    errors = res.json()["errors"]
    assert len(errors) > 0
    for err in errors:
        assert "severity" in err, f"validation entry missing severity: {err}"
        assert err["severity"] in ("error", "warning", "info")


def test_validate_error_dict_has_suggested_fix_field(client: TestClient) -> None:
    """Every entry must include the optional ``suggested_fix`` field.

    The field is allowed to be ``None`` (validator has no canned
    repair) but the *key* must always be present so the frontend
    renders a stable shape.
    """
    res = client.post(
        "/api/workspace/config/validate",
        json={"task": "invalid_task"},
    )
    assert res.status_code == 200, res.text
    errors = res.json()["errors"]
    assert len(errors) > 0
    for err in errors:
        assert "suggested_fix" in err, f"validation entry missing suggested_fix: {err}"
        assert err["suggested_fix"] is None or isinstance(err["suggested_fix"], str)


def test_workspace_split_error_carries_suggested_fix(
    client: TestClient,
) -> None:
    """The ``n_splits > n_rows`` validator owns its suggested fix.

    The legacy message already says "Reduce Folds to at most {n_rows}"
    — PR-B4 surfaces that in the dedicated ``suggested_fix`` field so
    the frontend can render it as a CTA button rather than scraping
    the prose.
    """
    # Stage a small dataset so the workspace-aware split validator
    # can compute a meaningful row-count gap.
    import csv
    import tempfile

    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False) as f:
        writer = csv.writer(f)
        writer.writerow(["a", "b", "y"])
        for i in range(10):
            writer.writerow([i, i + 1, i % 2])
        csv_path = f.name

    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200, res.text

    # Build a config with n_splits > n_rows so the workspace
    # validator fires.
    config = _get_valid_binary_config(client)
    config["split"]["n_splits"] = 999
    res = client.post("/api/workspace/config/validate", json=config)
    assert res.status_code == 200, res.text
    errors = res.json()["errors"]

    split_errors = [e for e in errors if e["path"] == "split.n_splits"]
    assert len(split_errors) == 1, errors
    err = split_errors[0]
    assert err["severity"] == "error"
    assert err["suggested_fix"] is not None
    # The suggested fix should mention a concrete number to set, not
    # just paraphrase the problem.
    assert "10" in err["suggested_fix"], err["suggested_fix"]


def test_validate_response_schema_stays_backward_compatible(
    client: TestClient,
) -> None:
    """Adding ``severity`` / ``suggested_fix`` must not drop the legacy
    ``path`` / ``message`` keys — older frontend builds still read those.
    """
    res = client.post(
        "/api/workspace/config/validate",
        json={"task": "invalid_task"},
    )
    errors = res.json()["errors"]
    assert len(errors) > 0
    for err in errors:
        assert "path" in err
        assert "message" in err


def test_validate_no_errors_returns_empty_list(client: TestClient) -> None:
    """Sanity: a clean config returns valid=True + no errors. The new
    fields don't appear when there's nothing to surface.
    """
    defaults = _get_valid_binary_config(client)
    res = client.post("/api/workspace/config/validate", json=defaults)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["valid"] is True
    assert body["errors"] == []
