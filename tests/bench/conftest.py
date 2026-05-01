"""Bench fixtures (Issue #27 (a) / P-0094).

Synthetic dataset and a minimal LizyML config tuned for fast bench
iterations rather than realistic accuracy. Session scope so the
100k-row CSV is generated once per pytest invocation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from lizystudio.backends.lizyml import LizyMLAdapter

# 100k rows is large enough to exercise lizyml's fit pipeline (CV split,
# preprocess, train per fold) without dominating CI time.
_N_ROWS = 100_000
# 50 trees per fold tuned for ~5–10s wall time on a GitHub-hosted runner;
# the baseline number is what we track for regression, not absolute
# model quality.
_N_ESTIMATORS = 50
_N_NUMERIC = 10
_RNG_SEED = 42


@pytest.fixture(scope="session")
def synthetic_binary_csv(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Build a 100k-row binary-classification CSV once per session."""
    rng = np.random.default_rng(_RNG_SEED)
    cols: dict[str, Any] = {
        f"num_{i}": rng.standard_normal(_N_ROWS) for i in range(_N_NUMERIC)
    }
    cols["cat_0"] = rng.choice(list("ABC"), size=_N_ROWS)
    cols["cat_1"] = rng.choice(["X", "Y"], size=_N_ROWS)
    # 50/50 balanced binary target.
    cols["y"] = rng.integers(0, 2, size=_N_ROWS)
    df = pd.DataFrame(cols)

    out = tmp_path_factory.mktemp("bench_data") / "synthetic_100k.csv"
    df.to_csv(out, index=False)
    return out


@pytest.fixture(scope="session")
def lizyml_binary_config() -> dict[str, Any]:
    """LizyML config: binary task, n_estimators capped for CI speed."""
    adapter = LizyMLAdapter()
    config = adapter.get_default_config(task="binary", target="y")
    model_cfg = config.setdefault("model", {})
    params = model_cfg.setdefault("params", {})
    params["n_estimators"] = _N_ESTIMATORS
    # Drop tuning if present — bench measures a single fit, no Optuna.
    config.pop("tuning", None)
    return config
