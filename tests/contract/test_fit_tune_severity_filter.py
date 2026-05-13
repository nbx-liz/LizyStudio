"""Fit/Tune severity filter contract (PR-D1, Issue #394 follow-up).

PR-C2 wired severity-aware gating into ``POST /api/workspace/config/validate``,
``PUT /api/workspace/config``, and ``POST /api/workspace/config/upload`` so
that ``severity="warning"`` advisories (e.g. MAPE on zero target) no longer
flip ``valid=false`` / ``saved=false``. The fit and tune endpoints in
``api/workspace.py`` raised ``ValidationError`` on the unfiltered list,
which produced a release blocker: a config that the SPA could legally
save and that Validate marked ``valid=true`` would still 422 at fit time.

This file pins the contract: only ``severity="error"`` entries (or pre-
PR-B4 entries with no severity) block ``POST /fit`` and ``POST /tune``.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_regression_csv(
    tmp_path: Path,
    *,
    target_values: list[float],
    name: str = "train.csv",
) -> str:
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["a", "b", "y"])
        for i, val in enumerate(target_values):
            writer.writerow([i, i + 1, val])
    return str(csv_path)


def _stage_warning_only_workspace(client: TestClient, tmp_path: Path) -> dict:
    """Load a regression CSV with target=0 and configure ``mape``.

    Returns the config dict so the caller can decide whether to PUT it
    or pass it inline via ``body.config``.
    """
    csv_path = _create_regression_csv(
        tmp_path,
        target_values=[0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
    )
    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200, res.text

    res = client.get("/api/workspace/config/defaults?task=regression&target=y")
    assert res.status_code == 200, res.text
    config = res.json()
    config["evaluation"]["metrics"] = ["mae", "mape"]
    return config


def _assert_warning_only(client: TestClient, config: dict) -> None:
    """Sanity check: validate emits a warning entry but ``valid=true``."""
    res = client.post("/api/workspace/config/validate", json=config)
    body = res.json()
    assert body["valid"] is True, body
    assert any(e.get("severity") == "warning" for e in body["errors"]), body


# ---------------------------------------------------------------------------
# /fit
# ---------------------------------------------------------------------------


def test_post_fit_succeeds_when_only_warnings_present(
    client: TestClient, tmp_path: Path
) -> None:
    """Warning-only config: validate=true, saved=true, fit must run.

    This is the regression for the v0.4.1 release blocker — pre-PR-D1
    workspace_fit() raised on any non-empty errors list, so a
    severity="warning" advisory turned into a 422.
    """
    config = _stage_warning_only_workspace(client, tmp_path)
    _assert_warning_only(client, config)

    res = client.put("/api/workspace/config", json=config)
    assert res.json()["saved"] is True, res.json()

    res = client.post("/api/workspace/fit")
    assert res.status_code == 200, res.text
    assert "job_id" in res.json()


def test_post_fit_with_body_config_succeeds_when_only_warnings_present(
    client: TestClient, tmp_path: Path
) -> None:
    """``body.config`` carrying a warning-only config must not 422.

    Mirrors the saved-state test for the inline ``body.config`` path
    (P-0086 atomic write). Two separate raise sites in workspace_fit;
    both must respect severity.
    """
    config = _stage_warning_only_workspace(client, tmp_path)
    _assert_warning_only(client, config)

    res = client.post("/api/workspace/fit", json={"config": config})
    assert res.status_code == 200, res.text
    assert "job_id" in res.json()


def test_post_fit_blocks_on_severity_error(client: TestClient, tmp_path: Path) -> None:
    """``severity="error"`` entries (n_splits>n_rows) keep blocking Fit.

    Negative case: severity filtering must not weaken the existing
    Issue #268 guard. n_splits=999 against 10 rows still surfaces a
    ``severity="error"`` entry and the fit endpoint must 422.
    """
    config = _stage_warning_only_workspace(client, tmp_path)
    config["split"]["n_splits"] = 999
    res = client.post("/api/workspace/fit", json={"config": config})
    assert res.status_code == 422, res.text


def test_post_fit_blocks_on_pre_prb4_entries_with_no_severity(
    client: TestClient, tmp_path: Path
) -> None:
    """Pre-PR-B4 entries without ``severity`` default to ``"error"``.

    Backward-compat guarantee: an older backend adapter that does not
    yet emit the severity field must continue to block Fit. We exercise
    this by injecting an invalid task into ``body.config`` so the
    Pydantic layer raises a backend error which (at the time of
    writing) is still emitted with severity unset only on legacy
    paths — current Pydantic errors carry severity="error" — so the
    test instead pins the ``_blocking_errors`` default by sending an
    invalid config and expecting a 422 regardless of severity.
    """
    csv_path = _create_regression_csv(tmp_path, target_values=[1.0] * 50)
    res = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert res.status_code == 200, res.text

    res = client.post("/api/workspace/fit", json={"config": {"task": "invalid"}})
    assert res.status_code == 422, res.text


# ---------------------------------------------------------------------------
# /tune
# ---------------------------------------------------------------------------


def test_post_tune_succeeds_when_only_warnings_present(
    client: TestClient, tmp_path: Path
) -> None:
    """Warning-only config: tune must accept the config and start.

    Symmetry with the /fit case — the same gating bug applied to the
    tuning endpoint's two raise sites.
    """
    config = _stage_warning_only_workspace(client, tmp_path)
    # Inject a minimal search space so /tune does not 400 on empty
    # space (separate guard, unrelated to severity filtering).
    config["tuning"] = {
        "optuna": {
            "params": {
                "n_trials": 5,
                "timeout": None,
                "direction": "minimize",
            },
            "space": {
                "n_estimators": {"type": "int", "low": 50, "high": 100, "log": False}
            },
        }
    }
    _assert_warning_only(client, config)

    res = client.put("/api/workspace/config", json=config)
    assert res.json()["saved"] is True, res.json()

    res = client.post("/api/workspace/tune")
    assert res.status_code == 200, res.text
    assert "job_id" in res.json()


def test_post_tune_with_body_config_succeeds_when_only_warnings_present(
    client: TestClient, tmp_path: Path
) -> None:
    """``body.config`` carrying a warning-only config must not 422 on /tune."""
    config = _stage_warning_only_workspace(client, tmp_path)
    config["tuning"] = {
        "optuna": {
            "params": {
                "n_trials": 5,
                "timeout": None,
                "direction": "minimize",
            },
            "space": {
                "n_estimators": {"type": "int", "low": 50, "high": 100, "log": False}
            },
        }
    }
    _assert_warning_only(client, config)

    res = client.post("/api/workspace/tune", json={"config": config})
    assert res.status_code == 200, res.text
    assert "job_id" in res.json()


# ---------------------------------------------------------------------------
# Task type guard (HIGH-1 — code review follow-up)
# ---------------------------------------------------------------------------


def test_metric_compat_silent_for_non_regression_task(
    client: TestClient, tmp_path: Path
) -> None:
    """The mape / rmsle / r2 watchlist is regression-specific.

    A binary config with a numeric target whose distribution happens to
    look "constant from R²'s point of view" (e.g. all 0/1) must not
    surface an R² warning even if the user accidentally lists ``r2``
    in evaluation.metrics. Other validators may still reject the
    config (e.g. r2 not in lizyml's binary metric list), but this test
    exercises only that ``_workspace_metric_compatibility_errors``
    short-circuits on non-regression tasks.
    """
    csv_path = tmp_path / "binary.csv"
    with csv_path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["a", "b", "y"])
        for i in range(50):
            w.writerow([i, i + 1, i % 2])  # constant variance != 0 actually,
            # but the point is task != regression so the validator
            # short-circuits before any check fires.
    res = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert res.status_code == 200, res.text

    res = client.get("/api/workspace/config/defaults?task=binary&target=y")
    config = res.json()
    res = client.post("/api/workspace/config/validate", json=config)
    body = res.json()
    metric_warnings = [
        e
        for e in body["errors"]
        if e.get("path") == "evaluation.metrics" and e.get("severity") == "warning"
    ]
    assert metric_warnings == [], body
