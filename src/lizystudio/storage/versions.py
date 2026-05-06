"""Versioned JSON I/O for on-disk artefacts (C-9 / H-0081).

The Studio embeds ``format_version`` into persisted JSON files so
future structural changes can migrate old workspaces rather than
silently breaking them. The contract:

- Write path — :func:`write_versioned_json` prefixes the payload with
  ``format_version: STUDIO_FORMAT_VERSION`` as the first key so the
  file is grep-friendly and the value is visible to human inspection.
- Read path — :func:`read_versioned_json` tolerates missing keys
  (v0 backward compat, existing workspaces), runs the migration chain
  up to the current version, and raises
  :class:`~lizystudio.backends.exceptions.IncompatibleFormatVersionError`
  when the stored version is newer than this runtime knows.

``format_version`` is a Studio-wide single constant — file-per-file
versions were considered and rejected (H-0081 alternatives §b), because
the decision granularity ("which file can we structurally change
independently") is the same whether one or five constants hold the
value.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from lizystudio.backends.exceptions import IncompatibleFormatVersionError

STUDIO_FORMAT_VERSION: int = 1
"""Current on-disk JSON format version for Studio-owned artefacts.

Bump this when introducing a structural change to any of the JSON
artefacts that flow through :func:`write_versioned_json` /
:func:`read_versioned_json`, and add a migration function to
:data:`lizystudio.storage.migrations.MIGRATIONS` from the previous
version to this one.
"""

_FORMAT_VERSION_KEY = "format_version"


def write_versioned_json(path: Path, payload: dict[str, Any]) -> None:
    """Persist ``payload`` at ``path`` with the current format version.

    The on-disk JSON begins with ``"format_version"`` as the first key
    so a quick ``head`` / ``grep`` surfaces the schema without parsing
    the whole file. The caller's ``payload`` dict is not mutated — the
    version sentinel lives only in the serialised form.

    INV-1 (H-0082): concurrent readers observe either the prior payload
    or the next payload, never a partial byte sequence. The write goes
    through a same-directory tmp file + ``os.replace``, which is atomic
    on POSIX and Windows. ``Path.write_text`` is *not* atomic — it
    opens-truncates-writes, leaving a window during which a reader sees
    an empty file and raises ``JSONDecodeError`` (Issue #232).

    INV-2 (P-0099 v3-19 / R-1.3): kill -9 mid-write does not corrupt
    the canonical path. The tmp file is ``flush()``-ed and
    ``os.fsync``-ed before ``os.replace`` so the kernel page cache is
    durably on disk before the rename commits. Without fsync, a crash
    between ``write`` and ``replace`` could land a renamed file whose
    contents are still in cache, leaving a zero- or partial-byte file
    after reboot — the very corruption v3-19 is designed to prevent.
    The parent directory itself is also fsynced (best-effort — silently
    skipped on platforms that reject directory fds) so the rename's
    metadata reaches the disk inode table before the function returns.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    versioned: dict[str, Any] = {_FORMAT_VERSION_KEY: STUDIO_FORMAT_VERSION}
    versioned.update(payload)
    text = json.dumps(versioned, ensure_ascii=False, default=str)
    tmp = path.with_suffix(path.suffix + ".tmp")
    # Open-write-flush-fsync explicitly so the kernel commits the data
    # to disk BEFORE os.replace. Path.write_text returns before the
    # OS has committed the bytes; that combined with the rename below
    # is the (a)tomic-name + (n)on-durable-bytes hazard INV-2 closes.
    with tmp.open("w", encoding="utf-8") as fh:
        fh.write(text)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)
    _fsync_parent_dir(path)


def _fsync_parent_dir(path: Path) -> None:
    """Best-effort fsync of *path*'s parent directory.

    On POSIX this commits the directory entry change from os.replace
    so the rename's metadata survives a crash. On Windows the dir-fd
    open is rejected with ``PermissionError`` / ``OSError``; we
    silently skip — the os.replace is itself transactional under
    NTFS and writes the directory entry synchronously for a renamed
    file. Errors are suppressed because the canonical write has
    already succeeded; an inability to fsync the directory is a soft
    durability issue, not a correctness issue.
    """
    try:
        dir_fd = os.open(path.parent, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass
    finally:
        os.close(dir_fd)


def read_versioned_json(path: Path) -> tuple[int, dict[str, Any]]:
    """Load a versioned JSON artefact and migrate it to the current schema.

    Returns a tuple of ``(detected_version, payload)`` where:

    - ``detected_version`` is the version declared on disk (``0`` when
      the ``format_version`` key is absent — typical of workspaces
      created before C-9 landed).
    - ``payload`` is the migrated domain dict with the
      ``format_version`` sentinel stripped, so the caller consumes the
      same shape regardless of the source version.

    Raises :class:`IncompatibleFormatVersionError` when the detected
    version is newer than :data:`STUDIO_FORMAT_VERSION` — the runtime
    does not know how to read it.
    """
    raw: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    detected = int(raw.get(_FORMAT_VERSION_KEY, 0))

    if detected > STUDIO_FORMAT_VERSION:
        raise IncompatibleFormatVersionError(
            f"{path} has format_version={detected} which is newer than "
            f"this runtime (supports up to {STUDIO_FORMAT_VERSION}). "
            "Upgrade LizyStudio or load this workspace with a newer release."
        )

    # Work on a copy so callers' fixtures and hot-reloaded modules are
    # not affected by the version-strip.
    payload = {k: v for k, v in raw.items() if k != _FORMAT_VERSION_KEY}

    # Import locally to avoid a circular dependency between the
    # migrations module (which may one day need version constants) and
    # this module. At call time the migrations module is fully loaded.
    from lizystudio.storage.migrations import migrate_to_current

    migrated = migrate_to_current(payload, from_version=detected)
    return detected, migrated
