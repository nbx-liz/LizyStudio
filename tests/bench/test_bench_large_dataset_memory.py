"""Memory + response-time bench for large datasets (Issue #383 (g) / #27 (g)).

Skipped by default (``addopts = "... --benchmark-skip"``); the bench
workflow runs this file with ``--benchmark-only`` and surfaces both:

- Wall-time per request for ``data/preview``, ``data/columns``, and
  ``data/describe`` against a 100k-row CSV staged in-memory.
- A guard assertion that the loaded DataFrame's deep memory usage stays
  under ``LIZYSTUDIO_MAX_DF_MEMORY`` — a regression that bloats the
  underlying dtype (e.g. accidental ``object`` numeric columns) would
  push past the limit and surface here before users ever see it.

The dataset is the same 100k-row binary fixture
(``synthetic_binary_csv``) that the lizyml fit bench uses, so the bench
job's setup cost is amortised across both files.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from lizystudio.security import check_dataframe_memory, get_max_df_memory
from lizystudio.services.data import get_describe, get_preview, load_dataframe

pytestmark = pytest.mark.bench


# ---------------------------------------------------------------------------
# Memory invariants — these run synchronously and are NOT timed; they exist
# to catch shape regressions independent of the response-time bench cells.
# ---------------------------------------------------------------------------


def test_large_dataset_memory_under_default_limit(
    synthetic_binary_csv: Path,
) -> None:
    """The 100k-row fixture must fit comfortably under the 2 GB default.

    A failure here would mean either the fixture's column dtypes
    regressed (e.g. categorical → object) or the default limit was
    lowered. Both are real bugs, not benchmark noise.
    """
    df = load_dataframe(str(synthetic_binary_csv))
    used = check_dataframe_memory(df)
    limit = get_max_df_memory()
    # Sanity: 100k rows × 12 columns of mixed numeric/category should
    # stay well under 100 MB on disk and even less in memory after
    # pandas dtype inference. The 100 MB ceiling here gives plenty of
    # headroom for future fixture growth without masking real bloat.
    assert used < 100 * 1024 * 1024, (
        f"100k-row fixture used {used / (1024 * 1024):.1f} MB — "
        f"investigate column dtypes for object-vs-numeric regressions"
    )
    assert used < limit


def test_memory_guard_rejects_oversized_dataframe(
    synthetic_binary_csv: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fail-fast guard must trip when the configured limit is small.

    Lowering ``LIZYSTUDIO_MAX_DF_MEMORY`` to 1 byte simulates an
    operator-imposed cap; the 100k-row fixture must be rejected with a
    clear ``FileInvalidError`` mentioning the env var.
    """
    from lizystudio.api.errors import FileInvalidError

    monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", "1")
    df = load_dataframe(str(synthetic_binary_csv))
    with pytest.raises(FileInvalidError) as exc:
        check_dataframe_memory(df)
    msg = str(exc.value)
    assert "LIZYSTUDIO_MAX_DF_MEMORY" in msg, (
        f"guard error must point at the env var: {msg!r}"
    )


# ---------------------------------------------------------------------------
# Response-time benches — surface latency baselines for the preview/
# columns/describe paths under ``--benchmark-only``. Each measures a
# pure-function call so jitter from FastAPI / TestClient overhead does
# not contaminate the bench numbers.
# ---------------------------------------------------------------------------


def test_bench_preview_100k(
    benchmark: Any,
    synthetic_binary_csv: Path,
) -> None:
    """``get_preview`` baseline on the 100k-row fixture."""
    df = load_dataframe(str(synthetic_binary_csv))
    benchmark.pedantic(
        lambda: get_preview(df, rows=50),
        rounds=5,
        warmup_rounds=1,
    )


def test_bench_describe_100k(
    benchmark: Any,
    synthetic_binary_csv: Path,
) -> None:
    """``get_describe`` baseline on the 100k-row fixture."""
    df = load_dataframe(str(synthetic_binary_csv))
    benchmark.pedantic(
        lambda: get_describe(df),
        rounds=5,
        warmup_rounds=1,
    )


def test_bench_load_csv_100k(
    benchmark: Any,
    synthetic_binary_csv: Path,
) -> None:
    """``load_dataframe`` baseline on the 100k-row fixture.

    This is the cold-path (no cache) read that the upload route runs
    immediately before the memory guard. A regression here drives both
    upload latency and the worst-case 5xx envelope when an oversize
    file slips through.
    """
    benchmark.pedantic(
        lambda: load_dataframe(str(synthetic_binary_csv)),
        rounds=3,
        warmup_rounds=1,
    )


# ---------------------------------------------------------------------------
# Smoke: the env var honoured at process boundary too. Independent of
# the bench harness so a misconfigured CI runner still fails clearly.
# ---------------------------------------------------------------------------


def test_get_max_df_memory_honours_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clear env-var-overrides round-trip via ``get_max_df_memory``."""
    monkeypatch.setenv("LIZYSTUDIO_MAX_DF_MEMORY", str(7 * 1024 * 1024))
    assert get_max_df_memory() == 7 * 1024 * 1024
    monkeypatch.delenv("LIZYSTUDIO_MAX_DF_MEMORY", raising=False)
    assert get_max_df_memory() == 2 * 1024 * 1024 * 1024  # default 2 GB


__all__: list[str] = []  # discourage import-as-library; this is bench-only
