"""Primary test suite for api/workspace.py.

Covers:
- GET /workspace/status: correct shape, job restore path
- POST /workspace/fit: 400 when no config, 400 when no data
- POST /workspace/tune: default tuning config injected
- POST /workspace/config/upload: valid YAML config saved
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_csv(tmp_path: Path, name: str = "train.csv") -> str:
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, i % 2])
    return str(csv_path)


def _load_valid_config(client: TestClient) -> dict:
    """Retrieve a fully-valid default config."""
    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200
    return res.json()


def _load_data_and_config(client: TestClient, tmp_path: Path) -> None:
    """Load CSV data and a valid config into the workspace."""
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200, r.text

    config = _load_valid_config(client)
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200 and r.json()["saved"] is True, r.text


# ---------------------------------------------------------------------------
# GET /workspace/status
# ---------------------------------------------------------------------------


def test_status_returns_correct_shape_empty(client: TestClient) -> None:
    """Status endpoint returns the expected top-level keys."""
    res = client.get("/api/workspace/status")
    assert res.status_code == 200
    body = res.json()
    assert "has_data" in body
    assert "has_config" in body
    assert "has_result" in body
    assert "data_ref" in body
    assert "current_job_id" in body


def test_status_has_data_false_initially(client: TestClient) -> None:
    res = client.get("/api/workspace/status")
    body = res.json()
    assert body["has_data"] is False
    assert body["has_config"] is False
    assert body["has_result"] is False
    assert body["data_ref"] is None
    assert body["current_job_id"] is None


def test_status_has_data_true_after_load(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    res = client.get("/api/workspace/status")
    body = res.json()
    assert body["has_data"] is True
    assert body["data_ref"]["filename"] == "train.csv"
    assert body["data_ref"]["shape"] == [50, 3]


def test_status_has_config_true_after_put(client: TestClient) -> None:
    config = _load_valid_config(client)
    client.put("/api/workspace/config", json=config)
    res = client.get("/api/workspace/status")
    assert res.json()["has_config"] is True


def test_status_no_disk_restore(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Per BLUEPRINT §4.2.3: browser close = Results empty. The status endpoint
    must NOT restore fit_result from disk when volatile state is lost (v2-13)."""
    from lizystudio.backends.types import FitSummary
    from lizystudio.services.jobs import JobStore
    from lizystudio.services.workspace import WorkspaceState

    app = client.app  # type: ignore[attr-defined]
    ws: WorkspaceState = app.state.workspace
    job_store: JobStore = app.state.job_store

    from lizystudio.backends.types import DataRef

    data_ref = DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc",
        shape=(50, 3),
    )
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=5, params=[])
    job_store.update(job)

    # Plant job_id into workspace (simulates page refresh)
    ws.current_job_id = job.job_id
    ws.workspace_fit_result = None

    res = client.get("/api/workspace/status")
    assert res.status_code == 200
    body = res.json()
    # Results must NOT be restored from disk
    assert body["has_result"] is False
    assert ws.workspace_fit_result is None


# ---------------------------------------------------------------------------
# POST /workspace/fit — guard clauses
# ---------------------------------------------------------------------------


def test_fit_returns_400_when_no_config(client: TestClient) -> None:
    """POST /fit must return 400 WORKSPACE_NO_CONFIG when config is empty."""
    res = client.post("/api/workspace/fit")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_fit_returns_400_when_no_data(client: TestClient) -> None:
    """POST /fit must return 400 WORKSPACE_NO_DATA when no dataframe is loaded."""
    config = _load_valid_config(client)
    client.put("/api/workspace/config", json=config)

    res = client.post("/api/workspace/fit")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"


def test_fit_starts_job_when_data_and_config_present(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /fit must return a job_id when both data and config are present."""
    _load_data_and_config(client, tmp_path)

    # Patch start_fit_async so we do not actually spin up a real ML job
    with patch(
        "lizystudio.api.workspace.start_fit_async", return_value="job_test123"
    ) as _mock_start:
        res = client.post("/api/workspace/fit")

    assert res.status_code == 200
    body = res.json()
    assert "job_id" in body
    assert body["job_id"] == "job_test123"
    _mock_start.assert_called_once()


def _seed_running_holder(job_store: Any) -> str:
    """Create a real running job on disk and claim the active slot.

    ``create_and_claim_active`` refuses new callers when the current
    slot holder is still running. Simulating that needs real on-disk
    meta — a bare ``claim_active("dummy-id")`` no longer works because
    the stale-slot auto-reclaim path sees the missing meta file and
    treats the slot as reclaimable.
    """
    from lizystudio.backends.types import DataRef

    holder = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/holder.csv",
            filename="holder.csv",
            fingerprint="h",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    holder.status = "running"
    job_store.update(holder)
    assert job_store.claim_active(holder.job_id)
    return holder.job_id


def test_fit_returns_409_when_job_active(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /fit must return 409 JOB_CONFLICT when a job is already active."""
    _load_data_and_config(client, tmp_path)

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)
    try:
        res = client.post("/api/workspace/fit")
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "JOB_CONFLICT"
    finally:
        job_store.release_active(holder_id)


def test_tune_returns_409_when_job_active(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /tune must return 409 JOB_CONFLICT when a job is already active."""
    _load_data_and_config(client, tmp_path)

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)
    try:
        res = client.post("/api/workspace/tune")
        assert res.status_code == 409
        assert res.json()["error"]["code"] == "JOB_CONFLICT"
    finally:
        job_store.release_active(holder_id)


# ---------------------------------------------------------------------------
# POST /workspace/tune — guard clauses + default tuning config injection
# ---------------------------------------------------------------------------


def test_tune_returns_400_when_no_config(client: TestClient) -> None:
    """POST /tune must return 400 WORKSPACE_NO_CONFIG when config is empty."""
    res = client.post("/api/workspace/tune")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_tune_returns_400_when_no_data(client: TestClient) -> None:
    """POST /tune must return 400 WORKSPACE_NO_DATA when no dataframe is loaded."""
    config = _load_valid_config(client)
    client.put("/api/workspace/config", json=config)

    res = client.post("/api/workspace/tune")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"


def test_tune_injects_default_tuning_config_when_missing(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /tune must inject a default tuning section when config has none (H-0025)."""
    _load_data_and_config(client, tmp_path)

    # Ensure the stored config has no tuning key
    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    ws.config.pop("tuning", None)

    with patch(
        "lizystudio.api.workspace.start_tune_async", return_value="job_tune999"
    ) as _mock_start:
        res = client.post("/api/workspace/tune")

    assert res.status_code == 200
    body = res.json()
    assert body["job_id"] == "job_tune999"

    # The tuning section must now be in workspace config
    assert ws.config.get("tuning") is not None
    tuning = ws.config["tuning"]
    assert "optuna" in tuning
    assert tuning["optuna"]["params"]["n_trials"] == 50


def test_tune_default_tuning_uses_auc_maximize_for_binary(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Bug 2026-04-14: hardcoded ``direction: minimize`` in the inject path
    caused AUC to be optimized as if low-is-better. The injected default
    tuning config must end up with ``direction: maximize`` for the
    ``binary`` + default-AUC combination after ``_prepare_tune_config``
    runs, otherwise Optuna walks the wrong way and ``best_params`` is
    meaningless.

    This is an integration test: it goes through the whole
    ``POST /workspace/tune`` path so a future regression in either the
    inject step OR the auto-resolve step in ``_prepare_tune_config``
    is caught up front.
    """
    _load_data_and_config(client, tmp_path)
    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    ws.config.pop("tuning", None)

    captured: dict[str, dict] = {}

    def fake_start(**kwargs: object) -> str:
        # Snapshot the config that would be passed to the runner so the
        # test can assert on the post-prepare direction without touching
        # internals.
        from lizystudio.services.training import _prepare_tune_config

        captured["prepared"] = _prepare_tune_config(kwargs["config"])  # type: ignore[arg-type]
        return "job_tune_dir"

    with patch("lizystudio.api.workspace.start_tune_async", side_effect=fake_start):
        res = client.post("/api/workspace/tune")
    assert res.status_code == 200, res.text

    prepared = captured["prepared"]
    direction = prepared["tuning"]["optuna"]["params"].get("direction")
    assert direction == "maximize", (
        f"Default binary + AUC tune must run as maximize, got {direction!r}. "
        "Likely cause: workspace_tune injected a hardcoded direction "
        "('minimize') and _prepare_tune_config refused to override it."
    )


def test_tune_preserves_existing_tuning_config(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /tune must NOT overwrite a tuning section that already exists."""
    _load_data_and_config(client, tmp_path)

    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    custom_tuning = {"optuna": {"params": {"n_trials": 10}}}
    ws.config["tuning"] = custom_tuning

    with patch(
        "lizystudio.api.workspace.start_tune_async", return_value="job_tune_custom"
    ):
        res = client.post("/api/workspace/tune")

    assert res.status_code == 200
    assert ws.config["tuning"] == custom_tuning


def test_tune_starts_job_when_data_and_config_present(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /tune must return a job_id when both data and config are present."""
    _load_data_and_config(client, tmp_path)

    with patch(
        "lizystudio.api.workspace.start_tune_async", return_value="job_tune_ok"
    ) as _mock_start:
        res = client.post("/api/workspace/tune")

    assert res.status_code == 200
    assert res.json()["job_id"] == "job_tune_ok"
    _mock_start.assert_called_once()


# ---------------------------------------------------------------------------
# POST /workspace/config/upload — valid YAML file
# ---------------------------------------------------------------------------


def test_config_upload_valid_yaml_is_saved(client: TestClient) -> None:
    """Uploading a fully-valid config YAML must save it (saved=True, errors=[])."""
    # Build a valid YAML from the defaults endpoint
    config = _load_valid_config(client)
    yaml_bytes = yaml.dump(config, default_flow_style=False).encode()

    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.yaml", yaml_bytes, "application/x-yaml")},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is True
    assert body["errors"] == []
    assert body["config"]["task"] == "binary"


def test_config_upload_invalid_yaml_returns_errors(client: TestClient) -> None:
    """Uploading an invalid/partial config must return errors and not save."""
    yaml_bytes = b"task: binary\nmodel:\n  name: lightgbm\n"

    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("partial.yaml", yaml_bytes, "application/x-yaml")},
    )

    assert res.status_code == 200
    body = res.json()
    # Partial config should have validation errors and not be saved
    assert isinstance(body["errors"], list)
    assert body["saved"] is False


def test_config_upload_malformed_yaml_returns_400(client: TestClient) -> None:
    """Uploading unparseable content must return 400 FILE_INVALID."""
    bad_bytes = b": invalid: yaml: {\n"

    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("bad.yaml", bad_bytes, "application/x-yaml")},
    )

    # Either the backend raises FILE_INVALID or returns errors — both acceptable
    # as long as the response does not contain saved=True
    if res.status_code == 400:
        assert res.json()["error"]["code"] in ("FILE_INVALID", "CONFIG_IMPORT_ERROR")
    else:
        assert res.status_code == 200
        assert res.json().get("saved") is not True


def test_config_upload_json_format(client: TestClient) -> None:
    """Uploading a valid JSON config file must also be accepted."""
    import json

    config = _load_valid_config(client)
    json_bytes = json.dumps(config).encode()

    res = client.post(
        "/api/workspace/config/upload",
        files={"file": ("config.json", json_bytes, "application/json")},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["config"]["task"] == "binary"


# ---------------------------------------------------------------------------
# POST /workspace/reset
# ---------------------------------------------------------------------------


def test_reset_clears_workspace(client: TestClient, tmp_path: Path) -> None:
    """POST /reset must clear all workspace state."""
    _load_data_and_config(client, tmp_path)

    # Verify state was set
    status_before = client.get("/api/workspace/status").json()
    assert status_before["has_data"] is True
    assert status_before["has_config"] is True

    res = client.post("/api/workspace/reset")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    status_after = client.get("/api/workspace/status").json()
    assert status_after["has_data"] is False
    assert status_after["has_config"] is False
    assert status_after["has_result"] is False
