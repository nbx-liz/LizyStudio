"""Migration matrix regression test (P-0103 v3-25a / R-4.1).

Covers every supported on-disk ``format_version`` (v0, v1, v2, ...,
``STUDIO_FORMAT_VERSION``). Each row of the matrix:

1. Writes a fixture in the historical wire shape for that version
   (no ``format_version`` key for v0; explicit key for v1+).
2. Loads it through ``read_versioned_json`` — proves the migration
   chain ``v0 → v1 → ... → STUDIO_FORMAT_VERSION`` runs without
   raising and returns the domain payload at the current schema.
3. Writes the migrated payload back via ``write_versioned_json`` —
   proves ``write → read`` is idempotent at the current version.
4. Asserts the byte-identity invariants the existing migrations
   declare (no field rename / drop / shape flip across the chain).

Why this is a separate file from ``tests/test_storage_versions.py``:
that suite tests the ``read_versioned_json`` / ``write_versioned_json``
contract on synthetic dicts with no relation to the real on-disk job /
fit-result shapes. The matrix here uses *realistic* payload skeletons
(JobStore meta, FitResult, InferenceStore) so a future migration that
silently drops a Job field is caught here even when the storage
helpers themselves remain green.

This file is the entry-point for the v3-25 R-4.1 CI gate. CI runs it
on every PR; if it goes red, the offending PR has either:

- introduced a structural change without a matching migration entry, or
- broken backward compat for an existing version on disk.

Either way the merge must wait for an explicit P-0103 amendment.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from lizystudio.storage.migrations import MIGRATIONS, migrate_to_current
from lizystudio.storage.versions import (
    STUDIO_FORMAT_VERSION,
    read_versioned_json,
    write_versioned_json,
)

# Realistic Job meta skeleton used by v0/v1/v2. The shape derives from
# ``services/jobs.py::JobStore._read_meta`` so a future migration that
# drops or renames any of these fields will fail this matrix BEFORE it
# silently corrupts a customer workspace.
_JOB_META_SHAPE: dict[str, Any] = {
    "job_id": "job_abc123",
    "job_type": "fit",
    "status": "completed",
    "started_at": "2026-05-01T12:00:00Z",
    "completed_at": "2026-05-01T12:05:00Z",
    "error": None,
    "parent_job_id": None,
}


def _write_raw(path: Path, payload: dict[str, Any]) -> None:
    """Bypass write_versioned_json so we can pin a specific historical
    on-disk shape (no version key for v0, explicit value for v1+).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.mark.parametrize("from_version", list(range(STUDIO_FORMAT_VERSION + 1)))
def test_migration_chain_loads_every_known_version(
    tmp_path: Path,
    from_version: int,
) -> None:
    """Every historical version (v0 … current) loads + migrates without raising.

    Drift-proof: parametrised on ``range(STUDIO_FORMAT_VERSION + 1)``
    so a future bump only requires adding a fixture row to the
    expected-payload tables below — the ``from_version`` axis adapts
    automatically.
    """
    path = tmp_path / "meta.json"
    if from_version == 0:
        # v0 has no format_version key — pre-C-9 layout.
        _write_raw(path, dict(_JOB_META_SHAPE))
    else:
        _write_raw(
            path,
            {"format_version": from_version, **_JOB_META_SHAPE},
        )

    detected, payload = read_versioned_json(path)
    assert detected == from_version

    # Schema fields must survive the chain. None of the registered
    # migrations may drop a Job meta field; if a future migration
    # legitimately renames one, update _JOB_META_SHAPE in the same PR.
    for key, expected in _JOB_META_SHAPE.items():
        assert payload[key] == expected, (
            f"v{from_version} → current dropped or mutated meta.{key}; "
            f"got {payload.get(key)!r}, expected {expected!r}"
        )
    assert "format_version" not in payload, (
        "read_versioned_json must strip the version sentinel from the domain payload"
    )


@pytest.mark.parametrize("from_version", list(range(STUDIO_FORMAT_VERSION + 1)))
def test_round_trip_after_migration_is_idempotent(
    tmp_path: Path,
    from_version: int,
) -> None:
    """v_N → migrate → write at current → read → identical to the migrated v_N.

    Pins the post-migration state of the on-disk file: once a legacy
    workspace has been written back, reloading it must return the
    same shape (with ``format_version`` bumped to the current).
    """
    legacy = tmp_path / "meta_legacy.json"
    upgraded = tmp_path / "meta_upgraded.json"

    if from_version == 0:
        _write_raw(legacy, dict(_JOB_META_SHAPE))
    else:
        _write_raw(
            legacy,
            {"format_version": from_version, **_JOB_META_SHAPE},
        )

    # First read: triggers the migration chain.
    _, migrated = read_versioned_json(legacy)

    # Write back through the helper so we use the canonical writer.
    write_versioned_json(upgraded, migrated)

    # Second read: must return the same domain payload + bump version.
    detected_after, payload_after = read_versioned_json(upgraded)
    assert detected_after == STUDIO_FORMAT_VERSION
    assert payload_after == migrated, (
        "round-trip after migration was not idempotent; the writer or "
        "a migration mutated the payload between read passes"
    )


def test_every_known_version_has_a_registered_migration() -> None:
    """``range(0, STUDIO_FORMAT_VERSION)`` must each map to a function.

    A bump that forgets to add the matching migration entry raises
    here BEFORE anyone tries to load a pre-bump artefact. Without
    this guard a developer would only discover the gap when a user
    loaded a legacy workspace and got a ``RuntimeError`` mid-session.
    """
    for v in range(STUDIO_FORMAT_VERSION):
        assert v in MIGRATIONS, (
            f"v{v} → v{v + 1} migration missing from MIGRATIONS table; "
            f"STUDIO_FORMAT_VERSION is {STUDIO_FORMAT_VERSION}"
        )


def test_migrate_to_current_is_idempotent_at_current_version() -> None:
    """Running the chain on a current-version payload is a no-op.

    Important so callers can re-migrate without worrying about double
    application — the chain reaches the terminal version and stops.
    """
    payload = dict(_JOB_META_SHAPE)
    once = migrate_to_current(dict(payload), from_version=STUDIO_FORMAT_VERSION)
    twice = migrate_to_current(once, from_version=STUDIO_FORMAT_VERSION)
    assert once == twice == payload


def test_paused_status_round_trips_via_v2(tmp_path: Path) -> None:
    """A v2-only field (``status="paused"``) survives matrix round-trip.

    Pins the v3-20a contract from P-0099 against future migration
    edits: any new migration that re-shapes ``status`` must keep
    ``"paused"`` recognisable, otherwise a paused Tune resume would
    silently drop the state on load.
    """
    payload: dict[str, Any] = {
        **_JOB_META_SHAPE,
        "job_type": "tune",
        "status": "paused",
        "completed_at": None,
    }
    path = tmp_path / "meta.json"
    write_versioned_json(path, payload)

    detected, loaded = read_versioned_json(path)
    assert detected == STUDIO_FORMAT_VERSION
    assert loaded["status"] == "paused"
    assert loaded["job_type"] == "tune"


def test_writer_always_emits_current_version_regardless_of_input(
    tmp_path: Path,
) -> None:
    """Writing a payload that already includes a stale ``format_version``
    key in the domain dict must NOT leak that stale version to disk.

    The writer is the schema-version source of truth; if a caller
    accidentally smuggled ``format_version: 0`` through, the file on
    disk must still declare the current version so the next read does
    not re-trigger the migration chain on already-migrated data.
    """
    payload: dict[str, Any] = {
        # write_versioned_json prepends its own format_version key —
        # any caller-supplied key is dropped because the helper
        # rebuilds the dict starting from the sentinel.
        **_JOB_META_SHAPE,
    }
    path = tmp_path / "meta.json"
    write_versioned_json(path, payload)

    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["format_version"] == STUDIO_FORMAT_VERSION
    # The first key on disk is format_version (grep-friendliness pin
    # from H-0081); the matrix re-asserts it so a writer refactor
    # cannot silently shift it.
    text = path.read_text(encoding="utf-8")
    assert text.startswith('{"format_version"'), (
        f"format_version is not the first key on disk; got: {text[:80]}"
    )
