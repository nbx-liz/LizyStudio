"""LizyML fit microbench (Issue #27 (a) / P-0094).

100k-row synthetic CSV → LizyMLAdapter.create_model → adapter.fit().
The benchmark fixture measures ``adapter.fit`` per round; ``setup``
creates a fresh model instance each round because ``fit()`` mutates
the model in-place.

Skipped by default (``addopts = "... --benchmark-skip"``); the nightly
workflow runs this file with ``--benchmark-only`` and uploads the JSON
output as an artefact for manual inspection / future regression
detection.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from lizystudio.backends.lizyml import LizyMLAdapter

pytestmark = pytest.mark.bench


def test_bench_lizyml_fit_100k(
    benchmark: Any,
    synthetic_binary_csv: Path,
    lizyml_binary_config: dict[str, Any],
) -> None:
    """Measure one LizyML fit cycle on 100k synthetic rows.

    ``rounds=3, warmup_rounds=1`` — enough samples for mean/stddev
    while keeping the bench job under ~30 s wall time on a
    GitHub-hosted runner.
    """
    adapter = LizyMLAdapter()
    df = pd.read_csv(synthetic_binary_csv)

    def setup() -> tuple[tuple[Any, ...], dict[str, Any]]:
        model = adapter.create_model(lizyml_binary_config, df)
        return (model,), {}

    benchmark.pedantic(adapter.fit, setup=setup, rounds=3, warmup_rounds=1)
