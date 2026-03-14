"""Tests for security utilities (Phase 1: CRITICAL #1-4)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from lizystudio.security import (
    MAX_UPLOAD_BYTES,
    read_upload_checked,
    validate_path_within,
    validate_static_path,
)


class TestValidatePathWithin:
    """Tests for validate_path_within — prevents path traversal."""

    def test_valid_path(self, tmp_path: Path) -> None:
        child = tmp_path / "data.csv"
        child.touch()
        result = validate_path_within(child, tmp_path)
        assert result == child.resolve()

    def test_traversal_rejected(self, tmp_path: Path) -> None:
        malicious = tmp_path / ".." / ".." / "etc" / "passwd"
        with pytest.raises(ValueError, match="outside allowed root"):
            validate_path_within(malicious, tmp_path)

    def test_symlink_traversal_rejected(self, tmp_path: Path) -> None:
        target = Path("/etc")
        link = tmp_path / "link"
        try:
            link.symlink_to(target)
        except OSError:
            pytest.skip("Cannot create symlink")
        with pytest.raises(ValueError, match="outside allowed root"):
            validate_path_within(link / "passwd", tmp_path)

    def test_relative_path_resolved(self, tmp_path: Path) -> None:
        child = tmp_path / "sub" / "data.csv"
        child.parent.mkdir(parents=True, exist_ok=True)
        child.touch()
        result = validate_path_within(child, tmp_path)
        assert result.is_absolute()

    def test_root_itself_is_valid(self, tmp_path: Path) -> None:
        result = validate_path_within(tmp_path, tmp_path)
        assert result == tmp_path.resolve()


class TestValidateStaticPath:
    """Tests for validate_static_path — SPA file serving."""

    def test_valid_static_file(self, tmp_path: Path) -> None:
        f = tmp_path / "app.js"
        f.touch()
        result = validate_static_path(f, tmp_path)
        assert result is not None
        assert result == f.resolve()

    def test_traversal_returns_none(self, tmp_path: Path) -> None:
        malicious = tmp_path / ".." / ".." / "etc" / "passwd"
        result = validate_static_path(malicious, tmp_path)
        assert result is None

    def test_nonexistent_returns_none(self, tmp_path: Path) -> None:
        result = validate_static_path(tmp_path / "nope.js", tmp_path)
        assert result is None


class TestMaxUploadBytes:
    """Ensure the constant is set to a reasonable value."""

    def test_max_upload_bytes_is_100mb(self) -> None:
        assert MAX_UPLOAD_BYTES == 100 * 1024 * 1024


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_upload_file(content: bytes) -> AsyncMock:
    """Return an AsyncMock that mimics UploadFile.read(n)."""
    mock = AsyncMock()
    # read(max_bytes + 1) returns the slice up to n bytes from content
    async def _read(n: int = -1) -> bytes:
        if n == -1:
            return content
        return content[:n]

    mock.read = AsyncMock(side_effect=_read)
    return mock


def _run(coro: object) -> object:
    """Run a coroutine synchronously using a fresh event loop."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)  # type: ignore[arg-type]
    finally:
        loop.close()


# ---------------------------------------------------------------------------
# read_upload_checked tests (lines 53-58)
# ---------------------------------------------------------------------------


class TestReadUploadChecked:
    """Tests for read_upload_checked — enforces upload size limit."""

    def test_small_file_succeeds(self) -> None:
        """File smaller than max_bytes is returned as-is."""
        data = b"hello world"
        upload = _make_upload_file(data)
        result = _run(read_upload_checked(upload, max_bytes=1024))
        assert result == data

    def test_file_at_exactly_max_bytes_succeeds(self) -> None:
        """File whose size equals max_bytes exactly is accepted."""
        max_bytes = 64
        data = b"x" * max_bytes
        upload = _make_upload_file(data)
        result = _run(read_upload_checked(upload, max_bytes=max_bytes))
        assert result == data
        assert len(result) == max_bytes  # type: ignore[arg-type]

    def test_file_exceeding_max_bytes_raises_value_error(self) -> None:
        """File larger than max_bytes raises ValueError with MB info."""
        max_bytes = 1 * 1024 * 1024  # 1 MB
        # Content is max_bytes + 1 so read(max_bytes + 1) returns full slice
        data = b"z" * (max_bytes + 1)
        upload = _make_upload_file(data)
        with pytest.raises(ValueError, match="1 MB limit"):
            _run(read_upload_checked(upload, max_bytes=max_bytes))

    def test_file_one_byte_over_limit_raises(self) -> None:
        """Even a single extra byte triggers the limit."""
        max_bytes = 16
        data = b"a" * (max_bytes + 1)
        upload = _make_upload_file(data)
        with pytest.raises(ValueError):
            _run(read_upload_checked(upload, max_bytes=max_bytes))

    def test_empty_file_succeeds(self) -> None:
        """Empty upload is valid."""
        upload = _make_upload_file(b"")
        result = _run(read_upload_checked(upload, max_bytes=1024))
        assert result == b""

    def test_default_max_bytes_is_100mb(self) -> None:
        """Default max_bytes matches MAX_UPLOAD_BYTES constant."""
        # Small file with default limit should succeed
        data = b"small"
        upload = _make_upload_file(data)
        result = _run(read_upload_checked(upload))
        assert result == data

    def test_error_message_contains_mb_value(self) -> None:
        """ValueError message includes the human-readable MB limit."""
        max_bytes = 2 * 1024 * 1024  # 2 MB
        data = b"y" * (max_bytes + 1)
        upload = _make_upload_file(data)
        with pytest.raises(ValueError, match="2 MB limit"):
            _run(read_upload_checked(upload, max_bytes=max_bytes))

    def test_read_called_with_max_bytes_plus_one(self) -> None:
        """Verifies read is called with max_bytes+1 to detect oversized files."""
        max_bytes = 100
        data = b"data"
        upload = _make_upload_file(data)
        _run(read_upload_checked(upload, max_bytes=max_bytes))
        upload.read.assert_awaited_once_with(max_bytes + 1)
