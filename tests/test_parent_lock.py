"""Unit tests for H-0062 Phase B per-parent exclusive lock.

Ensures a single parent Tune Job can only host one in-flight Re-tune /
Resume child at a time, with clean release on completion and automatic
clearing on process restart.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


@pytest.fixture
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def test_acquire_lock_succeeds_when_free(job_store: JobStore) -> None:
    assert job_store.acquire_parent_lock("parent_a", "child_1") is True
    assert job_store.get_locked_child("parent_a") == "child_1"


def test_acquire_lock_fails_when_already_held(job_store: JobStore) -> None:
    assert job_store.acquire_parent_lock("parent_a", "child_1") is True
    assert job_store.acquire_parent_lock("parent_a", "child_2") is False
    # Original holder still there
    assert job_store.get_locked_child("parent_a") == "child_1"


def test_release_lock_allows_reacquire(job_store: JobStore) -> None:
    assert job_store.acquire_parent_lock("parent_a", "child_1") is True
    job_store.release_parent_lock("parent_a")
    assert job_store.get_locked_child("parent_a") is None
    assert job_store.acquire_parent_lock("parent_a", "child_2") is True


def test_release_unlocked_parent_is_noop(job_store: JobStore) -> None:
    # Should not raise
    job_store.release_parent_lock("never_locked")


def test_locks_are_per_parent(job_store: JobStore) -> None:
    assert job_store.acquire_parent_lock("parent_a", "child_1") is True
    assert job_store.acquire_parent_lock("parent_b", "child_2") is True
    assert job_store.get_locked_child("parent_a") == "child_1"
    assert job_store.get_locked_child("parent_b") == "child_2"


def test_new_jobstore_instance_starts_with_no_locks(tmp_path: Path) -> None:
    """Process restart simulation: a new JobStore sharing the same dir
    has a fresh in-memory lock map."""
    store_a = JobStore(tmp_path / "jobs")
    assert store_a.acquire_parent_lock("parent_a", "child_1") is True

    # New instance same dir
    store_b = JobStore(tmp_path / "jobs")
    assert store_b.get_locked_child("parent_a") is None
    assert store_b.acquire_parent_lock("parent_a", "child_2") is True


def test_release_only_affects_the_target_parent(job_store: JobStore) -> None:
    job_store.acquire_parent_lock("parent_a", "child_1")
    job_store.acquire_parent_lock("parent_b", "child_2")
    job_store.release_parent_lock("parent_a")
    assert job_store.get_locked_child("parent_a") is None
    assert job_store.get_locked_child("parent_b") == "child_2"
