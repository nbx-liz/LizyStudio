"""Tests for the Studio-wide JSON format_version layer (C-9 / H-0081).

The storage layer embeds ``format_version`` into persisted JSON files
so future structural changes can migrate old workspaces rather than
silently breaking them. Existing workspaces without the key load as
v0 (identity migration); unknown versions raise an explicit error.

Coverage:

- v0 backward compat (missing ``format_version`` key)
- v1 round-trip (write / read / value preserved)
- Unknown version rejection (explicit exception)
- Migration pipeline purity (direct function call on dicts)
- Writer always emits the current ``STUDIO_FORMAT_VERSION``
- ``format_version`` appears as the first key for grep-friendliness
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest


def _write_raw_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


class TestReadVersionedJson:
    """``read_versioned_json`` tuple contract: (detected_version, data)."""

    def test_missing_format_version_is_treated_as_v0(self, tmp_path: Path) -> None:
        """Existing workspaces have no version key — load as v0."""
        from lizystudio.storage.versions import read_versioned_json

        path = tmp_path / "meta.json"
        _write_raw_json(path, {"job_id": "j1", "status": "completed"})

        detected, data = read_versioned_json(path)

        assert detected == 0
        # v0 → v1 identity migration preserves the original payload.
        assert data["job_id"] == "j1"
        assert data["status"] == "completed"

    def test_v1_round_trip(self, tmp_path: Path) -> None:
        """A workspace written at v1 is read back at v1 with identical content."""
        from lizystudio.storage.versions import (
            STUDIO_FORMAT_VERSION,
            read_versioned_json,
            write_versioned_json,
        )

        path = tmp_path / "meta.json"
        payload = {"job_id": "j1", "status": "completed"}
        write_versioned_json(path, payload)

        detected, data = read_versioned_json(path)

        assert detected == 1
        assert STUDIO_FORMAT_VERSION == 1
        assert data["job_id"] == "j1"
        # The version sentinel should NOT leak back to the caller — the
        # returned dict is the domain payload only.
        assert "format_version" not in data

    def test_unknown_version_raises_incompatible_error(self, tmp_path: Path) -> None:
        """A future version the current runtime does not know → explicit error."""
        from lizystudio.backends.exceptions import (
            IncompatibleFormatVersionError,
        )
        from lizystudio.storage.versions import read_versioned_json

        path = tmp_path / "meta.json"
        _write_raw_json(path, {"format_version": 99, "job_id": "j1"})

        with pytest.raises(IncompatibleFormatVersionError) as exc_info:
            read_versioned_json(path)

        # Error message carries the actual version so users / logs can
        # identify which workspace is too new for this runtime.
        assert "99" in str(exc_info.value)


class TestWriteVersionedJson:
    """``write_versioned_json`` embeds the current version; file stays valid JSON."""

    def test_writer_embeds_current_format_version(self, tmp_path: Path) -> None:
        from lizystudio.storage.versions import (
            STUDIO_FORMAT_VERSION,
            write_versioned_json,
        )

        path = tmp_path / "meta.json"
        write_versioned_json(path, {"job_id": "j1"})

        raw = json.loads(path.read_text(encoding="utf-8"))
        assert raw["format_version"] == STUDIO_FORMAT_VERSION

    def test_format_version_is_the_first_key(self, tmp_path: Path) -> None:
        """grep / human inspection friendliness: version at the top."""
        from lizystudio.storage.versions import write_versioned_json

        path = tmp_path / "meta.json"
        write_versioned_json(path, {"job_id": "j1", "status": "running"})

        # Use raw text so we inspect the on-disk order, not dict iteration.
        text = path.read_text(encoding="utf-8")
        # ``format_version`` should be the first JSON key (right after ``{``).
        assert text.startswith('{"format_version"'), (
            f"format_version is not the first key; got: {text[:80]}"
        )

    def test_writer_does_not_mutate_the_caller_payload(self, tmp_path: Path) -> None:
        """The helper must not add ``format_version`` to the caller's dict."""
        from lizystudio.storage.versions import write_versioned_json

        payload = {"job_id": "j1"}
        write_versioned_json(tmp_path / "meta.json", payload)
        assert "format_version" not in payload


class TestMigrationPipeline:
    """Migration chain is a pure-function dict[int, Callable]; direct-callable."""

    def test_v0_to_v1_is_identity_at_phase_1(self) -> None:
        """Until a real structural change lands, v0→v1 is a no-op."""
        from lizystudio.storage.migrations import MIGRATIONS

        assert 0 in MIGRATIONS
        original = {"job_id": "j1", "status": "completed"}
        migrated = MIGRATIONS[0](dict(original))
        assert migrated == original

    def test_migrate_covers_v0_to_current(self) -> None:
        """``migrate_to_current`` walks the chain from any known older version."""
        from lizystudio.storage.migrations import migrate_to_current
        from lizystudio.storage.versions import STUDIO_FORMAT_VERSION

        data = {"job_id": "j1"}
        migrated = migrate_to_current(data, from_version=0)

        # The return type contract is the migrated payload dict; callers
        # should rely on the file's format_version key, not on a
        # version field being injected into the returned dict.
        assert migrated["job_id"] == "j1"
        # STUDIO_FORMAT_VERSION is currently 1; the chain reaches it.
        assert STUDIO_FORMAT_VERSION == 1

    def test_migrations_are_pure_functions(self) -> None:
        """Each migration takes a dict and returns a new/mutated dict only.

        ``MIGRATIONS[0]`` must not do I/O, raise on normal input, or depend
        on global state — this is what enables unit-testing the chain
        without spinning up a workspace.
        """
        from lizystudio.storage.migrations import MIGRATIONS

        migrate = MIGRATIONS[0]
        sample = {"foo": 1, "bar": ["baz"]}
        result = migrate(dict(sample))
        assert isinstance(result, dict)
        assert result["foo"] == 1
        assert result["bar"] == ["baz"]
