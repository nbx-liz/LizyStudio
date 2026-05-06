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

    def test_current_version_round_trip(self, tmp_path: Path) -> None:
        """A workspace written at the current version is read back at the same version.

        Drift-proof: this test does NOT pin a specific format version,
        so a future bump (vN -> vN+1) only requires updating
        :data:`STUDIO_FORMAT_VERSION` and adding the migration. The
        invariant is "writer + reader agree on the current version".
        """
        from lizystudio.storage.versions import (
            STUDIO_FORMAT_VERSION,
            read_versioned_json,
            write_versioned_json,
        )

        path = tmp_path / "meta.json"
        payload = {"job_id": "j1", "status": "completed"}
        write_versioned_json(path, payload)

        detected, data = read_versioned_json(path)

        assert detected == STUDIO_FORMAT_VERSION
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

    def test_v1_to_v2_is_identity(self) -> None:
        """v1 -> v2 (P-0099 v3-20a) is a byte-identity migration.

        v1 artefacts on disk cannot contain ``status="paused"`` because
        no v1 LizyStudio runtime ever wrote it; the bump exists solely
        so a future runtime that drops or reshapes ``paused`` can
        detect the v2 artefact via ``format_version`` and refuse to
        load it.
        """
        from lizystudio.storage.migrations import MIGRATIONS

        assert 1 in MIGRATIONS
        original = {
            "job_id": "j1",
            "status": "completed",
            "config": {"foo": "bar"},
        }
        migrated = MIGRATIONS[1](dict(original))
        assert migrated == original

    def test_v0_to_current_chain_traverses_every_known_version(self) -> None:
        """The chain must reach the current version by stepping through every bump."""
        from lizystudio.storage.migrations import MIGRATIONS, migrate_to_current
        from lizystudio.storage.versions import STUDIO_FORMAT_VERSION

        # Every version from 0 up to (current - 1) must have a
        # registered migration.
        for v in range(STUDIO_FORMAT_VERSION):
            assert v in MIGRATIONS, (
                f"v{v} -> v{v + 1} migration missing from MIGRATIONS table; "
                f"STUDIO_FORMAT_VERSION is {STUDIO_FORMAT_VERSION}"
            )

        # The chain reaches the current version without raising.
        data = {"job_id": "j1", "status": "completed"}
        migrated = migrate_to_current(dict(data), from_version=0)
        assert migrated["job_id"] == "j1"
        # Identity through both v0 -> v1 and v1 -> v2.
        assert migrated["status"] == "completed"

    def test_paused_status_round_trips_at_v2(self, tmp_path: Path) -> None:
        """A v2 meta.json with ``status="paused"`` round-trips losslessly.

        Pin for P-0099 v3-20a: the ``paused`` literal travels through
        the storage layer without being normalised, replaced, or
        rejected. The actual write side is exercised in v3-20c when
        ``_run_job_core`` learns to emit ``status="paused"``; this
        test only proves the storage round-trip is friendly to it.
        """
        from lizystudio.storage.versions import (
            read_versioned_json,
            write_versioned_json,
        )

        path = tmp_path / "meta.json"
        payload = {
            "job_id": "j-paused",
            "status": "paused",
            "job_type": "tune",
        }
        write_versioned_json(path, payload)

        detected, data = read_versioned_json(path)
        assert detected >= 2
        assert data["status"] == "paused"
        assert data["job_id"] == "j-paused"

    def test_migrate_covers_v0_to_current(self) -> None:
        """``migrate_to_current`` walks the chain from any known older version.

        Drift-proof: this test does NOT pin a specific
        :data:`STUDIO_FORMAT_VERSION`. The invariant is "the chain
        reaches the current version without raising", which the
        registered MIGRATIONS table must satisfy at every bump.
        """
        from lizystudio.storage.migrations import migrate_to_current
        from lizystudio.storage.versions import STUDIO_FORMAT_VERSION

        data = {"job_id": "j1"}
        migrated = migrate_to_current(data, from_version=0)

        # The return type contract is the migrated payload dict; callers
        # should rely on the file's format_version key, not on a
        # version field being injected into the returned dict.
        assert migrated["job_id"] == "j1"
        # The chain must reach STUDIO_FORMAT_VERSION at any version
        # bump. The previous form pinned this to 1 and broke each time
        # the constant moved; the assertion below is an invariant
        # statement instead of a value pin.
        assert STUDIO_FORMAT_VERSION >= 1

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


class TestWriteAtomicity:
    """H-0082 INV-1: concurrent readers never observe a partial state.

    ``write_versioned_json`` must expose either the prior payload or the
    next payload to concurrent readers — never an empty or truncated
    intermediate. Historically ``Path.write_text`` was used directly,
    which truncates-then-writes non-atomically and leaves a window
    during which readers observe ``JSONDecodeError`` (Issue #232).
    """

    def test_write_versioned_json_is_atomic_under_concurrent_readers(
        self, tmp_path: Path
    ) -> None:
        """Writer×1 + Reader×4 at 500 rounds must see no JSONDecodeError."""
        import threading

        from lizystudio.storage.versions import (
            read_versioned_json,
            write_versioned_json,
        )

        path = tmp_path / "meta.json"
        write_versioned_json(path, {"status": "pending", "payload": "x" * 2048})

        errors: list[str] = []
        payloads: set[str] = set()
        err_lock = threading.Lock()
        stop = threading.Event()
        rounds = 500

        def reader(idx: int) -> None:
            while not stop.is_set():
                try:
                    _, data = read_versioned_json(path)
                except json.JSONDecodeError as exc:
                    with err_lock:
                        errors.append(f"reader{idx}: {exc}")
                    continue
                # INV-1: readers only see a complete, well-formed payload.
                status = data.get("status")
                with err_lock:
                    payloads.add(str(status))

        def writer() -> None:
            for i in range(rounds):
                write_versioned_json(
                    path,
                    {
                        "status": "running" if i % 2 else "completed",
                        "payload": "x" * 2048,
                    },
                )

        readers = [threading.Thread(target=reader, args=(i,)) for i in range(4)]
        for t in readers:
            t.start()
        w = threading.Thread(target=writer)
        w.start()
        w.join()
        stop.set()
        for t in readers:
            t.join(timeout=5)

        assert errors == [], (
            f"INV-1 violated — {len(errors)} partial reads observed. "
            f"write_versioned_json must use atomic rename. "
            f"sample: {errors[:3]}"
        )
        # Payload values must come from the writer's enumeration only.
        assert payloads <= {"pending", "running", "completed"}, payloads

    def test_write_versioned_json_leaves_no_tmp_file(self, tmp_path: Path) -> None:
        """After a successful write the tmp file must not linger."""
        from lizystudio.storage.versions import write_versioned_json

        path = tmp_path / "meta.json"
        write_versioned_json(path, {"status": "ok"})

        siblings = list(tmp_path.iterdir())
        assert [s.name for s in siblings] == ["meta.json"], (
            f"tmp file leaked: {[s.name for s in siblings]}"
        )


class TestMigrationChainGap:
    """H-0082 INV-2: ``migrate_to_current`` raises when the chain has a gap.

    Issue #239: when a developer bumps ``STUDIO_FORMAT_VERSION`` without
    registering the corresponding migration function, the system must
    fail loudly rather than silently returning partial state.
    """

    def test_migrate_to_current_raises_when_chain_has_gap(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Gap at version N → RuntimeError naming the missing migration."""
        from lizystudio.storage import migrations
        from lizystudio.storage import versions as versions_module

        # Simulate a v3 runtime that only has v0 → v1 registered. The
        # developer forgot v1 → v2 and v2 → v3. Any load from v0 must
        # stop at the first gap with an explicit RuntimeError.
        monkeypatch.setattr(versions_module, "STUDIO_FORMAT_VERSION", 3)
        monkeypatch.setattr(migrations, "STUDIO_FORMAT_VERSION", 3)
        monkeypatch.setattr(migrations, "MIGRATIONS", {0: lambda d: d}, raising=True)

        with pytest.raises(RuntimeError, match="No migration registered for version 1"):
            migrations.migrate_to_current({"job_id": "j1"}, from_version=0)
