"""Generator for the wide-DataFrame fixture (Issue #361 / P-0097).

Builds a synthetic 10,000-column × 1,000-row CSV at
``tests/fixtures/lizyml/wide/data.csv`` so the backend stress tests
and frontend e2e specs can exercise the wide-DataFrame code path
without committing a 50MB CSV into git.

Run on demand from the repo root::

    uv run python tests/fixtures/lizyml/wide/generate.py

The output file is gitignored (see ``tests/fixtures/lizyml/wide/.gitignore``)
so each contributor regenerates it locally. CI generates it once at
job start via the same script.

Schema:

- 1 binary target column ``target_class`` (int 0/1)
- 9,999 numeric feature columns ``f_00001`` .. ``f_09999``
- 1,000 rows so the file is large enough to exercise streaming /
  pagination paths but small enough to keep ``ruff``-checked
  generators near-instant
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

N_ROWS = 1_000
N_FEATURES = 9_999  # 9999 features + 1 target = 10_000 columns


def main() -> None:
    out = Path(__file__).resolve().parent / "data.csv"
    rng = np.random.default_rng(seed=42)

    # Independent gaussian features keep generation cheap.
    data = rng.standard_normal((N_ROWS, N_FEATURES)).astype(np.float32)
    feature_names = [f"f_{i:05d}" for i in range(1, N_FEATURES + 1)]

    df = pd.DataFrame(data, columns=feature_names)
    # Mild signal in feature 0 + 1 to keep fits meaningful. Logistic
    # decision boundary so target = 1 / (1 + exp(-(0.5*f_00001 + 0.3*f_00002))) > 0.5.
    logits = 0.5 * df["f_00001"] + 0.3 * df["f_00002"]
    df["target_class"] = (logits > logits.median()).astype(int)

    df.to_csv(out, index=False)
    print(
        f"wrote {out} ({df.shape[0]} rows × {df.shape[1]} cols, "
        f"{out.stat().st_size / (1024 * 1024):.1f}MB)",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
