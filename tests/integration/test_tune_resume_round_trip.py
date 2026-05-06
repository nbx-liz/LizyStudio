"""INV-4 integration test for v0.5 R-1.4 (P-0099 v3-20g).

Verifies the end-to-end persistence contract: a tune run that writes
its trials to an Optuna SQLite storage MUST be re-attachable from a
second tune run pointing at the same ``(storage, study_name)`` pair,
and the second run MUST start at ``trial N+1`` rather than re-running
the original ``[0..N-1]`` trials.

This is the ONLY invariant that makes /unpause meaningful — without
study re-attachment, an unpause would silently restart the search
from scratch and the user's wall-clock time would be wasted. The
backend hand-off lives in ``lizystudio/services/training.py``
(``_build_optuna_storage_url`` + ``_build_optuna_study_name``); this
test exercises the full lizyml 0.12 path without going through the
FastAPI / WebSocket / threading layers — those are covered by the
v3-20d HTTP tests and the v3-20g Playwright spec.

The test runs n_trials=2 followed by n_trials=2 against the same
storage/study_name pair; this is small enough to stay under the
integration suite budget (current: ~50 s) yet large enough to prove
the trial-counter monotonicity that INV-4 demands.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pandas as pd
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml"


def _trim_n_trials(config: dict, n: int) -> dict:
    """Override the tuning n_trials so this test stays fast."""
    out = json.loads(json.dumps(config))
    out["tuning"]["optuna"]["params"]["n_trials"] = n
    return out


@pytest.mark.integration
def test_tune_storage_passthrough_round_trip(tmp_path: Path) -> None:
    """INV-4: /tune writing to an Optuna SQLite store can be re-attached.

    Steps:
    1. Run a tune with ``n_trials=2`` against
       ``sqlite:///<tmp>/optuna.db`` and ``study_name="resume-test"``.
    2. Verify the SQLite has exactly 2 trials persisted.
    3. Run a second tune with the SAME storage + study_name and
       ``n_trials=2`` more (simulating an /unpause where lizyml's
       ``load_if_exists=True`` continues the existing study).
    4. Verify the SQLite now has exactly 4 trials, the original 2 were
       NOT re-executed, and the new 2 picked up from trial number 2.
    """
    fixture_dir = FIXTURE_ROOT / "tune"
    df = pd.read_csv(fixture_dir / "data.csv")
    base_config: dict = json.loads((fixture_dir / "config.json").read_text())

    storage_url = f"sqlite:///{tmp_path / 'optuna.db'}"
    study_name = "v3-20g-resume-test"

    # --- First run: 2 trials --------------------------------------------------
    backend = LizyMLAdapter()
    config1 = _trim_n_trials(base_config, 2)
    model1 = backend.create_model(config1, df)
    backend.tune(
        model1,
        on_progress=None,
        re_tune=None,
        checkpoint_dir=tmp_path,
        storage=storage_url,
        study_name=study_name,
    )

    db_path = tmp_path / "optuna.db"
    assert db_path.exists(), "first tune must populate the SQLite store"

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM trials")
        first_count = cursor.fetchone()[0]
    assert first_count == 2, (
        f"INV-4 setup: first tune should record exactly 2 trials, got {first_count}"
    )

    # --- Second run: re-attach + 2 more trials --------------------------------
    config2 = _trim_n_trials(base_config, 2)
    model2 = backend.create_model(config2, df)
    backend.tune(
        model2,
        on_progress=None,
        re_tune=None,
        checkpoint_dir=tmp_path,
        storage=storage_url,
        study_name=study_name,
    )

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM trials")
        second_count = cursor.fetchone()[0]
        # Trial numbers must be 0,1,2,3 — i.e. monotonic without
        # re-using the 0,1 slots.
        cursor = conn.execute("SELECT number FROM trials ORDER BY number")
        trial_numbers = [row[0] for row in cursor.fetchall()]

    assert second_count == 4, (
        f"INV-4: after re-attach with n_trials=2 the study should have 4 "
        f"trials total; got {second_count}. This means lizyml did NOT "
        f"resume from the existing study — load_if_exists / "
        f"storage / study_name plumbing is broken."
    )
    assert trial_numbers == [0, 1, 2, 3], (
        f"INV-4: trial numbers must be monotonic (0,1,2,3), got {trial_numbers}. "
        f"A duplicate or reset would surface here as e.g. [0,1,0,1]."
    )
