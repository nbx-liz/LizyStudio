"""INV-2 atomic + durable JSON write tests (P-0099 v3-19 / R-1.3).

INV-2: meta.json (and other versioned JSON artefacts) are written
atomically AND durably:

  - Atomic name commit: tmp file + ``os.replace`` so concurrent
    readers see either the prior payload or the next payload, never
    a partial byte sequence (already enforced by H-0082).

  - Durable bytes: the tmp file is ``flush`` + ``fsync``-ed before
    ``os.replace`` so a kill -9 between write and rename does NOT
    leave a zero- or partial-byte file at the canonical path after
    the OS reaps the renamed inode. Without fsync the rename can
    commit a stale page-cache view that has not yet hit disk.

This is the v3-19 strengthening of the H-0082 atomicity contract —
H-0082 covered concurrent readers; INV-2 covers process death.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest

from lizystudio.storage.versions import (
    read_versioned_json,
    write_versioned_json,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Atomic-name commit (existing H-0082 behavior, re-pinned here).
# ---------------------------------------------------------------------------


def test_inv2_write_leaves_no_tmp_file_on_success(tmp_path: Path) -> None:
    """A successful write removes the tmp staging file."""
    path = tmp_path / "meta.json"
    write_versioned_json(path, {"job_id": "j1", "status": "completed"})

    assert path.exists()
    tmp_path_candidates = list(tmp_path.glob("*.tmp"))
    assert tmp_path_candidates == [], (
        f"INV-2: tmp staging files must not leak — saw {tmp_path_candidates}"
    )


def test_inv2_overwrite_replaces_canonical_path(tmp_path: Path) -> None:
    """A second write replaces the canonical content."""
    path = tmp_path / "meta.json"
    write_versioned_json(path, {"job_id": "first"})
    write_versioned_json(path, {"job_id": "second"})

    _, payload = read_versioned_json(path)
    assert payload["job_id"] == "second"


# ---------------------------------------------------------------------------
# fsync ordering — durability invariant (the new INV-2 strengthening).
# ---------------------------------------------------------------------------


def test_inv2_write_calls_fsync_before_replace(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """``os.fsync`` for the tmp fd MUST run before ``os.replace``.

    This pins the durability contract: the kernel page cache is
    flushed to disk BEFORE the rename commits the new file at the
    canonical path. A future "optimization" that drops fsync would
    silently make the writes vulnerable to kill -9 corruption.
    """
    call_log: list[str] = []
    real_fsync = os.fsync
    real_replace = os.replace

    def tracking_fsync(fd: int) -> None:
        call_log.append("fsync")
        real_fsync(fd)

    def tracking_replace(src: Any, dst: Any) -> None:
        call_log.append("replace")
        real_replace(src, dst)

    monkeypatch.setattr(os, "fsync", tracking_fsync)
    monkeypatch.setattr(os, "replace", tracking_replace)

    path = tmp_path / "meta.json"
    write_versioned_json(path, {"job_id": "j1"})

    assert "fsync" in call_log, "INV-2: fsync must be called for crash safety"
    assert "replace" in call_log, "atomic rename must still be used"
    fsync_idx = call_log.index("fsync")
    replace_idx = call_log.index("replace")
    assert fsync_idx < replace_idx, (
        f"INV-2: fsync must complete BEFORE os.replace — call order was "
        f"{call_log}. A rename of an unflushed tmp file commits "
        f"page-cache-only bytes that a kill -9 can drop."
    )


# ---------------------------------------------------------------------------
# Crash simulation — kill between write and rename leaves prior content.
# ---------------------------------------------------------------------------


def test_inv2_simulated_crash_between_fsync_and_replace_preserves_prior(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """``os.replace`` raising mid-write must NOT corrupt the canonical path.

    Models a kill -9 that lands between the tmp write+fsync and the
    rename. The canonical path must still hold the previous content
    (or not exist if there was none).
    """
    path = tmp_path / "meta.json"
    write_versioned_json(path, {"job_id": "first", "round": 1})

    def crashing_replace(src: Any, dst: Any) -> None:
        # Simulate the OS terminating the process between write+fsync
        # and the directory-entry update. We do NOT clean up the tmp
        # file here — that mirrors a real kill -9 scenario.
        raise SystemExit("simulated kill -9 between fsync and replace")

    monkeypatch.setattr(os, "replace", crashing_replace)

    with pytest.raises(SystemExit):
        write_versioned_json(path, {"job_id": "second", "round": 2})

    # Canonical path must still hold the original content.
    _, payload = read_versioned_json(path)
    assert payload["job_id"] == "first", (
        "INV-2: a crash between write and replace must preserve the "
        f"prior canonical content (saw {payload['job_id']!r})"
    )
    assert payload["round"] == 1


def test_inv2_simulated_crash_during_write_does_not_corrupt_canonical(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A crash DURING the tmp write must leave the canonical path untouched.

    Even before ``os.replace`` runs, an exception inside the
    open-write-flush-fsync block must not affect the canonical path.
    """
    path = tmp_path / "meta.json"
    write_versioned_json(path, {"job_id": "first"})

    real_fsync = os.fsync

    def crashing_fsync(fd: int) -> None:
        # Flush kernel buffers to disk first so we are not testing a
        # half-written tmp on real fs; THEN raise to simulate the
        # process dying just after fsync but before replace cleanup.
        real_fsync(fd)
        raise SystemExit("simulated kill -9 during fsync")

    monkeypatch.setattr(os, "fsync", crashing_fsync)

    with pytest.raises(SystemExit):
        write_versioned_json(path, {"job_id": "second"})

    _, payload = read_versioned_json(path)
    assert payload["job_id"] == "first", (
        "INV-2: a crash during the tmp write must leave canonical path untouched"
    )


# ---------------------------------------------------------------------------
# Parent-directory fsync — best-effort, must not crash on platforms that
# reject directory fds.
# ---------------------------------------------------------------------------


def test_inv2_write_tolerates_parent_dir_fsync_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Parent-dir fsync failure must not propagate to the caller.

    On Windows / some FUSE filesystems ``os.open(dir_path, O_RDONLY)``
    or its subsequent ``fsync`` raises. We swallow that error because
    the canonical write has already succeeded — this is a durability
    nicety, not a correctness invariant.
    """
    path = tmp_path / "meta.json"

    real_open = os.open
    real_fsync = os.fsync

    def selective_open(p: Any, flags: int, *args: Any, **kwargs: Any) -> int:
        # Reject the parent-dir open specifically; tmp file open should
        # still succeed via the regular path through Path.open.
        if str(p) == str(tmp_path):
            raise OSError("simulated platform without directory fds")
        return real_open(p, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", selective_open)

    # Should NOT raise — the canonical write succeeds, parent-dir
    # fsync is best-effort.
    write_versioned_json(path, {"job_id": "j1"})

    # Independently verify nothing else was disturbed.
    monkeypatch.setattr(os, "open", real_open)
    monkeypatch.setattr(os, "fsync", real_fsync)
    _, payload = read_versioned_json(path)
    assert payload["job_id"] == "j1"
