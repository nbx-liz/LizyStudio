"""Centralized security utilities for path validation and upload limits."""

from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from fastapi import UploadFile

from lizystudio.api.errors import FileInvalidError

# Maximum upload size: 100 MB
MAX_UPLOAD_BYTES = 100 * 1024 * 1024

# Default DataFrame memory limit: 2 GB
_DEFAULT_MAX_DF_MEMORY = 2 * 1024 * 1024 * 1024


def get_max_df_memory() -> int:
    """Return the maximum allowed DataFrame memory in bytes.

    Configurable via ``LIZYSTUDIO_MAX_DF_MEMORY`` environment variable.
    """
    raw = os.environ.get("LIZYSTUDIO_MAX_DF_MEMORY")
    if raw is not None:
        try:
            value = int(raw)
        except ValueError:
            msg = f"LIZYSTUDIO_MAX_DF_MEMORY must be an integer, got: {raw!r}"
            raise ValueError(msg) from None
        if value <= 0:
            msg = f"LIZYSTUDIO_MAX_DF_MEMORY must be positive, got: {value}"
            raise ValueError(msg)
        return value
    return _DEFAULT_MAX_DF_MEMORY


def check_dataframe_memory(df: pd.DataFrame, max_bytes: int | None = None) -> int:
    """Check if DataFrame memory usage exceeds the limit (H-0038).

    Returns the memory usage in bytes if within limits.
    Raises ``FileInvalidError`` if the limit is exceeded.
    """
    if max_bytes is None:
        max_bytes = get_max_df_memory()
    mem = int(df.memory_usage(deep=True).sum())
    if mem > max_bytes:
        mem_mb = mem / (1024 * 1024)
        limit_mb = max_bytes / (1024 * 1024)
        raise FileInvalidError(
            f"DataFrame memory usage ({mem_mb:.1f} MB) "
            f"exceeds limit ({limit_mb:.1f} MB). "
            f"Set LIZYSTUDIO_MAX_DF_MEMORY to increase."
        )
    return mem


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
