"""File browser API for selecting data files."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

import lizystudio.security as security

router = APIRouter()

SUPPORTED_EXTENSIONS = {".csv", ".parquet", ".tsv"}


class FileEntry(BaseModel):
    name: str
    type: str  # "file" or "directory"
    size: int | None
    extension: str | None


class DirectoryListing(BaseModel):
    path: str
    parent: str | None
    entries: list[FileEntry]


@router.get("", response_model=DirectoryListing)
def list_directory(
    path: str = Query(default="", description="Directory path to list"),
) -> DirectoryListing:
    """List directory contents, filtered to supported data file types.

    Issue #157: rejected requests (out-of-root traversal, missing
    directory, permission denied) do NOT echo the server-side
    resolved path back to the caller. Successful requests still
    return the resolved path/parent so the frontend can render
    breadcrumb navigation. The error-path response shape is kept
    (200 + empty entries + parent=None) for backward compatibility;
    only the leaked server path is sanitised.
    """
    dir_path = Path(path) if path else security.ALLOWED_FILES_ROOT
    dir_path = dir_path.resolve()

    # Restrict to allowed root. Failure: do NOT leak the resolved path
    # — return the original user-supplied form so the client can still
    # render an error without learning anything about the server's
    # filesystem.
    try:
        security.validate_path_within(dir_path, security.ALLOWED_FILES_ROOT)
    except ValueError:
        return DirectoryListing(path=path, parent=None, entries=[])

    if not dir_path.is_dir():
        # Missing directory: same policy as out-of-root. The resolved
        # parent would reveal where the root lives, so omit it.
        return DirectoryListing(path=path, parent=None, entries=[])

    entries: list[FileEntry] = []
    listing_failed = False
    try:

        def sort_key(p: Path) -> tuple[bool, str]:
            return (p.is_file(), p.name.lower())

        for item in sorted(dir_path.iterdir(), key=sort_key):
            if item.name.startswith("."):
                continue
            if item.is_dir():
                entries.append(
                    FileEntry(
                        name=item.name,
                        type="directory",
                        size=None,
                        extension=None,
                    )
                )
            elif item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS:
                entries.append(
                    FileEntry(
                        name=item.name,
                        type="file",
                        size=item.stat().st_size,
                        extension=item.suffix.lower(),
                    )
                )
    except OSError:
        # Issue #157: catch the full OSError family, not just
        # PermissionError. iterdir/stat/is_file can also raise
        # FileNotFoundError (race with deletion), NotADirectoryError,
        # and generic OSError (e.g. EIO on a failing mount). Letting
        # any of these propagate to FastAPI's 500 handler would
        # surface dir_path in the error response under some logging
        # configurations. The sanitised empty response mirrors the
        # other rejected-request paths.
        listing_failed = True

    if listing_failed:
        return DirectoryListing(path=path, parent=None, entries=[])

    return DirectoryListing(
        path=str(dir_path),
        parent=str(dir_path.parent) if dir_path.parent != dir_path else None,
        entries=entries,
    )
