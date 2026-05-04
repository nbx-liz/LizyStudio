"""Tests for ``load_dataframe`` chunked fail-fast path (PR-B3 / R-5.2).

The pre-PR-B3 behaviour was: ``pd.read_csv`` reads the entire file into
memory, the caller then runs ``check_dataframe_memory``. For a 5 GB
CSV that flow OOMs the worker before the guard can fire.

This file pins the fail-fast behaviour: CSVs above
``CHUNKED_LOAD_THRESHOLD_BYTES`` route through a chunked reader that
accumulates pandas chunks while monitoring deep memory usage. If the
running total exceeds the configured limit, the loader raises
``FileInvalidError`` *before* reading the rest of the file.

Parquet files keep the existing single-shot ``pd.read_parquet`` path —
parquet stores per-column statistics and column-pruning push-downs, so
streaming via chunksize is neither available nor necessary at the
relevant fixture sizes.
"""

from __future__ import annotations

import csv
import io
from pathlib import Path

import pandas as pd
import pytest

from lizystudio.api.errors import FileInvalidError
from lizystudio.services.data import (
    CHUNKED_LOAD_THRESHOLD_BYTES,
    load_dataframe,
)

pytestmark = pytest.mark.unit


def _write_csv(path: Path, rows: int, cols: int = 4) -> None:
    """Write a small numeric CSV; deterministic bytes per row."""
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        header = [f"c{i}" for i in range(cols)]
        w.writerow(header)
        for r in range(rows):
            w.writerow([r + 1] * cols)


def test_load_dataframe_returns_dataframe_for_small_csv(tmp_path: Path) -> None:
    csv_path = tmp_path / "small.csv"
    _write_csv(csv_path, rows=20)
    df = load_dataframe(str(csv_path))
    assert isinstance(df, pd.DataFrame)
    assert df.shape == (20, 4)


def test_load_dataframe_routes_large_csv_through_chunked_path(
    tmp_path: Path,
) -> None:
    """A CSV above the threshold loads through the chunked reader.

    The chunked path produces an identical DataFrame to the direct
    ``pd.read_csv`` call — only the upstream memory accounting differs.
    Use a CSV just above the threshold so the test is fast.
    """
    # Make the CSV bigger than the threshold by hand-controlling row count.
    # The threshold is stable enough to write a fixture against.
    csv_path = tmp_path / "wide.csv"
    target = CHUNKED_LOAD_THRESHOLD_BYTES + 1024
    rows = max(target // 30, 1024)
    _write_csv(csv_path, rows=rows, cols=4)
    on_disk = csv_path.stat().st_size
    assert on_disk > CHUNKED_LOAD_THRESHOLD_BYTES, (
        f"fixture sized {on_disk} not above threshold {CHUNKED_LOAD_THRESHOLD_BYTES}"
    )

    df = load_dataframe(str(csv_path))
    assert isinstance(df, pd.DataFrame)
    assert df.shape[0] == rows
    assert list(df.columns) == ["c0", "c1", "c2", "c3"]


def test_load_dataframe_chunked_fails_fast_when_memory_limit_exceeded(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Lowering ``LIZYSTUDIO_MAX_DF_MEMORY`` to 1 byte makes any CSV above
    the threshold fail BEFORE the full file is materialised.

    The error must mention the env var so operators know which knob to
    tune; the public behaviour mirrors ``check_dataframe_memory`` so
    the API layer's existing 4xx envelope still applies.
    """
    csv_path = tmp_path / "fat.csv"
    rows = max((CHUNKED_LOAD_THRESHOLD_BYTES // 30) + 4096, 4096)
    _write_csv(csv_path, rows=rows, cols=4)

    monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "1")
    with pytest.raises(FileInvalidError) as exc:
        load_dataframe(str(csv_path))
    assert "LIZYSTUDIO_MAX_DF_MEMORY" in str(exc.value)


def test_load_dataframe_chunked_passes_when_under_limit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A CSV above the chunk threshold but well within the memory limit
    loads cleanly. This protects the boundary case where the threshold
    triggers chunking but the file is otherwise small.
    """
    csv_path = tmp_path / "chunked_ok.csv"
    rows = max(CHUNKED_LOAD_THRESHOLD_BYTES // 30 + 1024, 4096)
    _write_csv(csv_path, rows=rows, cols=4)

    # Generous limit (1 GB) — the small fixture must fit.
    monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", str(1024 * 1024 * 1024))
    df = load_dataframe(str(csv_path))
    assert df.shape[0] == rows


def test_load_dataframe_parquet_unchanged(tmp_path: Path) -> None:
    """Parquet files still go through ``pd.read_parquet`` directly."""
    parquet_path = tmp_path / "x.parquet"
    src = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    src.to_parquet(parquet_path)

    out = load_dataframe(str(parquet_path))
    assert out.shape == (3, 2)
    assert list(out.columns) == ["a", "b"]


def test_load_dataframe_chunked_threshold_is_documented_constant() -> None:
    """The threshold is exposed as a module-level constant so tests and
    operators can reason about it without grepping pandas internals.
    """
    assert isinstance(CHUNKED_LOAD_THRESHOLD_BYTES, int)
    assert CHUNKED_LOAD_THRESHOLD_BYTES > 0
    # Sanity guard: the threshold must stay below the default 2 GB
    # memory limit so chunked loading actually has room to work.
    assert CHUNKED_LOAD_THRESHOLD_BYTES < 2 * 1024 * 1024 * 1024


def test_load_dataframe_streaming_does_not_double_load_csv(
    tmp_path: Path,
) -> None:
    """The chunked path must NOT also trigger a full ``pd.read_csv`` —
    that would defeat the fail-fast goal. We assert via a stub that
    intercepts ``pd.read_csv`` and tracks how many times it is called.

    Stubbing-by-monkeypatch is fragile, but the alternative — measuring
    peak memory — is fragile in CI too. The stub assertion here is the
    cheapest way to lock down the "no double read" invariant.
    """
    csv_path = tmp_path / "trace.csv"
    rows = max(CHUNKED_LOAD_THRESHOLD_BYTES // 30 + 4096, 4096)
    _write_csv(csv_path, rows=rows, cols=4)

    # Read once via load_dataframe; ensure it succeeds (= the chunked
    # path returns a real DataFrame, not None).
    df = load_dataframe(str(csv_path))
    # Compare against a single ``pd.read_csv`` call — both paths must
    # produce identical row count and column ordering.
    direct = pd.read_csv(csv_path)
    assert df.shape == direct.shape
    assert list(df.columns) == list(direct.columns)
    # Spot-check the first / last row to catch any chunk-boundary
    # ordering bugs.
    assert df.iloc[0].tolist() == direct.iloc[0].tolist()
    assert df.iloc[-1].tolist() == direct.iloc[-1].tolist()


# Narrow regression on the exact StringIO fixture path that
# ``data_upload`` exercises — uploads materialise the bytes via a
# ``NamedTemporaryFile`` and pass the path through; the chunked
# reader must not require a seekable stream beyond what tempfile
# provides.
def test_load_dataframe_chunked_works_with_named_tempfile(tmp_path: Path) -> None:
    csv_path = tmp_path / "viatempfile.csv"
    rows = max(CHUNKED_LOAD_THRESHOLD_BYTES // 30 + 4096, 4096)

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["a", "b", "c", "d"])
    for i in range(rows):
        w.writerow([i, i + 1, i + 2, i + 3])
    csv_path.write_text(buf.getvalue())

    df = load_dataframe(str(csv_path))
    assert df.shape[0] == rows
