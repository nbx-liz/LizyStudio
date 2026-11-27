"""Regression test for Issue #734 — the Tune tab's Re-tune settings reach the job.

Pre-fix bug
-----------
The Tune tab writes ``tuning.re_tune`` through ``PUT /workspace/config``.
That endpoint, and ``POST /workspace/tune`` with a body config, call
``absorb_legacy_tuning``, which moved the ``tuning`` block into
``ws.tuning_overrides`` and stored the config WITHOUT ``tuning``.
``TuningOverrides`` has no ``re_tune`` field, so the setting was dropped:
``GET /config`` never showed it, the job's ``config.tuning`` had no
``re_tune``, and the Tune ran a single round (DC4: a control with no effect).

Repair
------
``absorb_legacy_tuning`` keeps ``tuning.re_tune`` (and only it) in the
stored config; ``get_legacy_config_view`` shows it beside the synthesised
overrides block; ``materialize_tuning_for_job`` already carries
``ws.config["tuning"]["re_tune"]`` into the job config. ``TuningOverrides``,
the OpenAPI schema and ``STUDIO_FORMAT_VERSION`` are unchanged.

The tests follow the UI's real path: ``PUT /config`` with the Tune tab's
whole config, then ``POST /tune`` with a body built from ``GET /config``
(``DataPanel.getSubmitConfig``), plus the body-less variant.
"""

from __future__ import annotations

import csv
import time
from pathlib import Path
from typing import Any

import pytest
import yaml
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

RE_TUNE = {"n_rounds": 2, "n_trials": 1, "expand_boundary": True}


def _load_data(client: TestClient, tmp_path: Path) -> None:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "x2", "target"])
        for i in range(60):
            writer.writerow([i, 20 + (i % 37), (i * 7) % 11, i % 2])
    r = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert r.status_code == 200, r.text


def _tune_tab_config(client: TestClient, re_tune: Any) -> dict[str, Any]:
    """The whole config the Tune tab PUTs after a Re-tune edit."""
    r = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert r.status_code == 200, r.text
    cfg = r.json()
    cfg["tuning"] = {
        "optuna": {"params": {"n_trials": 2, "timeout": None}},
        "evaluation": {"metrics": ["auc"]},
        "re_tune": re_tune,
    }
    return cfg


def _put(client: TestClient, cfg: dict[str, Any]) -> None:
    r = client.put("/api/workspace/config", json=cfg)
    assert r.status_code == 200, r.text


def _job_config(client: TestClient, job_id: str) -> dict[str, Any]:
    r = client.get(f"/api/jobs/{job_id}/config")
    assert r.status_code == 200, r.text
    return r.json()


def _wait_terminal(client: TestClient, job_id: str, timeout: float = 120.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("completed", "failed", "cancelled"):
            return job
        time.sleep(0.2)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def test_put_config_keeps_re_tune_visible_in_get_config(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    _put(client, _tune_tab_config(client, RE_TUNE))

    view = client.get("/api/workspace/config").json()
    assert view["tuning"]["re_tune"] == RE_TUNE
    # The tuning-overrides fields still come from the stored overrides.
    assert view["tuning"]["optuna"]["params"]["n_trials"] == 2
    snapshot = client.get("/api/workspace/config/tuning-snapshot").json()
    assert snapshot["tuning_overrides"]["n_trials"] == 2
    assert "re_tune" not in snapshot["tuning_overrides"]


def test_tune_with_ui_body_carries_re_tune_and_runs_the_configured_rounds(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    _put(client, _tune_tab_config(client, RE_TUNE))

    # handleTune posts the config read back from GET /config.
    body = client.get("/api/workspace/config").json()
    r = client.post("/api/workspace/tune", json={"config": body})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    assert _job_config(client, job_id)["tuning"]["re_tune"] == RE_TUNE
    job = _wait_terminal(client, job_id)
    assert job["status"] == "completed", job.get("error")
    rounds = job["tune_result"]["rounds"]
    assert rounds is not None
    assert len(rounds) == RE_TUNE["n_rounds"]


def test_body_less_tune_after_put_carries_re_tune(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    _put(client, _tune_tab_config(client, RE_TUNE))

    r = client.post("/api/workspace/tune")
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert _job_config(client, job_id)["tuning"]["re_tune"] == RE_TUNE
    _wait_terminal(client, job_id)


def test_clearing_re_tune_removes_it_from_the_next_job(
    client: TestClient, tmp_path: Path
) -> None:
    _load_data(client, tmp_path)
    _put(client, _tune_tab_config(client, RE_TUNE))
    # RetuneSettingsSection writes ``re_tune: null`` when switched off.
    _put(client, _tune_tab_config(client, None))

    view = client.get("/api/workspace/config").json()
    assert "re_tune" not in view.get("tuning", {})

    r = client.post("/api/workspace/tune", json={"config": view})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    assert "re_tune" not in _job_config(client, job_id)["tuning"]
    _wait_terminal(client, job_id)


def test_tuning_overrides_put_and_tuning_less_put_keep_re_tune(
    client: TestClient, tmp_path: Path
) -> None:
    """Writes that do not carry ``tuning.re_tune`` leave it as it was."""
    _load_data(client, tmp_path)
    cfg = _tune_tab_config(client, RE_TUNE)
    _put(client, cfg)

    # The Tune tab's tuning-field write (P-0111) replaces only the overrides.
    r = client.put("/api/workspace/config/tuning-overrides", json={"n_trials": 5})
    assert r.status_code == 200, r.text
    view = client.get("/api/workspace/config").json()
    assert view["tuning"]["re_tune"] == RE_TUNE
    assert view["tuning"]["optuna"]["params"]["n_trials"] == 5

    # A legacy PUT without a ``tuning`` key leaves the overrides and
    # ``re_tune`` unchanged, as it always left the overrides.
    without_tuning = {k: v for k, v in cfg.items() if k != "tuning"}
    _put(client, without_tuning)
    view = client.get("/api/workspace/config").json()
    assert view["tuning"]["re_tune"] == RE_TUNE
    assert view["tuning"]["optuna"]["params"]["n_trials"] == 5


def test_fit_still_validates_with_a_stored_re_tune(
    client: TestClient, tmp_path: Path
) -> None:
    """The stored config's ``tuning`` may now hold only ``re_tune``."""
    _load_data(client, tmp_path)
    cfg = _tune_tab_config(client, RE_TUNE)
    cfg["tuning"] = {"re_tune": RE_TUNE}
    _put(client, cfg)

    r = client.post("/api/workspace/fit")
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    job = _wait_terminal(client, job_id)
    assert job["status"] == "completed", job.get("error")
    # The fit job's persisted config holds ``tuning: {re_tune}`` with no
    # ``optuna`` block; code export must still read it.
    assert _job_config(client, job_id)["tuning"] == {"re_tune": RE_TUNE}
    export = client.get(f"/api/jobs/{job_id}/export-code")
    assert export.status_code == 200, export.text


def test_yaml_import_round_trips_through_the_legacy_shims(
    client: TestClient, tmp_path: Path
) -> None:
    """#528 criterion 3: a YAML import keeps working through both shims.

    Upload stores the YAML's ``tuning`` block as is. The Web UI then reads
    ``GET /config`` (``get_legacy_config_view``) and writes it back through
    ``PUT /config`` (``absorb_legacy_tuning``) on its next save; the
    overrides fields and ``re_tune`` survive both and reach the tune job.
    """
    _load_data(client, tmp_path)
    cfg = _tune_tab_config(client, RE_TUNE)
    r = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.yaml", yaml.dump(cfg).encode(), "application/x-yaml")},
    )
    assert r.status_code == 200, r.text

    view = client.get("/api/workspace/config").json()
    assert view["tuning"]["re_tune"] == RE_TUNE
    assert view["tuning"]["optuna"]["params"]["n_trials"] == 2

    _put(client, view)
    view = client.get("/api/workspace/config").json()
    assert view["tuning"]["re_tune"] == RE_TUNE
    assert view["tuning"]["optuna"]["params"]["n_trials"] == 2
    snapshot = client.get("/api/workspace/config/tuning-snapshot").json()
    assert snapshot["tuning_overrides"]["n_trials"] == 2

    r = client.post("/api/workspace/tune", json={"config": view})
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    tuning = _job_config(client, job_id)["tuning"]
    assert tuning["re_tune"] == RE_TUNE
    assert tuning["optuna"]["params"]["n_trials"] == 2
    _wait_terminal(client, job_id)
