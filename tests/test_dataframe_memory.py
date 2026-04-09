"""Tests for DataFrame memory limit check (H-0038).

Verifies that oversized DataFrames (after decompression) are rejected,
and that memory_usage_bytes is reported in data load responses.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

from lizystudio.api.errors import FileInvalidError
from lizystudio.security import check_dataframe_memory

pytestmark = pytest.mark.unit


class TestCheckDataframeMemory:
    """Unit tests for check_dataframe_memory."""

    def test_small_dataframe_passes(self) -> None:
        """A small DataFrame should not raise."""
        df = pd.DataFrame({"a": [1, 2, 3]})
        # Should not raise
        check_dataframe_memory(df, max_bytes=1024 * 1024)

    def test_large_dataframe_raises(self) -> None:
        """A DataFrame exceeding max_bytes should raise FileInvalidError."""
        # Create a large-ish DataFrame (~800KB of strings)
        df = pd.DataFrame({"text": ["x" * 1000] * 1000})
        mem = df.memory_usage(deep=True).sum()
        # Set limit below actual usage
        with pytest.raises(FileInvalidError, match="memory"):
            check_dataframe_memory(df, max_bytes=int(mem) - 1)

    def test_exact_limit_passes(self) -> None:
        """A DataFrame at exactly the limit should pass."""
        df = pd.DataFrame({"a": [1, 2, 3]})
        mem = df.memory_usage(deep=True).sum()
        # Should not raise
        check_dataframe_memory(df, max_bytes=int(mem))

    def test_error_message_contains_sizes(self) -> None:
        """Error message should include both memory usage and limit."""
        df = pd.DataFrame({"text": ["x" * 1000] * 100})
        with pytest.raises(FileInvalidError) as exc_info:
            check_dataframe_memory(df, max_bytes=1024)
        msg = exc_info.value.message
        assert "MB" in msg

    def test_default_limit_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """LIZYSTUDIO_MAX_DF_MEMORY env var should be respected."""
        monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "1024")
        # Re-import to pick up env var
        from lizystudio.security import get_max_df_memory

        assert get_max_df_memory() == 1024

    def test_default_limit_is_2gb(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Default memory limit should be 2GB."""
        monkeypatch.delenv("LIZYSTUDIO_MAX_DF_MEMORY", raising=False)
        from lizystudio.security import get_max_df_memory

        assert get_max_df_memory() == 2 * 1024 * 1024 * 1024

    def test_negative_limit_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Negative memory limit should raise ValueError."""
        monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "-1")
        from lizystudio.security import get_max_df_memory

        with pytest.raises(ValueError, match="positive"):
            get_max_df_memory()

    def test_zero_limit_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Zero memory limit should raise ValueError."""
        monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "0")
        from lizystudio.security import get_max_df_memory

        with pytest.raises(ValueError, match="positive"):
            get_max_df_memory()

    def test_non_integer_limit_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Non-integer memory limit should raise ValueError."""
        monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "abc")
        from lizystudio.security import get_max_df_memory

        with pytest.raises(ValueError, match="integer"):
            get_max_df_memory()


class TestDataLoadMemoryCheck:
    """Integration tests: data load endpoints should check memory."""

    @pytest.fixture()
    def csv_file(self, tmp_path: Path) -> Path:
        """Create a small CSV file."""
        p = tmp_path / "data.csv"
        df = pd.DataFrame({"x": range(10), "y": range(10)})
        df.to_csv(p, index=False)
        return p

    def test_data_load_path_includes_memory_usage(
        self,
        client: pytest.fixture,
        csv_file: Path,  # type: ignore[type-arg]
    ) -> None:
        """data/path response should include memory_usage_bytes."""
        resp = client.post("/api/workspace/data/path", json={"path": str(csv_file)})
        assert resp.status_code == 200
        data = resp.json()
        assert "memory_usage_bytes" in data
        assert isinstance(data["memory_usage_bytes"], int)
        assert data["memory_usage_bytes"] > 0

    def test_data_upload_includes_memory_usage(
        self,
        client: pytest.fixture,
        csv_file: Path,  # type: ignore[type-arg]
    ) -> None:
        """data/upload response should include memory_usage_bytes."""
        with open(csv_file, "rb") as f:
            resp = client.post(
                "/api/workspace/data/upload",
                files={"file": ("data.csv", f, "text/csv")},
            )
        assert resp.status_code == 200
        data = resp.json()
        assert "memory_usage_bytes" in data
        assert isinstance(data["memory_usage_bytes"], int)
        assert data["memory_usage_bytes"] > 0

    def test_data_load_rejects_oversized_dataframe(
        self,
        client: pytest.fixture,  # type: ignore[type-arg]
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Data loading should reject a DataFrame that exceeds memory limit."""
        # Create a CSV, then set a very small memory limit
        p = tmp_path / "big.csv"
        df = pd.DataFrame({"text": ["x" * 100] * 100})
        df.to_csv(p, index=False)
        # Set limit to 1 byte to force rejection
        monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "1")
        resp = client.post("/api/workspace/data/path", json={"path": str(p)})
        assert resp.status_code == 400
        assert resp.json()["error"]["code"] == "FILE_INVALID"
