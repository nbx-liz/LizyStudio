"""Regression tests for data-pipeline resilience (Issue #28 (c)).

Three failure paths from the original issue:

- "Data file deleted after load but before fit" — verify the in-memory
  dataframe still drives downstream calls, and that re-loading the
  same path now surfaces ``404 PATH_NOT_FOUND`` rather than leaking a
  stale OS error.
- "Temporary upload file cleanup after reset" — workspace reset must
  unlink every tracked tempfile so ``/tmp`` does not fill up across
  long sessions.
- "Tempfile cleanup on upload-failure mid-load" — a corrupt CSV must
  not leave a tempfile behind.

P-0095 / Issue #346 already covers the "partial meta.json write"
case via the fit→load round-trip CI gate, so it is *not* duplicated
here.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def _create_csv(tmp_path: Path, rows: int = 30) -> Path:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(rows):
            writer.writerow([i, 20 + i, i % 2])
    return csv_path


def test_load_path_then_delete_keeps_in_memory_view(
    client: TestClient, tmp_path: Path
) -> None:
    """Once the dataframe lands in ``WorkspaceState.dataframe`` it is
    independent of the source file. Deleting the file on disk after
    a successful load must not break the in-memory view used by
    preview / columns / fit.
    """
    csv_path = _create_csv(tmp_path)
    r = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert r.status_code == 200

    # Source file vanishes (rm by an external process).
    csv_path.unlink()

    # In-memory operations remain available.
    r = client.get("/api/workspace/data/preview?rows=5")
    assert r.status_code == 200
    assert len(r.json()["data"]) == 5

    r = client.get("/api/workspace/data/columns")
    assert r.status_code == 200
    assert "target" in [c["name"] for c in r.json()["columns"]]

    # Status is still populated.
    body = client.get("/api/workspace/status").json()
    assert body["has_data"] is True
    assert body["data_ref"]["filename"] == "train.csv"


def test_load_path_after_delete_returns_path_not_found(
    client: TestClient, tmp_path: Path
) -> None:
    """A second ``POST /data/path`` against a now-missing file must
    return ``PATH_NOT_FOUND`` (HTTP 400 per the project error
    contract) rather than leaking a 500 from a deeper IOError.
    Guards the user-facing message: the SPA surfaces the body
    verbatim.
    """
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    csv_path.unlink()

    r = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert r.status_code == 400
    body = r.json()
    # The project's StudioError envelope: {detail: {error: {code, message}}}.
    error = body.get("detail", body).get("error", {})
    assert error.get("code") == "PATH_NOT_FOUND", body
    assert "not found" in error.get("message", "").lower()


def test_reset_unlinks_tracked_upload_tempfile(
    client: TestClient, tmp_path: Path
) -> None:
    """``/api/workspace/reset`` must unlink every tempfile tracked on
    the WorkspaceState. Without this guarantee, repeatedly uploading
    + resetting in a long session would fill ``/tmp``.
    """
    csv_path = _create_csv(tmp_path)
    with csv_path.open("rb") as f:
        r = client.post(
            "/api/workspace/data/upload",
            files={"file": ("train.csv", f, "text/csv")},
        )
    assert r.status_code == 200
    tmp_name = r.json()["data_ref"]["path"]
    assert Path(tmp_name).exists(), "upload should stage a tempfile on disk"
    # Tempfile lives under the OS temp root, not the user-loaded dir.
    assert tmp_name.startswith("/tmp/")

    r = client.post("/api/workspace/reset")
    assert r.status_code == 200

    assert not Path(tmp_name).exists(), (
        f"reset must unlink tracked tempfile, still present: {tmp_name}"
    )


def test_corrupt_upload_does_not_leak_tempfile(
    client: TestClient, tmp_path: Path
) -> None:
    """A file that fails to parse must not leave a tempfile behind.
    A ``.parquet`` extension with non-parquet bytes triggers the
    ``load_dataframe`` exception path; the handler must unlink the
    staged tempfile before re-raising as ``FILE_INVALID``.
    """
    tmp_root = Path("/tmp")
    before = sorted(tmp_root.glob("lizystudio_*"))

    bad_payload = io.BytesIO(b"this is plainly not a parquet file\n" * 4)
    r = client.post(
        "/api/workspace/data/upload",
        files={
            "file": (
                "garbage.parquet",
                bad_payload,
                "application/octet-stream",
            ),
        },
    )
    assert r.status_code in (400, 422), r.text

    after = sorted(tmp_root.glob("lizystudio_*"))
    new_files = set(after) - set(before)
    assert not new_files, (
        f"corrupt upload leaked tempfile(s): {sorted(p.name for p in new_files)}"
    )


def test_repeated_uploads_track_independent_tempfiles(
    client: TestClient, tmp_path: Path
) -> None:
    """Two successful uploads in the same session must each be tracked
    so reset cleans both. Guards against a regression where the second
    upload overwrites the tracked-list entry for the first and leaves
    the original tempfile orphaned.
    """
    csv_path = _create_csv(tmp_path)
    paths: list[str] = []
    for _ in range(2):
        with csv_path.open("rb") as f:
            r = client.post(
                "/api/workspace/data/upload",
                files={"file": ("train.csv", f, "text/csv")},
            )
        assert r.status_code == 200
        paths.append(r.json()["data_ref"]["path"])

    # The second upload supersedes the first as the active dataframe,
    # but both tempfiles must still exist on disk pre-reset.
    assert paths[0] != paths[1], "uploads should mint distinct tempfiles"
    for p in paths:
        assert Path(p).exists(), f"upload tempfile vanished pre-reset: {p}"

    # reset() unlinks both tracked tempfiles.
    client.post("/api/workspace/reset")
    for p in paths:
        assert not Path(p).exists(), f"reset failed to unlink upload tempfile {p}"
