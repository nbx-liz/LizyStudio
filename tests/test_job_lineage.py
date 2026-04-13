"""Unit tests for H-0062 Phase B job lineage (parent_job_id + cascade delete)."""

from __future__ import annotations

from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


@pytest.fixture
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _make_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


# ---------------------------------------------------------------------------
# parent_job_id persistence
# ---------------------------------------------------------------------------


def test_create_sets_parent_job_id_when_provided(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={"tuning": {"re_tune": {"n_rounds": 1}}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={"tuning": {"re_tune": {"n_rounds": 1}}},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    assert child.parent_job_id == parent.job_id

    # Reload from disk should preserve the link
    reloaded = job_store.get(child.job_id)
    assert reloaded is not None
    assert reloaded.parent_job_id == parent.job_id


def test_job_without_parent_defaults_to_none(job_store: JobStore) -> None:
    j = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="fit",
    )
    assert j.parent_job_id is None
    reloaded = job_store.get(j.job_id)
    assert reloaded is not None
    assert reloaded.parent_job_id is None


# ---------------------------------------------------------------------------
# child_job_ids derivation
# ---------------------------------------------------------------------------


def test_get_child_job_ids_lists_direct_children(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child_a = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    child_b = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )

    ids = job_store.get_child_job_ids(parent.job_id)
    assert set(ids) == {child_a.job_id, child_b.job_id}


def test_get_child_job_ids_empty_for_leaf(job_store: JobStore) -> None:
    j = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert job_store.get_child_job_ids(j.job_id) == []


# ---------------------------------------------------------------------------
# lineage tree
# ---------------------------------------------------------------------------


def test_get_lineage_tree_three_level_chain(job_store: JobStore) -> None:
    root = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    mid = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=root.job_id,
    )
    leaf = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=mid.job_id,
    )

    tree = job_store.get_lineage_tree(root.job_id)
    assert tree["job_id"] == root.job_id
    assert len(tree["children"]) == 1
    assert tree["children"][0]["job_id"] == mid.job_id
    assert len(tree["children"][0]["children"]) == 1
    assert tree["children"][0]["children"][0]["job_id"] == leaf.job_id


def test_get_lineage_tree_from_middle_node(job_store: JobStore) -> None:
    root = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    mid = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=root.job_id,
    )

    tree = job_store.get_lineage_tree(mid.job_id)
    assert tree["job_id"] == mid.job_id
    # Root is the parent, not shown in the subtree
    assert tree["children"] == []


def test_get_lineage_tree_missing_root_returns_none(job_store: JobStore) -> None:
    assert job_store.get_lineage_tree("nonexistent") is None


# ---------------------------------------------------------------------------
# Cascade delete
# ---------------------------------------------------------------------------


def test_delete_cascade_removes_entire_subtree(job_store: JobStore) -> None:
    root = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child_a = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=root.job_id,
    )
    grandchild = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=child_a.job_id,
    )
    child_b = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=root.job_id,
    )

    deleted = job_store.delete(root.job_id, cascade=True)
    assert set(deleted) == {
        root.job_id,
        child_a.job_id,
        grandchild.job_id,
        child_b.job_id,
    }
    # All jobs gone
    for jid in (root.job_id, child_a.job_id, grandchild.job_id, child_b.job_id):
        assert job_store.get(jid) is None


def test_delete_without_cascade_removes_only_root(job_store: JobStore) -> None:
    root = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=root.job_id,
    )
    deleted = job_store.delete(root.job_id, cascade=False)
    assert deleted == [root.job_id]
    assert job_store.get(root.job_id) is None
    # Child still exists (now orphaned)
    assert job_store.get(child.job_id) is not None


def test_delete_nonexistent_returns_empty_list(job_store: JobStore) -> None:
    assert job_store.delete("nonexistent", cascade=True) == []


# ---------------------------------------------------------------------------
# Active-children detection (for DELETE ?cascade=true enforcement)
# ---------------------------------------------------------------------------


def test_has_active_children_false_when_all_completed(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    child.status = "completed"
    job_store.update(child)
    assert job_store.has_active_children(parent.job_id) is False


def test_has_active_children_true_when_running(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    child = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    child.status = "running"
    job_store.update(child)
    assert job_store.has_active_children(parent.job_id) is True


def test_has_active_children_true_when_pending(job_store: JobStore) -> None:
    parent = job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    # create() defaults status to "pending"
    job_store.create(
        backend_name="lizyml",
        config={},
        data_ref=_make_data_ref(),
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    assert job_store.has_active_children(parent.job_id) is True
