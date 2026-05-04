"""Stress tests for concurrent file uploads (Issue #383 (h) / #27 (h)).

The single workspace shares one ``WorkspaceState`` instance per FastAPI
process. ``WorkspaceState._temp_files`` is a plain ``list`` guarded by
``WorkspaceState._lock``; uploads that race the same workspace must:

- INV-1: Each upload's tempfile path appears in ``_temp_files`` exactly
  once (no lost writes, no duplicates from torn list mutation).
- INV-2: Every uploaded tempfile is a *distinct* path on disk — the
  ``tempfile.NamedTemporaryFile`` mkstemp seam guarantees uniqueness,
  so cross-pollination would mean a real bug in the upload path.
- INV-3: After all uploads complete, the workspace's ``data_ref.path``
  matches the *last winner* and that file still exists on disk —
  earlier winners' tempfiles are still tracked for ``reset()`` cleanup
  even though only one is the active dataframe.
- INV-4: No upload returns 5xx. Concurrent contention on the lock can
  serialise updates but must not surface as an internal error.

This file is a regression-only addition; production code is unchanged.
"""

from __future__ import annotations

import io
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit


def _csv_bytes(label: str, rows: int = 10) -> bytes:
    """Return a small unique CSV body so each upload is distinguishable."""
    body = io.StringIO()
    body.write("a,b,label\n")
    for i in range(rows):
        body.write(f"{i},{i * 2},{label}\n")
    return body.getvalue().encode("utf-8")


def test_concurrent_uploads_each_get_distinct_tempfile(client: TestClient) -> None:
    """INV-2: every concurrent upload gets a unique tempfile on disk."""
    n_uploads = 5

    def post(label: str) -> str:
        res = client.post(
            "/api/workspace/data/upload",
            files={"file": (f"u_{label}.csv", _csv_bytes(label), "text/csv")},
        )
        assert res.status_code == 200, res.text
        return res.json()["data_ref"]["path"]

    with ThreadPoolExecutor(max_workers=n_uploads) as ex:
        futs = [ex.submit(post, f"L{i}") for i in range(n_uploads)]
        paths = [f.result() for f in as_completed(futs)]

    # INV-2: all paths distinct
    assert len(set(paths)) == n_uploads
    # All tempfiles still exist on disk (tracked by workspace, not yet reset)
    for p in paths:
        assert Path(p).exists(), f"tempfile {p} was deleted prematurely"


def test_concurrent_uploads_track_temp_files_without_loss(
    client: TestClient,
) -> None:
    """INV-1: every upload's tempfile is registered in ``_temp_files``."""
    n_uploads = 8
    paths: list[str] = []

    def post(label: str) -> str:
        res = client.post(
            "/api/workspace/data/upload",
            files={"file": (f"u_{label}.csv", _csv_bytes(label), "text/csv")},
        )
        assert res.status_code == 200, res.text
        return res.json()["data_ref"]["path"]

    with ThreadPoolExecutor(max_workers=n_uploads) as ex:
        futs = [ex.submit(post, f"L{i}") for i in range(n_uploads)]
        for f in as_completed(futs):
            paths.append(f.result())

    # The shared workspace state should have tracked every upload's
    # tempfile path. ``_temp_files`` is read directly because the
    # tracking API is internal (``track_temp_file`` appends, no public
    # listing). Access via the FastAPI app.state seam — this is the
    # same singleton ``get_workspace`` returns to the routes.
    workspace = client.app.state.workspace
    tracked = list(workspace._temp_files)
    for p in paths:
        assert p in tracked, f"upload tempfile {p} missing from _temp_files"
    # No duplicates from torn list mutation under contention
    assert len(tracked) == len(set(tracked))


def test_concurrent_uploads_active_dataframe_is_self_consistent(
    client: TestClient,
) -> None:
    """INV-3: the workspace's ``data_ref`` after the burst points at one
    of the uploaded tempfiles, and that tempfile still exists.

    Race-tolerant: we don't pin which upload wins — only that the
    surviving ``data_ref`` is internally consistent (path on disk,
    shape matches the size we uploaded).
    """
    n_uploads = 5
    rows_per_upload = 12

    def post(label: str) -> dict[str, object]:
        res = client.post(
            "/api/workspace/data/upload",
            files={
                "file": (
                    f"u_{label}.csv",
                    _csv_bytes(label, rows=rows_per_upload),
                    "text/csv",
                )
            },
        )
        assert res.status_code == 200, res.text
        return res.json()["data_ref"]

    with ThreadPoolExecutor(max_workers=n_uploads) as ex:
        futs = [ex.submit(post, f"L{i}") for i in range(n_uploads)]
        refs = [f.result() for f in as_completed(futs)]

    # Read the workspace status — the public payload exposes filename
    # and shape but not the internal tempfile path. Use the app.state
    # singleton to assert against the full ``data_ref``.
    res = client.get("/api/workspace/status")
    assert res.status_code == 200, res.text
    status = res.json()
    assert status["has_data"] is True
    # Each upload had identical row count, so the active shape must
    # match too.
    assert tuple(status["data_ref"]["shape"]) == (rows_per_upload, 3)
    workspace = client.app.state.workspace
    final_path = workspace.data_ref.path
    assert Path(final_path).exists(), (
        f"final data_ref path {final_path} does not exist on disk"
    )
    # The final path must be one of the uploaded paths (no spurious
    # path leak from a different state).
    assert final_path in {r["path"] for r in refs}


def test_concurrent_uploads_no_5xx(client: TestClient) -> None:
    """INV-4: Lock contention serialises but never 500s."""
    n_uploads = 10
    statuses: list[int] = []

    def post(label: str) -> int:
        res = client.post(
            "/api/workspace/data/upload",
            files={"file": (f"u_{label}.csv", _csv_bytes(label), "text/csv")},
        )
        return res.status_code

    with ThreadPoolExecutor(max_workers=n_uploads) as ex:
        futs = [ex.submit(post, f"L{i}") for i in range(n_uploads)]
        for f in as_completed(futs):
            statuses.append(f.result())

    assert all(s == 200 for s in statuses), f"unexpected statuses: {statuses}"
