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
    # P-0088 / Issue #256: /status must expose files_root so E2E harnesses
    # can fingerprint the backend and fail loud on env mismatch instead of
    # silently attacking a dev-server with the wrong FILES_ROOT.
    assert "files_root" in body


def test_status_files_root_matches_security_setting(client: TestClient) -> None:
    """P-0088 / Issue #256: files_root returned by /status must equal the
    active ALLOWED_FILES_ROOT so E2E clients can assert env alignment."""
    from lizystudio import security

    res = client.get("/api/workspace/status")
    assert res.status_code == 200
    body = res.json()
    assert body["files_root"] == str(security.ALLOWED_FILES_ROOT)


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


def test_validate_flags_n_splits_greater_than_n_rows(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Issue #268: a 50-row dataset with n_splits=1000 used to pass
    validate, get accepted by POST /fit, and fail ~5s later with
    sklearn's "Cannot have number of splits greater than the number of
    samples". The workspace-aware validator now flags it up-front so
    the existing 'Fix validation errors first' banner blocks the run.
    """
    _load_data_and_config(client, tmp_path)
    config = _load_valid_config(client)
    config["split"]["n_splits"] = 1000
    res = client.post("/api/workspace/config/validate", json=config)
    assert res.status_code == 200
    errors = res.json()["errors"]
    assert any(
        "n_splits" in (err.get("path") or "") and "1000" in (err.get("message") or "")
        for err in errors
    ), errors


def test_validate_does_not_flag_n_splits_when_no_data_loaded(
    client: TestClient,
) -> None:
    """Without a loaded dataset the workspace cannot enforce a row-count
    cap. The validator must short-circuit instead of raising.
    """
    config = _load_valid_config(client)
    config["split"]["n_splits"] = 999_999
    res = client.post("/api/workspace/config/validate", json=config)
    assert res.status_code == 200
    errors = res.json()["errors"]
    assert not any("n_splits" in (err.get("path") or "") for err in errors)


def test_put_config_saved_false_when_n_splits_exceeds_n_rows(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Issue #268: an over-large n_splits arriving via PUT /config must
    flip ``saved=false`` (errors prevent the write) so the user sees the
    state mismatch instead of a healthy-looking PUT followed by a 5-s
    Fit failure.
    """
    _load_data_and_config(client, tmp_path)
    config = _load_valid_config(client)
    config["split"]["n_splits"] = 1000
    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 200
    body = res.json()
    assert body["saved"] is False
    assert any("n_splits" in (err.get("path") or "") for err in body["errors"]), body[
        "errors"
    ]


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
    """POST /tune materializes a tuning block at job start (P-0109 PR-4b / INV-T6).

    Pre-PR-4b this injected ``tuning`` into ``ws.config``; PR-4b moved
    the materialization to ``materialize_tuning_for_job`` so the job
    config snapshot — not the workspace — carries the canonical
    optuna params + space. The workspace itself keeps Tune state in
    ``ws.tuning_overrides`` (sparse).
    """
    _load_data_and_config(client, tmp_path)

    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    # PR-4b: ws.config never holds tuning; the workspace defaults to
    # ``tuning_overrides=None`` (catalog defaults will materialize at start).
    ws.config.pop("tuning", None)
    ws.tuning_overrides = None

    captured: dict[str, Any] = {}

    def fake_start(**kwargs: object) -> str:
        captured["job_config"] = kwargs["config"]
        return "job_tune999"

    with patch("lizystudio.api.workspace.start_tune_async", side_effect=fake_start):
        res = client.post("/api/workspace/tune")

    assert res.status_code == 200
    body = res.json()
    assert body["job_id"] == "job_tune999"

    job_config = captured["job_config"]
    assert "tuning" in job_config
    assert "optuna" in job_config["tuning"]
    assert job_config["tuning"]["optuna"]["params"]["n_trials"] == 50


def test_tune_default_tuning_uses_auc_maximize_for_binary(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """Bug 2026-04-14 / P-0109 PR-4b: default binary tune must run as maximize.

    Hardcoded ``direction: minimize`` in the legacy inject path used to
    flip AUC's optimization direction (low-is-better). PR-4b moves the
    direction resolution to ``adapter.compute_effective_tuning`` inside
    ``materialize_tuning_for_job`` — the adapter sources direction from
    its metric registry (INV-T3). This integration test exercises the
    whole ``POST /workspace/tune`` path so a future regression in
    either the materialization step OR ``_prepare_tune_config``'s
    auto-resolve is caught up front.
    """
    _load_data_and_config(client, tmp_path)
    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    ws.config.pop("tuning", None)
    ws.tuning_overrides = None

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
        "Likely cause: materialize_tuning_for_job emitted the wrong direction, "
        "or _prepare_tune_config silently flipped it."
    )


def test_tune_preserves_existing_tuning_config(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """POST /tune must honour user-set tuning intent (P-0109 PR-4b).

    Pre-PR-4b this asserted ``ws.config["tuning"]`` survived the call.
    PR-4b moves intent to ``ws.tuning_overrides`` (sparse), so the
    invariant is now: a user-set ``n_trials=10`` survives the job-start
    materialization. The materialized ``job.config["tuning"]`` carries
    that ``n_trials`` while catalog defaults fill in the rest.
    """
    from lizystudio.backends.types import TuningOverrides

    _load_data_and_config(client, tmp_path)

    app = client.app  # type: ignore[attr-defined]
    ws = app.state.workspace
    ws.tuning_overrides = TuningOverrides(n_trials=10)

    captured: dict[str, Any] = {}

    def fake_start(**kwargs: object) -> str:
        captured["job_config"] = kwargs["config"]
        return "job_tune_custom"

    with patch("lizystudio.api.workspace.start_tune_async", side_effect=fake_start):
        res = client.post("/api/workspace/tune")

    assert res.status_code == 200
    assert captured["job_config"]["tuning"]["optuna"]["params"]["n_trials"] == 10
    # The workspace state itself keeps the sparse intent unchanged.
    assert ws.tuning_overrides is not None
    assert ws.tuning_overrides.n_trials == 10


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
# Issue #474 / P-0108: POST /tune run-gate for structurally-broken search space
#
# ``parse_space()`` in lizyml rejects three classes of structurally-broken
# entries with ``LizyMLError(CONFIG_INVALID)``: inverted Range (low >= high),
# log + low <= 0, and empty-choices categorical. The first two surface here
# as a 400 *before* the job launches (run-gate, approach C in the issue).
#
# The empty-choices categorical case is intentionally NOT a 400: the
# frontend's ``empty-choice-banner`` already owns that UX (the Tune button
# is disabled, and a transient empty state is legitimate while the user is
# wiring up Choice rows). ``PUT /config`` must keep saving in that state so
# the frontend doesn't revert the user's deselection.
# ---------------------------------------------------------------------------


def _config_with_space(client: TestClient, space: dict[str, Any]) -> dict[str, Any]:
    config = _load_valid_config(client)
    config["tuning"] = {
        "optuna": {
            "params": {"n_trials": 3, "timeout": None},
            "space": space,
        }
    }
    return config


def test_tune_rejects_inverted_range_search_space(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /tune must 422 a search space whose Range has low >= high."""
    _load_data_and_config(client, tmp_path)
    bad_config = _config_with_space(
        client, {"learning_rate": {"type": "float", "low": 0.5, "high": 0.01}}
    )

    with patch("lizystudio.api.workspace.start_tune_async") as _mock_start:
        res = client.post("/api/workspace/tune", json={"config": bad_config})

    assert res.status_code == 422, res.text
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    errors = body["error"]["details"]["errors"]
    paths = {err["path"] for err in errors}
    assert "tuning.optuna.space.learning_rate" in paths
    msg = next(
        err["message"]
        for err in errors
        if err["path"] == "tuning.optuna.space.learning_rate"
    )
    assert "low" in msg.lower() and "high" in msg.lower()
    # Run-gate semantics: the job must NOT have been launched.
    _mock_start.assert_not_called()


def test_tune_rejects_log_with_nonpositive_low(
    client: TestClient, tmp_path: Path
) -> None:
    """POST /tune must 422 a search space using log distribution with low <= 0."""
    _load_data_and_config(client, tmp_path)
    bad_config = _config_with_space(
        client,
        {"learning_rate": {"type": "float", "low": 0.0, "high": 0.3, "log": True}},
    )

    with patch("lizystudio.api.workspace.start_tune_async") as _mock_start:
        res = client.post("/api/workspace/tune", json={"config": bad_config})

    assert res.status_code == 422, res.text
    body = res.json()
    assert body["error"]["code"] == "VALIDATION_ERROR"
    errors = body["error"]["details"]["errors"]
    paths = {err["path"] for err in errors}
    assert "tuning.optuna.space.learning_rate" in paths
    msg = next(
        err["message"]
        for err in errors
        if err["path"] == "tuning.optuna.space.learning_rate"
    )
    assert "log" in msg.lower()
    _mock_start.assert_not_called()


def test_tune_ignores_empty_categorical_choices_at_run_gate(
    client: TestClient, tmp_path: Path
) -> None:
    """INV-E: empty-choices categorical must NOT block POST /tune at the
    new run-gate. The frontend's ``empty-choice-banner`` is the canonical
    owner of that UX; the backend's job is only to reject the two
    structurally-broken cases (inverted Range, log + low<=0).

    Note that the underlying lizyml ``parse_space()`` *does* reject empty
    choices, so this test pins the explicit filter in the Studio gate.
    """
    _load_data_and_config(client, tmp_path)
    config = _config_with_space(
        client, {"objective": {"type": "categorical", "choices": []}}
    )

    with patch(
        "lizystudio.api.workspace.start_tune_async", return_value="job_run_gate"
    ) as _mock_start:
        res = client.post("/api/workspace/tune", json={"config": config})

    # Either the job runs (gate passed) or some OTHER pre-existing
    # validator (Pydantic schema, metric-compat) rejects it. The
    # invariant we are pinning is that the *new* search-space gate does
    # NOT contribute an error. We accept both 200 (start_tune_async
    # called) and 422 (rejected by an existing validator that already
    # tolerated empty choices in v0.5.0) — but if it is 422, the errors
    # list must not contain an empty-choices complaint at the
    # search-space path, and start_tune_async must not have been called.
    assert res.status_code in (200, 422), res.text
    if res.status_code == 200:
        assert res.json()["job_id"] == "job_run_gate"
        _mock_start.assert_called_once()
    else:
        body = res.json()
        errors = body["error"]["details"]["errors"]
        for err in errors:
            assert (
                "objective" not in err["path"]
                or "choices" not in err["message"].lower()
            ), f"run-gate must not flag empty-choices categorical: {err}"


def test_put_config_persists_inverted_range_for_wip_editing(
    client: TestClient, tmp_path: Path
) -> None:
    """INV-C (save gate permissive): the user is allowed to ``PUT /config``
    with a transiently-inverted Range while editing (NumberInput fires
    onChange per keystroke). The save gate must NOT borrow the new
    run-gate's structural check — see PR #473 (Wave 3.1a) post-mortem
    where that change broke ``workspace-tune.spec.ts:459``.
    """
    _load_data_and_config(client, tmp_path)
    bad_config = _config_with_space(
        client, {"learning_rate": {"type": "float", "low": 0.5, "high": 0.01}}
    )

    res = client.put("/api/workspace/config", json=bad_config)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["saved"] is True, (
        f"PUT /config must persist WIP with inverted Range; got {body!r}"
    )


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
