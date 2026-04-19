"""Regression test for inference comparison task lookup bug.

The inference comparison endpoint previously read ``task`` from
``job.config["model"]["task"]`` but LizyML stores it at the top level
(``config["task"]``). As a result, binary jobs always fell back to
``"regression"`` and ``positive_pct`` statistics were never returned.
"""

from __future__ import annotations

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.inference import InferenceRecord, InferenceStore
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/test.csv",
        filename="test.csv",
        fingerprint="abc",
        shape=(100, 5),
    )


def _setup_binary_job_with_two_inferences(
    client: TestClient,
    sample_data_ref: DataRef,
) -> tuple[str, str, str]:
    """Seed a binary-task job and two predictions records."""
    app = client.app  # type: ignore[union-attr]
    job_store: JobStore = app.state.job_store

    job = job_store.create(
        backend_name="lizyml",
        config={
            "task": "binary",
            "data": {"target": "y"},
            "model": {"name": "lightgbm"},
        },
        data_ref=sample_data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(
        metrics={"raw": {"oof": {"auc": 0.9}, "if_mean": {"auc": 0.95}}},
        fold_count=5,
        params=[],
    )
    job.model_path = "/fake/model/path"
    job_store.update(job)

    inf_store = InferenceStore(job_store.jobs_dir)
    for inf_id, pred_values in (
        ("inf_binary_a", [0.1] * 5 + [0.9] * 5),
        ("inf_binary_b", [0.2] * 5 + [0.8] * 5),
    ):
        pred_df = pd.DataFrame(
            {
                "idx": range(10),
                "pred": pred_values,
                "proba": pred_values,
            }
        )
        record = InferenceRecord(
            inf_id=inf_id,
            job_id=job.job_id,
            data_ref=sample_data_ref,
            has_ground_truth=False,
            created_at="2026-01-01T00:00:00Z",
            row_count=10,
            warnings=[],
        )
        inf_store.save(record, pred_df)

    return job.job_id, "inf_binary_a", "inf_binary_b"


def test_comparison_returns_positive_pct_for_binary_task(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Binary task comparisons must include ``positive_pct`` stats.

    Before the fix, the API resolved task from
    ``config["model"]["task"]`` which does not exist, falling back to
    ``"regression"`` and producing ``median`` instead.
    """
    job_id, inf_a, inf_b = _setup_binary_job_with_two_inferences(
        client, sample_data_ref
    )

    res = client.get(f"/api/inference/{inf_a}/comparison/{inf_b}?job_id={job_id}")

    assert res.status_code == 200
    body = res.json()
    assert "positive_pct" in body["current"], (
        "binary task should report positive_pct, got: " + repr(body["current"])
    )
    assert "positive_pct" in body["other"]
    assert "median" not in body["current"], (
        "binary task must not fall through to regression median stats"
    )
