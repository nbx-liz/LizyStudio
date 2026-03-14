"""Tests for the file browser API endpoint (GET /api/files)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_dir(base: Path, name: str) -> Path:
    """Create a subdirectory under *base* and return it."""
    d = base / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def _make_file(directory: Path, name: str, content: bytes = b"data") -> Path:
    """Create a file in *directory* with the given *content* and return its path."""
    p = directory / name
    p.write_bytes(content)
    return p


# ---------------------------------------------------------------------------
# 1. Default path (no query param) — lists files in ALLOWED_FILES_ROOT
# ---------------------------------------------------------------------------


def test_default_path_returns_allowed_root(client: TestClient, tmp_path: Path) -> None:
    """When no path query param is provided the response path equals ALLOWED_FILES_ROOT."""
    import lizystudio.security as sec

    response = client.get("/api/files")
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(sec.ALLOWED_FILES_ROOT)


def test_default_path_empty_query_string(client: TestClient, tmp_path: Path) -> None:
    """Passing path= (empty string) behaves identically to omitting the param."""
    import lizystudio.security as sec

    response = client.get("/api/files?path=")
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(sec.ALLOWED_FILES_ROOT)


def test_default_path_lists_entries_in_root(client: TestClient, tmp_path: Path) -> None:
    """Files placed directly in ALLOWED_FILES_ROOT appear in the listing."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    _make_file(root, "sample.csv")

    response = client.get("/api/files")
    assert response.status_code == 200
    names = [e["name"] for e in response.json()["entries"]]
    assert "sample.csv" in names


# ---------------------------------------------------------------------------
# 2. Valid subdirectory path
# ---------------------------------------------------------------------------


def test_valid_subdirectory_returns_its_entries(client: TestClient, tmp_path: Path) -> None:
    """Requesting a valid subdirectory returns entries contained within it."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "datasets")
    _make_file(subdir, "train.csv")
    _make_file(subdir, "test.parquet")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(subdir)
    names = {e["name"] for e in body["entries"]}
    assert names == {"train.csv", "test.parquet"}


def test_valid_subdirectory_parent_is_set(client: TestClient, tmp_path: Path) -> None:
    """The parent field of a subdirectory listing points to the parent directory."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "nested")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    body = response.json()
    assert body["parent"] == str(root)


# ---------------------------------------------------------------------------
# 3. Path traversal attempt — should return empty entries
# ---------------------------------------------------------------------------


def test_path_traversal_returns_empty_entries(client: TestClient) -> None:
    """A path traversal attempt (../../etc) results in an empty entries list."""
    response = client.get("/api/files?path=../../etc")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []


def test_path_traversal_absolute_outside_root(client: TestClient) -> None:
    """An absolute path outside ALLOWED_FILES_ROOT returns empty entries."""
    response = client.get("/api/files?path=/etc/passwd")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []


def test_path_traversal_parent_is_none(client: TestClient) -> None:
    """When a traversal is blocked the parent field is None (no navigation context)."""
    response = client.get("/api/files?path=../../etc")
    assert response.status_code == 200
    body = response.json()
    assert body["parent"] is None


# ---------------------------------------------------------------------------
# 4. Non-existent directory — should return empty entries
# ---------------------------------------------------------------------------


def test_nonexistent_directory_returns_empty_entries(client: TestClient, tmp_path: Path) -> None:
    """Requesting a path that does not exist returns an empty entries list."""
    import lizystudio.security as sec

    missing = sec.ALLOWED_FILES_ROOT / "does_not_exist_xyz"
    response = client.get(f"/api/files?path={missing}")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []


def test_nonexistent_directory_path_in_response(client: TestClient, tmp_path: Path) -> None:
    """The path field reflects the requested (resolved) path even when it doesn't exist."""
    import lizystudio.security as sec

    missing = sec.ALLOWED_FILES_ROOT / "no_such_dir"
    response = client.get(f"/api/files?path={missing}")
    assert response.status_code == 200
    body = response.json()
    assert body["path"] == str(missing.resolve())


def test_nonexistent_directory_has_parent(client: TestClient, tmp_path: Path) -> None:
    """A non-existent path still reports its parent directory."""
    import lizystudio.security as sec

    missing = sec.ALLOWED_FILES_ROOT / "ghost_dir"
    response = client.get(f"/api/files?path={missing}")
    assert response.status_code == 200
    body = response.json()
    assert body["parent"] == str(missing.parent.resolve())


# ---------------------------------------------------------------------------
# 5. File extension filtering — supported shown, unsupported hidden
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename", ["data.csv", "archive.parquet", "raw.tsv"])
def test_supported_extensions_are_included(
    client: TestClient, tmp_path: Path, filename: str
) -> None:
    """Files with supported extensions (.csv, .parquet, .tsv) appear in entries."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, f"ext_test_{filename.split('.')[1]}")
    _make_file(subdir, filename)

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    names = [e["name"] for e in response.json()["entries"]]
    assert filename in names


@pytest.mark.parametrize(
    "filename",
    ["model.pkl", "notes.txt", "image.png", "archive.zip", "script.py"],
)
def test_unsupported_extensions_are_excluded(
    client: TestClient, tmp_path: Path, filename: str
) -> None:
    """Files with unsupported extensions are hidden from the listing."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    ext = filename.rsplit(".", 1)[1]
    subdir = _make_dir(root, f"unsupported_{ext}")
    _make_file(subdir, filename)

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    names = [e["name"] for e in response.json()["entries"]]
    assert filename not in names


def test_extension_check_is_case_insensitive(client: TestClient, tmp_path: Path) -> None:
    """File extension matching ignores case (e.g., .CSV and .Parquet are valid)."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "case_ext")
    _make_file(subdir, "upper.CSV")
    _make_file(subdir, "mixed.Parquet")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    names = {e["name"] for e in response.json()["entries"]}
    assert "upper.CSV" in names
    assert "mixed.Parquet" in names


def test_file_entry_reports_correct_extension(client: TestClient, tmp_path: Path) -> None:
    """Each file entry's extension field matches the actual file suffix (lowercased)."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "ext_field")
    _make_file(subdir, "dataset.CSV", content=b"a,b\n1,2\n")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entry = next(e for e in response.json()["entries"] if e["name"] == "dataset.CSV")
    assert entry["extension"] == ".csv"


def test_file_entry_reports_size(client: TestClient, tmp_path: Path) -> None:
    """Each file entry's size field reflects the actual byte count of the file."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "size_check")
    content = b"col1,col2\n1,2\n3,4\n"
    _make_file(subdir, "sized.csv", content=content)

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entry = next(e for e in response.json()["entries"] if e["name"] == "sized.csv")
    assert entry["size"] == len(content)


# ---------------------------------------------------------------------------
# 6. Hidden files (starting with .) are excluded
# ---------------------------------------------------------------------------


def test_hidden_files_are_excluded(client: TestClient, tmp_path: Path) -> None:
    """Files whose names start with '.' are not included in the listing."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "hidden_files")
    _make_file(subdir, ".hidden.csv")
    _make_file(subdir, "visible.csv")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    names = [e["name"] for e in response.json()["entries"]]
    assert ".hidden.csv" not in names
    assert "visible.csv" in names


def test_hidden_directories_are_excluded(client: TestClient, tmp_path: Path) -> None:
    """Directories whose names start with '.' are not included in the listing."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "hidden_dirs")
    _make_dir(subdir, ".git")
    _make_dir(subdir, "data")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    names = [e["name"] for e in response.json()["entries"]]
    assert ".git" not in names
    assert "data" in names


# ---------------------------------------------------------------------------
# 7. Directories are listed with type "directory"
# ---------------------------------------------------------------------------


def test_subdirectory_entry_has_type_directory(client: TestClient, tmp_path: Path) -> None:
    """Subdirectory entries report type='directory'."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "type_check")
    _make_dir(subdir, "nested_dir")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entries = {e["name"]: e for e in response.json()["entries"]}
    assert entries["nested_dir"]["type"] == "directory"


def test_directory_entry_has_no_size_or_extension(client: TestClient, tmp_path: Path) -> None:
    """Directory entries have size=None and extension=None."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "dir_fields")
    _make_dir(subdir, "sub")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entries = {e["name"]: e for e in response.json()["entries"]}
    assert entries["sub"]["size"] is None
    assert entries["sub"]["extension"] is None


def test_file_entry_has_type_file(client: TestClient, tmp_path: Path) -> None:
    """File entries report type='file'."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "file_type_check")
    _make_file(subdir, "records.csv")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entries = {e["name"]: e for e in response.json()["entries"]}
    assert entries["records.csv"]["type"] == "file"


# ---------------------------------------------------------------------------
# 8. Sort order — directories before files, then alphabetical within each group
# ---------------------------------------------------------------------------


def test_directories_listed_before_files(client: TestClient, tmp_path: Path) -> None:
    """Directories appear before files in the returned entries list."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "sort_order")
    _make_file(subdir, "aardvark.csv")
    _make_dir(subdir, "zebra_dir")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entries = response.json()["entries"]
    types = [e["type"] for e in entries]
    # All directories should precede all files
    seen_file = False
    for t in types:
        if t == "file":
            seen_file = True
        if seen_file and t == "directory":
            pytest.fail("A directory appeared after a file in the listing")


# ---------------------------------------------------------------------------
# 9. Response schema completeness
# ---------------------------------------------------------------------------


def test_response_schema_has_required_fields(client: TestClient, tmp_path: Path) -> None:
    """Every response contains path, parent, and entries fields."""
    response = client.get("/api/files")
    assert response.status_code == 200
    body = response.json()
    assert "path" in body
    assert "parent" in body
    assert "entries" in body


def test_file_entry_schema_has_required_fields(client: TestClient, tmp_path: Path) -> None:
    """Every file entry contains name, type, size, and extension fields."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    subdir = _make_dir(root, "schema_check")
    _make_file(subdir, "check.csv")

    response = client.get(f"/api/files?path={subdir}")
    assert response.status_code == 200
    entry = response.json()["entries"][0]
    assert "name" in entry
    assert "type" in entry
    assert "size" in entry
    assert "extension" in entry


def test_empty_directory_returns_empty_entries_list(client: TestClient, tmp_path: Path) -> None:
    """An existing empty directory returns an empty entries list (not null)."""
    import lizystudio.security as sec

    root = sec.ALLOWED_FILES_ROOT
    empty_dir = _make_dir(root, "totally_empty")

    response = client.get(f"/api/files?path={empty_dir}")
    assert response.status_code == 200
    body = response.json()
    assert body["entries"] == []
    assert isinstance(body["entries"], list)
