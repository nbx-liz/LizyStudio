"""Regression test for CRITICAL-1: cloudpickle path traversal.

``LizyMLAdapter.load_checkpoint`` previously accepted any Path and
unpickled the file at ``path/model.pkl`` without verifying the path was
within the job store. An attacker able to place a malicious pickle
anywhere readable by the server could then trigger arbitrary code
execution via ``cloudpickle.load``.

The fix introduces an optional ``allowed_root`` argument. When provided,
paths that resolve outside the root must raise before any file is
opened. The production caller (``training_retune._retune_execute``)
passes ``job_store.jobs_dir`` so only checkpoints under the studio's
own job directory can be loaded.
"""

from __future__ import annotations

from pathlib import Path

import cloudpickle
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.lizyml.pickle_compat import MODEL_PKL

pytestmark = pytest.mark.unit


def _write_pickle(target_dir: Path, payload: object) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with (target_dir / MODEL_PKL).open("wb") as fh:
        cloudpickle.dump(payload, fh)


def test_load_checkpoint_rejects_path_outside_allowed_root(tmp_path: Path) -> None:
    allowed_root = tmp_path / "jobs_dir"
    allowed_root.mkdir()
    outside = tmp_path / "malicious"
    _write_pickle(outside, {"payload": "pwned"})

    adapter = LizyMLAdapter()

    with pytest.raises(ValueError, match="outside allowed root"):
        adapter.load_checkpoint(outside, allowed_root=allowed_root)


def test_load_checkpoint_accepts_path_inside_allowed_root(tmp_path: Path) -> None:
    allowed_root = tmp_path / "jobs_dir"
    job_dir = allowed_root / "job_abc"
    _write_pickle(job_dir, {"payload": "ok"})

    adapter = LizyMLAdapter()

    loaded = adapter.load_checkpoint(job_dir, allowed_root=allowed_root)
    assert loaded == {"payload": "ok"}


def test_load_checkpoint_allows_none_root_for_backwards_compat(
    tmp_path: Path,
) -> None:
    """Existing tests / callers that don't pass allowed_root still work."""
    _write_pickle(tmp_path, {"payload": "ok"})

    adapter = LizyMLAdapter()

    loaded = adapter.load_checkpoint(tmp_path)
    assert loaded == {"payload": "ok"}


def test_load_checkpoint_rejects_symlink_escape(tmp_path: Path) -> None:
    """A symlink inside allowed_root must not grant access to outer files."""
    allowed_root = tmp_path / "jobs_dir"
    allowed_root.mkdir()
    outside = tmp_path / "malicious"
    _write_pickle(outside, {"payload": "pwned"})

    # Create a symlink inside allowed_root that points outside
    sneaky = allowed_root / "sneaky"
    sneaky.symlink_to(outside, target_is_directory=True)

    adapter = LizyMLAdapter()

    with pytest.raises(ValueError, match="outside allowed root"):
        adapter.load_checkpoint(sneaky, allowed_root=allowed_root)
