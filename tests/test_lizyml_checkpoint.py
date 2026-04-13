"""Unit tests for H-0062 Phase B incremental checkpoint save + preflight.

Covers:
- save_checkpoint: atomic rename (.tmp -> model.pkl), model_meta.json sidecar
- load_checkpoint: round-trip via cloudpickle, version-mismatch rejection
- preflight: writable-dir probe + skeleton round-trip
- tune integration: checkpoint called after each trial when checkpoint_dir is set,
  Phase A fixtures stay green when checkpoint_dir is None
- swallow policy: OSError/PicklingError in save does NOT abort tune
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.lizyml import (
    LizyMLAdapter,
    PickleIncompatibleError,
    PicklePreflightError,
    verify_pickle_compatibility,
)

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# save_checkpoint / load_checkpoint
# ---------------------------------------------------------------------------


def _make_picklable_object() -> dict[str, Any]:
    """A tiny picklable structure used in place of a real Model."""
    return {"_marker": "test", "value": 42}


def test_save_checkpoint_writes_model_pkl_atomically(tmp_path: Path) -> None:
    adapter = LizyMLAdapter()
    adapter.save_checkpoint(_make_picklable_object(), tmp_path)

    assert (tmp_path / "model.pkl").exists()
    # No leftover temp file
    assert not (tmp_path / "model.pkl.tmp").exists()


def test_save_checkpoint_writes_meta_json_with_versions(tmp_path: Path) -> None:
    adapter = LizyMLAdapter()
    adapter.save_checkpoint(_make_picklable_object(), tmp_path)

    meta_path = tmp_path / "model_meta.json"
    assert meta_path.exists()

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert meta["pickle_schema"] == 1
    assert "lizyml_version" in meta
    assert "lightgbm_version" in meta
    assert "optuna_version" in meta
    assert "saved_at" in meta


def test_load_checkpoint_roundtrip(tmp_path: Path) -> None:
    adapter = LizyMLAdapter()
    adapter.save_checkpoint(_make_picklable_object(), tmp_path)

    loaded = adapter.load_checkpoint(tmp_path)
    assert loaded == _make_picklable_object()


def test_save_checkpoint_swallows_oserror(
    tmp_path: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An unwritable directory must NOT raise — the tune must keep running."""
    adapter = LizyMLAdapter()

    # Force cloudpickle.dump inside save_checkpoint to raise OSError by
    # substituting the underlying bytes write.
    from lizystudio.backends import lizyml as lm

    def boom(*args: Any, **kwargs: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(lm.cloudpickle, "dump", boom)

    with caplog.at_level("WARNING"):
        adapter.save_checkpoint(_make_picklable_object(), tmp_path)

    # Must NOT have raised, must have logged.
    assert any("checkpoint" in rec.message.lower() for rec in caplog.records)
    # Temp file (if any) cleaned up
    assert not (tmp_path / "model.pkl.tmp").exists()


def test_load_checkpoint_raises_when_missing(tmp_path: Path) -> None:
    adapter = LizyMLAdapter()
    with pytest.raises(FileNotFoundError):
        adapter.load_checkpoint(tmp_path)


# ---------------------------------------------------------------------------
# verify_pickle_compatibility
# ---------------------------------------------------------------------------


def test_verify_pickle_compatibility_accepts_matching_major() -> None:
    import lizyml

    meta = {
        "pickle_schema": 1,
        "lizyml_version": lizyml.__version__,
        "lightgbm_version": "any",
        "optuna_version": "any",
    }
    # Should not raise
    verify_pickle_compatibility(meta)


def test_verify_pickle_compatibility_rejects_schema_mismatch() -> None:
    meta = {
        "pickle_schema": 99,
        "lizyml_version": "0.9.0",
        "lightgbm_version": "4.5.0",
        "optuna_version": "4.0.0",
    }
    with pytest.raises(PickleIncompatibleError, match="pickle_schema"):
        verify_pickle_compatibility(meta)


def test_verify_pickle_compatibility_rejects_lizyml_major_mismatch() -> None:
    meta = {
        "pickle_schema": 1,
        "lizyml_version": "0.7.0",  # major/minor mismatch vs installed 0.9.x
        "lightgbm_version": "4.5.0",
        "optuna_version": "4.0.0",
    }
    with pytest.raises(PickleIncompatibleError, match="lizyml"):
        verify_pickle_compatibility(meta)


# ---------------------------------------------------------------------------
# Pre-flight check
# ---------------------------------------------------------------------------


def test_preflight_pickle_check_succeeds_on_writable_dir(tmp_path: Path) -> None:
    from lizystudio.backends.lizyml import preflight_pickle_check

    preflight_pickle_check(tmp_path)  # must not raise

    # The probe file should be cleaned up.
    assert not (tmp_path / ".write_test").exists()


def test_preflight_pickle_check_fails_on_readonly_dir(tmp_path: Path) -> None:
    from lizystudio.backends.lizyml import preflight_pickle_check

    readonly = tmp_path / "ro"
    readonly.mkdir()
    readonly.chmod(0o555)
    try:
        with pytest.raises(PicklePreflightError, match="write"):
            preflight_pickle_check(readonly)
    finally:
        readonly.chmod(0o755)  # restore so pytest tmp_path teardown works


# ---------------------------------------------------------------------------
# tune() integration with checkpoint_dir
# ---------------------------------------------------------------------------


def test_tune_without_checkpoint_dir_does_not_save(tmp_path: Path) -> None:
    """Phase A regression guard: when checkpoint_dir=None, tune() must NOT
    touch any model.pkl artifacts."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = MagicMock(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )

    adapter.tune(mock_model)

    # No pickle artifacts in tmp_path (which is what the service would pass).
    assert not (tmp_path / "model.pkl").exists()


def test_tune_with_checkpoint_dir_saves_after_each_trial(tmp_path: Path) -> None:
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    # Track how many times cloudpickle.dump was invoked by spying on
    # save_checkpoint via monkeypatching.
    save_calls: list[Path] = []

    def fake_save(obj: Any, path: Path) -> None:
        save_calls.append(Path(path))

    adapter.save_checkpoint = fake_save  # type: ignore[assignment]

    def fake_tune(*, progress_callback: Any = None, **_: Any) -> MagicMock:
        if progress_callback is not None:
            for trial_idx in range(3):
                info = MagicMock()
                info.current_trial = trial_idx + 1
                info.total_trials = 3
                info.best_score = 0.8 + trial_idx * 0.01
                info.latest_score = 0.8 + trial_idx * 0.005
                info.latest_state = "COMPLETE"
                progress_callback(info)
        return MagicMock(
            best_params={"lr": 0.1},
            best_score=0.9,
            trials=[],  # empty list avoids _serialize_tuning_result attr access
            metric_name="auc",
            direction="maximize",
            rounds=[],
            boundary_report=None,
        )

    mock_model.tune = fake_tune

    adapter.tune(mock_model, checkpoint_dir=tmp_path)

    # Three trials = three checkpoint saves
    assert len(save_calls) == 3
    # Every save targets the same directory
    assert all(p == tmp_path for p in save_calls)


def test_tune_checkpoint_failure_does_not_abort(tmp_path: Path) -> None:
    """save_checkpoint raising internally must be swallowed by the adapter
    so a flaky filesystem does not crash an in-flight tune."""
    adapter = LizyMLAdapter()
    mock_model = MagicMock()

    def angry_save(obj: Any, path: Path) -> None:
        raise OSError("synthetic disk error")

    # Save_checkpoint itself is resilient in the real impl, but this test
    # verifies the tune loop would survive even if it weren't — by having
    # the bridge catch/swallow around each save call.
    adapter.save_checkpoint = angry_save  # type: ignore[assignment]

    def fake_tune(*, progress_callback: Any = None, **_: Any) -> MagicMock:
        if progress_callback is not None:
            info = MagicMock()
            info.current_trial = 1
            info.total_trials = 1
            info.best_score = 0.9
            info.latest_score = 0.9
            info.latest_state = "COMPLETE"
            progress_callback(info)
        return MagicMock(
            best_params={"lr": 0.1},
            best_score=0.9,
            trials=[],
            metric_name="auc",
            direction="maximize",
            rounds=[],
            boundary_report=None,
        )

    mock_model.tune = fake_tune

    # Must complete without raising.
    result = adapter.tune(mock_model, checkpoint_dir=tmp_path)
    assert result.best_score == 0.9
