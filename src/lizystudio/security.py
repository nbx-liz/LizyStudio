"""Centralized security utilities for path validation and upload limits."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import UploadFile

# Maximum upload size: 100 MB
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Allowed root for file browser and data paths (configurable via env)
ALLOWED_FILES_ROOT = Path(
    os.environ.get("LIZYSTUDIO_FILES_ROOT", str(Path.home()))
).resolve()


def validate_path_within(path: Path, allowed_root: Path) -> Path:
    """Resolve *path* and assert it is within *allowed_root*.

    Raises ``ValueError`` if the resolved path escapes the root.
    """
    resolved = path.resolve()
    root = allowed_root.resolve()
    if not (resolved == root or str(resolved).startswith(str(root) + os.sep)):
        msg = f"Path {resolved} is outside allowed root {root}"
        raise ValueError(msg)
    return resolved


def validate_static_path(path: Path, static_dir: Path) -> Path | None:
    """Resolve *path* and return it if it is a file within *static_dir*.

    Returns ``None`` if the path escapes the directory or does not exist.
    """
    resolved = path.resolve()
    root = static_dir.resolve()
    if not (resolved == root or str(resolved).startswith(str(root) + os.sep)):
        return None
    if not resolved.is_file():
        return None
    return resolved


async def read_upload_checked(
    file: UploadFile, max_bytes: int = MAX_UPLOAD_BYTES
) -> bytes:
    """Read an uploaded file with a size limit.

    Raises ``ValueError`` if the file exceeds *max_bytes*.
    """
    content = await file.read(max_bytes + 1)
    if len(content) > max_bytes:
        mb = max_bytes // (1024 * 1024)
        msg = f"File exceeds {mb} MB limit"
        raise ValueError(msg)
    return content
