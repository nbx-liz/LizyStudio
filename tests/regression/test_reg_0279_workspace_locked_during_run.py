"""Regression (#279, P-0089): config writes are 409 while a job is running.

Before the fix, ``PUT /api/workspace/config`` and
``PATCH /api/workspace/config`` accepted writes mid-run, so cross-hook
competing writes from the workspace UI (CV strategy radio, Folds
NumberInput, target/task RadioGroup) could land between fit/tune
start and completion. The job's ``meta.json`` and checkpoint were
created against the *original* config, so the late mutation produced
a workspace whose surface no longer matched what was actually fit.

The lock is held only by ``JobStore.active_job_id``; once the job
transitions to a terminal status (``completed`` / ``failed`` /
``cancelled``) and the runner's finally block calls
``release_active``, the next config write succeeds.

Invariants pinned by this regression:

- INV-1 (PUT): ``PUT /api/workspace/config`` returns 409
  ``WORKSPACE_LOCKED`` while a job is active.
- INV-2 (PATCH): ``PATCH /api/workspace/config`` returns 409
  ``WORKSPACE_LOCKED`` while a job is active.
- INV-3 (no-mutation): ``ws.config`` is unchanged after either
  rejected write.
- INV-4 (release): once the active slot is released the next
  ``PUT /api/workspace/config`` succeeds.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_csv(tmp_path: Path, name: str = "train.csv") -> str:
    csv_path = tmp_path / name
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(50):
            writer.writerow([i, 20 + i, i % 2])
    return str(csv_path)


def _load_data_and_config(client: TestClient, tmp_path: Path) -> dict[str, Any]:
    """Load CSV data and a valid config; return the config used."""
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": csv_path})
    assert r.status_code == 200, r.text

    res = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert res.status_code == 200, res.text
    config = res.json()

    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200 and r.json()["saved"] is True, r.text
    return config


def _seed_running_holder(job_store: Any) -> str:
    """Mirror ``tests.test_workspace_api._seed_running_holder``.

    Creates a real on-disk meta + claims the active slot. We cannot
    just call ``claim_active("dummy")`` because the stale-slot
    auto-reclaim path would notice the missing meta and treat the
    slot as reclaimable.
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


def test_put_config_returns_409_when_job_running(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """INV-1 + INV-3: PUT /config rejects with 409 and config stays unchanged."""
    config = _load_data_and_config(client, tmp_path)

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)
    try:
        # Mutate any field — strategy is a representative cross-hook write.
        mutated = {**config, "split": {**config["split"], "method": "kfold"}}
        res = client.put("/api/workspace/config", json=mutated)

        assert res.status_code == 409, res.text
        body = res.json()
        assert body["error"]["code"] == "WORKSPACE_LOCKED"
        assert body["error"]["details"]["job_id"] == holder_id

        # INV-3: ws.config must not have been mutated by the rejected write.
        current = client.get("/api/workspace/config").json()
        assert current["split"]["method"] == config["split"]["method"]
    finally:
        job_store.release_active(holder_id)


def test_patch_config_returns_409_when_job_running(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """INV-2 + INV-3: PATCH /config rejects with 409 and config stays unchanged."""
    config = _load_data_and_config(client, tmp_path)
    original_method = config["split"]["method"]

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)
    try:
        ops = {
            "ops": [
                {
                    "op": "replace",
                    "path": "/split/method",
                    "value": "kfold",
                }
            ]
        }
        res = client.patch("/api/workspace/config", json=ops)

        assert res.status_code == 409, res.text
        body = res.json()
        assert body["error"]["code"] == "WORKSPACE_LOCKED"

        current = client.get("/api/workspace/config").json()
        assert current["split"]["method"] == original_method
    finally:
        job_store.release_active(holder_id)


def test_put_config_succeeds_after_slot_release(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """INV-4: once the active slot is released, PUT /config works again."""
    config = _load_data_and_config(client, tmp_path)

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)
    # Confirm the lock is engaged.
    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 409

    # Release the slot the way a normal runner finally-block would.
    job_store.release_active(holder_id)

    res = client.put("/api/workspace/config", json=config)
    assert res.status_code == 200, res.text
    assert res.json()["saved"] is True


def test_put_config_succeeds_when_holder_is_terminal_but_slot_not_yet_released(
    client: TestClient,
    tmp_path: Path,
) -> None:
    """INV-5 (race carve-out): a terminal-status holder must not lock /config.

    There is a real race window where a job's on-disk status has
    transitioned to ``completed`` / ``failed`` / ``cancelled`` but the
    runner's ``finally`` block has not yet called
    ``release_active``. The post-fit re-fit flow (Playwright
    ``jobs-refit.spec.ts``) hits this window every time:
    ``waitForJobDone`` returns the moment status flips, then
    immediately PUTs the next config. Without the terminal-status
    carve-out the PUT loses to a microsecond-scale race against the
    runner finally and 409s spuriously.
    """
    config = _load_data_and_config(client, tmp_path)

    job_store = client.app.state.job_store  # type: ignore[union-attr]
    holder_id = _seed_running_holder(job_store)

    for terminal_status in ("completed", "failed", "cancelled"):
        holder_job = job_store.get(holder_id)
        assert holder_job is not None
        holder_job.status = terminal_status  # type: ignore[assignment]
        job_store.update(holder_job)
        # Slot is still held by holder_id at this point — runner finally
        # has not run yet. The endpoint must still accept the write.
        res = client.put("/api/workspace/config", json=config)
        assert res.status_code == 200, (
            f"PUT /config returned {res.status_code} while holder is "
            f"{terminal_status} (slot not yet released): {res.text}"
        )
        assert res.json()["saved"] is True

    # Cleanup so the next test starts clean.
    job_store.release_active(holder_id)
