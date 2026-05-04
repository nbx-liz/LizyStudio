"""Integration tests for the fit -> save -> load round-trip (P-0095).

Issue #346 Phase C. Each scenario runs ``LizyMLAdapter`` through the full
``create_model -> fit -> export_model -> ModelCache.load -> get_available_plots``
pipeline on real fixture data so shape-evolution bugs of the Issue #345
class are caught at CI time.

Issue #345 shipped because every existing test exercised ``fit`` only
in-memory; no test ever wrote the model to disk and read it back through
the same ``LizyMLAdapter`` instance. A single such test would have failed
immediately on the ``inner_valid: group_holdout`` config that broke
``Model.load`` under lizyml 0.9.0.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.services.job_results import ModelCache, get_available_plots
from lizystudio.services.jobs import Job

FIXTURE_ROOT = Path(__file__).resolve().parents[1] / "fixtures" / "lizyml"


def _job_for(scenario: str, model_dir: Path, config: dict) -> Job:
    """Construct the minimal ``Job`` shape that ``ModelCache.load`` needs.

    ``Job`` is a dataclass with several required fields; only
    ``backend_name`` + ``model_path`` actually drive ``ModelCache.load``,
    but we populate the rest with realistic values so any future helper
    that consults them keeps working.
    """
    return Job(
        job_id=f"integration_{scenario}",
        status="completed",
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(FIXTURE_ROOT / scenario / "data.csv"),
            filename="data.csv",
            fingerprint="integration-fixture",
            shape=(0, 0),
        ),
        job_type="fit",
        created_at="2026-05-03T00:00:00+00:00",
        completed_at="2026-05-03T00:00:01+00:00",
        model_path=str(model_dir),
    )


@pytest.mark.integration
@pytest.mark.parametrize("scenario", ["binary_no_cal", "binary_isotonic", "regression"])
def test_fit_save_load_get_available_plots(scenario: str, tmp_path: Path) -> None:
    """End-to-end fit -> save -> load -> available_plots round-trip.

    Asserts that:
    - ``LizyMLAdapter.fit`` completes without exception on the real
      fixture config
    - ``export_model`` writes artifacts the same adapter can re-load
      via ``ModelCache.load -> backend.load_model``
    - ``get_available_plots`` returns a non-empty list against the
      reloaded model (this is the exact call that 500'd in Issue #345)
    """
    fixture_dir = FIXTURE_ROOT / scenario
    df = pd.read_csv(fixture_dir / "data.csv")
    config: dict = json.loads((fixture_dir / "config.json").read_text())

    backend = LizyMLAdapter()
    model = backend.create_model(config, df)
    fit_result = backend.fit(model)
    assert fit_result is not None, f"fit returned None for {scenario}"

    model_dir = tmp_path / "model"
    exported_path = backend.export_model(model, str(model_dir))
    assert Path(exported_path).exists(), (
        f"export_model returned {exported_path!r} but path does not exist"
    )

    job = _job_for(scenario, Path(exported_path), config)
    cache = ModelCache()
    plots = get_available_plots(job, backend, cache)

    assert plots, f"empty plot list for {scenario}"
    # Every scenario must surface the shared baseline plots so the
    # frontend dropdown isn't empty after a successful fit.
    assert "learning-curve" in plots, (
        f"learning-curve missing from {plots!r} for {scenario}"
    )
    assert "importance" in plots, f"importance missing from {plots!r} for {scenario}"
