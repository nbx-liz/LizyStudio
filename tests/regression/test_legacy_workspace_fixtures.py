"""Captured-fixture migration tests (P-0103 v3-25b / R-4.1).

The matrix in ``test_format_version_migration_matrix.py`` exercises
the read/write helpers on **runtime-generated** fixtures inside
``tmp_path``. This file complements that suite by loading
**committed-to-disk** fixtures from
``tests/fixtures/legacy_workspaces/`` so:

1. We pin the wire format that real customer workspaces have on disk,
   not just the format that the test thinks the runtime emits.
2. A future refactor of ``write_versioned_json`` cannot silently
   shift the on-disk representation — the fixture in repo would
   diverge from the writer's output, surfacing the change.
3. CI gates the contract by running this test on every PR
   (P-0103 R-4.1 acceptance criterion).

If a future schema change legitimately re-shapes the on-disk JSON,
update the matching ``tests/fixtures/legacy_workspaces/v<N>/*.json``
in the same PR. The migration code, the writer, and the captured
fixtures must move together.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from lizystudio.storage.versions import (
    STUDIO_FORMAT_VERSION,
    read_versioned_json,
    write_versioned_json,
)

FIXTURES_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "legacy_workspaces"


def _versions_with_fixtures() -> list[int]:
    """Discover every ``v<N>`` directory under fixtures/legacy_workspaces.

    Parametrising on the directory listing means a future bump that
    adds a new captured fixture (e.g. ``v3/``) is exercised
    automatically — no test code change required.
    """
    versions: list[int] = []
    for child in sorted(FIXTURES_ROOT.iterdir()):
        if not child.is_dir():
            continue
        name = child.name
        if not name.startswith("v"):
            continue
        try:
            versions.append(int(name[1:]))
        except ValueError:
            continue
    return versions


VERSIONS = _versions_with_fixtures()


def test_fixtures_dir_covers_every_known_version() -> None:
    """Every version up to STUDIO_FORMAT_VERSION must have a fixture.

    Drift-proof: if a developer bumps ``STUDIO_FORMAT_VERSION``
    without adding a captured fixture, the next CI run fails here
    BEFORE any customer with a v_old workspace hits the runtime.
    """
    for v in range(STUDIO_FORMAT_VERSION + 1):
        assert v in VERSIONS, (
            f"Missing tests/fixtures/legacy_workspaces/v{v}/ — every "
            f"historical format_version up to STUDIO_FORMAT_VERSION="
            f"{STUDIO_FORMAT_VERSION} must have committed fixtures."
        )


@pytest.mark.parametrize("version", VERSIONS)
@pytest.mark.parametrize("artefact", ["meta.json", "fit_result.json"])
def test_legacy_fixture_loads_and_round_trips(
    tmp_path: Path,
    version: int,
    artefact: str,
) -> None:
    """v_N fixture → read → migrate → write at current → read → identical.

    The fixture itself is read-only in the repo. We copy it to
    ``tmp_path`` first so the writer side of the round-trip operates
    in scratch space and cannot pollute the committed fixture.
    """
    fixture = FIXTURES_ROOT / f"v{version}" / artefact
    assert fixture.exists(), f"Missing fixture: {fixture}"

    # Copy fixture into a writable scratch location.
    legacy_path = tmp_path / artefact
    shutil.copy(fixture, legacy_path)

    # Read 1: triggers the migration chain v_N → STUDIO_FORMAT_VERSION.
    detected, migrated = read_versioned_json(legacy_path)
    assert detected == version, (
        f"Fixture {fixture} declares the wrong format_version: "
        f"detected={detected} but the directory says v{version}"
    )

    # Write back through the canonical helper.
    upgraded_path = tmp_path / f"upgraded_{artefact}"
    write_versioned_json(upgraded_path, migrated)

    # Read 2: must return the same domain payload + bumped version.
    detected_after, payload_after = read_versioned_json(upgraded_path)
    assert detected_after == STUDIO_FORMAT_VERSION
    assert payload_after == migrated, (
        f"Round-trip on captured fixture v{version}/{artefact} was "
        "not idempotent — a migration or the writer mutated the payload."
    )


@pytest.mark.parametrize("version", VERSIONS)
def test_legacy_meta_preserves_required_keys(version: int) -> None:
    """Every meta.json fixture surfaces the canonical Job meta keys.

    Pins the JobStore-meta contract so a future migration cannot drop
    fields that ``services.jobs.JobStore._read_meta`` depends on. If
    the contract genuinely evolves, update ``REQUIRED_META_KEYS``
    AND the associated migration in the same PR.
    """
    fixture = FIXTURES_ROOT / f"v{version}" / "meta.json"
    _, payload = read_versioned_json(fixture)

    required_meta_keys = {
        "job_id",
        "job_type",
        "status",
        "started_at",
        "completed_at",
        "error",
        "parent_job_id",
    }
    missing = required_meta_keys - payload.keys()
    assert not missing, (
        f"v{version} meta.json fixture is missing required keys: "
        f"{sorted(missing)}. Update the migration AND the fixture."
    )


def test_v0_fixture_has_no_format_version_key() -> None:
    """v0 fixtures must reproduce the pre-C-9 layout exactly.

    A v0 fixture with a ``format_version`` key sneaking in would
    silently down-rate the migration coverage to "always >=v1" and
    let a v0→v1 regression go undetected.
    """
    fixture = FIXTURES_ROOT / "v0" / "meta.json"
    raw = json.loads(fixture.read_text(encoding="utf-8"))
    assert "format_version" not in raw, (
        "v0 fixture must NOT contain the format_version key — the "
        "whole point of v0 is its absence."
    )


@pytest.mark.parametrize("version", [v for v in VERSIONS if v >= 1])
def test_v1plus_fixture_declares_correct_format_version(version: int) -> None:
    """v1+ fixtures must declare the matching ``format_version`` value.

    Catches a copy-paste error where a developer forgets to update
    the version field after duplicating a fixture from another
    directory.
    """
    fixture = FIXTURES_ROOT / f"v{version}" / "meta.json"
    raw = json.loads(fixture.read_text(encoding="utf-8"))
    assert raw.get("format_version") == version, (
        f"v{version} fixture declares format_version="
        f"{raw.get('format_version')} but the directory says v{version}."
    )
