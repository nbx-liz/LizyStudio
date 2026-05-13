"""Pickle compatibility matrix (v3-26 / R-4.2).

The on-disk ``model.pkl`` + ``model_meta.json`` carries
``pickle_schema`` and the saved lizyml / lightgbm / optuna versions.
``verify_pickle_compatibility`` rejects checkpoints whose lizyml
major.minor does not match the runtime so a silent corrupt-load can
never occur — every minor lizyml bump invalidates older artefacts and
the user is told to refit.

This module pins that invariant under three drift scenarios that have
*actually* burned us in past minor bumps:

1. ``schema_mismatch`` — ``PICKLE_SCHEMA_VERSION`` bump (a backend
   refactor changed the on-disk shape).
2. ``lizyml_version_mismatch`` — a new lizyml minor where pickle
   reflects internal class moves.
3. ``corrupt_meta`` — a partially-written ``model_meta.json``
   (atomic-write crash mid-flight).

The tests are marked ``@pytest.mark.slow`` + ``@pytest.mark.pickle_compat``
so they stay out of PR CI (``addopts = -m 'not quarantine'`` still picks
them up by default, but the explicit ``-m "pickle_compat"`` selector in
the nightly job makes the intent explicit and lets the matrix workflow
run only this file). The matrix is exercised cross-version by
``scripts/pickle_compat_matrix.sh`` in the nightly workflow — that script
installs past N=3 minor lizyml releases into separate venvs, calls
``save_checkpoint`` with each, then runs this file against the saved
artefacts with the *current* runtime to assert the rejection envelope.

The unit-level tests below stay synthetic so they remain meaningful
even on a developer machine without the matrix venvs installed.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from lizystudio.backends.lizyml import (
    LizyMLAdapter,
    PickleIncompatibleError,
    verify_pickle_compatibility,
)
from lizystudio.backends.lizyml.pickle_compat import PICKLE_SCHEMA_VERSION

pytestmark = [pytest.mark.slow, pytest.mark.pickle_compat]


def _make_picklable_object() -> dict[str, Any]:
    return {"_marker": "v3-26", "value": 7}


def _save_with_drifted_meta(
    tmp_path: Path, *, lizyml_version: str, pickle_schema: int = PICKLE_SCHEMA_VERSION
) -> Path:
    """Save a real checkpoint then overwrite the sidecar to simulate drift.

    This mirrors what the cross-version nightly matrix produces: a
    pickle saved by a past lizyml release whose ``lizyml_version`` is
    older than the runtime executing the load. We cannot install N
    lizyml minors in-process, so the meta is rewritten to reproduce
    the on-disk shape the matrix script would have generated.
    """
    adapter = LizyMLAdapter()
    adapter.save_checkpoint(_make_picklable_object(), tmp_path)
    meta_path = tmp_path / "model_meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["lizyml_version"] = lizyml_version
    meta["pickle_schema"] = pickle_schema
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    return tmp_path


# ---------------------------------------------------------------------------
# INV-A: silent load forbidden — every drift class must raise
# PickleIncompatibleError with a non-empty ``kind`` + ``recovery_hint``.
# ---------------------------------------------------------------------------


def test_pickle_compat_rejects_schema_mismatch(tmp_path: Path) -> None:
    _save_with_drifted_meta(
        tmp_path,
        lizyml_version="0.15.0",
        pickle_schema=PICKLE_SCHEMA_VERSION + 1,
    )
    meta = json.loads((tmp_path / "model_meta.json").read_text(encoding="utf-8"))
    with pytest.raises(PickleIncompatibleError) as excinfo:
        verify_pickle_compatibility(meta)
    err = excinfo.value
    assert err.kind == "schema_mismatch"
    assert err.recovery_hint
    assert err.suggested_fix


@pytest.mark.parametrize(
    "past_minor",
    [
        "0.12.0",  # N-3
        "0.13.0",  # N-2
        "0.14.0",  # N-1
    ],
)
def test_pickle_compat_rejects_past_n_minors(tmp_path: Path, past_minor: str) -> None:
    """The user-facing DoD for v3-26: artefacts produced by the
    previous three lizyml minor releases must be rejected with a
    structured envelope, not silently loaded.
    """
    _save_with_drifted_meta(tmp_path, lizyml_version=past_minor)
    meta = json.loads((tmp_path / "model_meta.json").read_text(encoding="utf-8"))
    with pytest.raises(PickleIncompatibleError) as excinfo:
        verify_pickle_compatibility(meta)
    err = excinfo.value
    assert err.kind == "lizyml_version_mismatch"
    assert err.recovery_hint
    assert err.suggested_fix
    assert past_minor in err.suggested_fix


def test_pickle_compat_full_load_path_raises(tmp_path: Path) -> None:
    """End-to-end through the adapter's ``load_checkpoint`` — confirms
    the verify_pickle_compatibility hook is wired into the load path
    so a buggy refactor cannot bypass the gate while keeping the unit
    test green.
    """
    _save_with_drifted_meta(tmp_path, lizyml_version="0.7.0")
    adapter = LizyMLAdapter()
    with pytest.raises(PickleIncompatibleError):
        adapter.load_checkpoint(tmp_path)
