"""File browser API for selecting data files."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel

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
    """List directory contents, filtered to supported data file types."""
    dir_path = Path(path) if path else Path.home()
    dir_path = dir_path.resolve()

    if not dir_path.is_dir():
        return DirectoryListing(
            path=str(dir_path),
            parent=str(dir_path.parent) if dir_path.parent != dir_path else None,
            entries=[],
        )

    entries: list[FileEntry] = []
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
    except PermissionError:
        pass

    return DirectoryListing(
        path=str(dir_path),
        parent=str(dir_path.parent) if dir_path.parent != dir_path else None,
        entries=entries,
    )
