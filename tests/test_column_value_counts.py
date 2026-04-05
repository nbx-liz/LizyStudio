"""Unit tests for get_column_value_counts service function (H-0046)."""

from __future__ import annotations

import pandas as pd
import pytest

from lizystudio.services.data import get_column_value_counts


def test_basic_value_counts() -> None:
    df = pd.DataFrame({"color": ["red", "blue", "red", "green", "blue", "red"]})
    stats = get_column_value_counts(df, "color")
    assert stats.name == "color"
    assert stats.total_count == 6
    assert stats.unique_count == 3
    assert stats.null_count == 0
    # red=3, blue=2, green=1
    counts = {vc.value: vc.count for vc in stats.value_counts}
    assert counts["red"] == 3
    assert counts["blue"] == 2
    assert counts["green"] == 1


def test_with_nulls() -> None:
    df = pd.DataFrame({"x": [1, 2, None, 1, None]})
    stats = get_column_value_counts(df, "x")
    assert stats.null_count == 2
    assert stats.total_count == 5
    assert stats.unique_count == 2


def test_top_n_with_other() -> None:
    df = pd.DataFrame({"letter": list("aabbbcccddddeeeee")})
    stats = get_column_value_counts(df, "letter", top_n=2)
    values = [vc.value for vc in stats.value_counts]
    # Top 2 + __other__
    assert len(stats.value_counts) == 3
    assert "__other__" in values


def test_top_n_no_other_when_within_limit() -> None:
    df = pd.DataFrame({"x": ["a", "b", "c"]})
    stats = get_column_value_counts(df, "x", top_n=10)
    values = [vc.value for vc in stats.value_counts]
    assert "__other__" not in values


def test_column_not_found() -> None:
    df = pd.DataFrame({"a": [1, 2, 3]})
    with pytest.raises(KeyError, match="Column 'missing'"):
        get_column_value_counts(df, "missing")


def test_empty_dataframe() -> None:
    df = pd.DataFrame({"x": pd.Series([], dtype="float64")})
    stats = get_column_value_counts(df, "x")
    assert stats.total_count == 0
    assert stats.unique_count == 0
    assert len(stats.value_counts) == 0
