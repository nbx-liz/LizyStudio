"""Stress tests for concurrent ``create_and_claim_active`` (Issue #27 (e)).

``test_reg_0070`` covers the *serial* two-caller path. This file
escalates to ``N`` threads racing the same JobStore concurrently and
asserts the post-conditions:

- INV: at most ONE thread sees a non-None ``Job`` returned.
- INV: no orphan job directory is created on disk for the losing
  threads — ``create_and_claim_active`` is the single critical
  section that checks-the-slot + creates-the-job + claims-the-slot.
- INV: after the winner releases, a second wave of N threads can
  again elect exactly one winner.
- INV: the on-disk ``meta.json`` count equals the number of winners
  across all waves (no torn writes, no duplicate dirs).
"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


def _data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )


def _race_create_and_claim(
    store: JobStore, n: int, start_barrier: threading.Barrier
) -> list[bool]:
    """Spawn ``n`` threads; every thread blocks on ``start_barrier``
    until all are ready, then races for the active slot. Returns a
    list of bools: ``True`` for the winners.
    """
    wins: list[bool] = [False] * n

    def worker(i: int) -> None:
        start_barrier.wait()
        job = store.create_and_claim_active(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_data_ref(),
            job_type="fit",
        )
        wins[i] = job is not None

    threads = [
        threading.Thread(target=worker, args=(i,), daemon=True) for i in range(n)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10.0)
        assert not t.is_alive(), "worker thread failed to join in time"

    return wins


def test_n_threads_elect_exactly_one_winner(tmp_path: Path) -> None:
    """20 threads call ``create_and_claim_active`` simultaneously;
    exactly one returns a Job, the other 19 return ``None``.
    """
    store = JobStore(tmp_path)
    n = 20
    barrier = threading.Barrier(n)

    wins = _race_create_and_claim(store, n=n, start_barrier=barrier)

    assert sum(wins) == 1, f"expected 1 winner across {n} threads, got {sum(wins)}"
    assert store.active_job_id is not None


def test_losing_threads_do_not_leave_orphan_job_dirs(tmp_path: Path) -> None:
    """The 19 losing threads must NOT create a meta.json on disk.
    Counts directory entries under ``tmp_path`` and asserts exactly
    one job directory exists after the race.
    """
    store = JobStore(tmp_path)
    n = 20
    barrier = threading.Barrier(n)

    _race_create_and_claim(store, n=n, start_barrier=barrier)

    job_dirs = [p for p in tmp_path.iterdir() if p.is_dir()]
    assert len(job_dirs) == 1, (
        f"expected exactly 1 job dir after race, got {len(job_dirs)}: "
        f"{[p.name for p in job_dirs]}"
    )
    assert (job_dirs[0] / "meta.json").exists(), "winner must persist meta.json"


def test_two_waves_each_elect_one_winner(tmp_path: Path) -> None:
    """After the first winner releases the slot, a second wave of
    racers must again elect exactly one winner. Verifies the slot
    state is fully reset and the JobStore behaves identically across
    repeated rounds.
    """
    store = JobStore(tmp_path)
    n = 10

    wins1 = _race_create_and_claim(store, n=n, start_barrier=threading.Barrier(n))
    assert sum(wins1) == 1
    winner1 = store.active_job_id
    assert winner1 is not None

    store.release_active(winner1)
    assert store.active_job_id is None

    wins2 = _race_create_and_claim(store, n=n, start_barrier=threading.Barrier(n))
    assert sum(wins2) == 1
    winner2 = store.active_job_id
    assert winner2 is not None and winner2 != winner1

    # On-disk: exactly two job dirs (winner1 + winner2).
    job_dirs = sorted(p.name for p in tmp_path.iterdir() if p.is_dir())
    assert len(job_dirs) == 2, f"expected 2 job dirs after two waves, got: {job_dirs}"


def test_release_during_race_does_not_double_admit(tmp_path: Path) -> None:
    """Edge: the slot holder releases mid-race. The losing threads
    that arrive BEFORE the release must still get None; the threads
    that arrive AFTER the release elect a single new winner.

    Drives this by having a holder thread release after a short delay
    while a fresh wave is contending for the slot. The total count of
    "winners" across the wave is always exactly one — the slot is
    serialised by ``_active_lock``, and the late-arriver winner picks
    up where the original holder left off.
    """
    store = JobStore(tmp_path)
    holder = store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=_data_ref(),
        job_type="fit",
    )
    assert holder is not None

    n = 10
    start = threading.Barrier(n + 1)
    wins: list[bool] = [False] * n

    def worker(i: int) -> None:
        start.wait()
        job = store.create_and_claim_active(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_data_ref(),
            job_type="fit",
        )
        wins[i] = job is not None

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    start.wait()
    # Release the slot once the wave has begun racing.
    store.release_active(holder.job_id)

    for t in threads:
        t.join(timeout=10.0)

    # Exactly one wave entrant successfully claims the freed slot;
    # everyone else races against it and gets None.
    assert sum(wins) == 1, (
        f"expected 1 wave winner after release-during-race, got {sum(wins)}"
    )
