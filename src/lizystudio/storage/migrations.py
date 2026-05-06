"""Migration pipeline for on-disk JSON artefacts (C-9 / H-0081).

Each entry in :data:`MIGRATIONS` maps an origin version ``N`` to a
pure function that transforms a dict written at version ``N`` into the
shape expected by version ``N + 1``. :func:`migrate_to_current` walks
the chain from the detected source version up to the runtime's
:data:`~lizystudio.storage.versions.STUDIO_FORMAT_VERSION`.

Phase 1 (H-0081 implementation) ships with a single entry: ``v0 → v1``
is the identity mapping because the dict shape is unchanged. Future
structural changes (e.g. ``config`` key rename, ``data_ref.shape``
format flip) add a new entry here and bump
``STUDIO_FORMAT_VERSION``; the reader automatically chains them.

Migrations MUST be pure: no I/O, no global state, no side effects.
This is what lets them be unit-tested directly on hand-built dicts
without spinning up a workspace.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from lizystudio.storage.versions import STUDIO_FORMAT_VERSION

Migration = Callable[[dict[str, Any]], dict[str, Any]]


def _migrate_v0_to_v1(data: dict[str, Any]) -> dict[str, Any]:
    """Identity migration (v0 -> v1).

    The v0 (pre-C-9) and v1 (post-C-9) shapes are byte-identical aside
    from the ``format_version`` key itself.
    """
    return data


def _migrate_v1_to_v2(data: dict[str, Any]) -> dict[str, Any]:
    """Identity migration (v1 -> v2, P-0099 v3-20a).

    The v1 -> v2 bump only widens the ``Job.status`` Literal with the
    new ``"paused"`` value introduced for R-1.4 (Tune long-run
    resumability, Issue #360). v1 artefacts on disk cannot contain
    ``"paused"`` because no v1 LizyStudio runtime ever wrote it, so
    the schema-shape transform is a no-op identity migration.

    The bump exists for one reason: it lets a future LizyStudio
    runtime that wants to drop or re-shape ``paused`` (e.g. a v3
    redesign that splits Tune state across multiple files) detect a
    v2 artefact via the ``format_version`` key and refuse to load it
    with :class:`IncompatibleFormatVersionError`. Without the bump,
    such a future runtime would silently mis-interpret a v2
    ``status="paused"`` payload.
    """
    return data


MIGRATIONS: dict[int, Migration] = {
    0: _migrate_v0_to_v1,
    1: _migrate_v1_to_v2,
}


def migrate_to_current(
    data: dict[str, Any],
    *,
    from_version: int,
) -> dict[str, Any]:
    """Run ``data`` through the migration chain from ``from_version``.

    Walks ``MIGRATIONS[from_version]``, ``MIGRATIONS[from_version + 1]``,
    ... up to (but not including)
    :data:`~lizystudio.storage.versions.STUDIO_FORMAT_VERSION`. If
    ``from_version`` already equals the current version, returns the
    dict unchanged.
    """
    current = data
    version = from_version
    while version < STUDIO_FORMAT_VERSION:
        migrate = MIGRATIONS.get(version)
        if migrate is None:
            # Gap in the chain — treat as non-migratable so the gap is
            # caught by tests rather than silently loading partial state.
            msg = (
                f"No migration registered for version {version} → "
                f"{version + 1}; update MIGRATIONS in "
                "lizystudio.storage.migrations."
            )
            raise RuntimeError(msg)
        current = migrate(current)
        version += 1
    return current
