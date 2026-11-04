"""A Decimal category at training is the same category as its integer at inference.

Inside one parquet column Arrow unifies the value type, so a mixed column
cannot reach Studio through a file.  Training and inference read different
files, though (``services/data.py`` ``load_dataframe`` for both), so the
type can differ *across* files on Studio's own path.  lizyml 0.21 keys
category identity structurally (``lizyml.core.category_values._number_key``:
``Decimal("2")`` and ``2`` share the key ``("number", "finite", 2, 1)``),
so integers at inference are seen, not unseen.

Studio does not re-test lizyml's identity rule; this is the one bounded
case that crosses Studio's file boundary: Fit on a Decimal column, save,
reload the saved model for inference on integers.
"""

from __future__ import annotations

import decimal
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.server import create_app
from lizystudio.services.data import load_dataframe
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import run_fit

pytestmark = pytest.mark.integration

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
# A production config the UI wrote; only the data-specific fields change.
BASE_CONFIG = _FIXTURES / "lizyml" / "tune" / "config.json"
N_ROWS = 300


def _frames() -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.default_rng(0)
    grade = rng.integers(1, 4, size=N_ROWS)
    x = rng.normal(size=N_ROWS)
    rate = np.where(grade == 1, 0.1, np.where(grade == 2, 0.5, 0.9))
    y = (rng.random(N_ROWS) < rate).astype(int)
    as_decimal = pd.DataFrame(
        {"grade": [decimal.Decimal(int(g)) for g in grade], "x": x, "target": y}
    )
    as_int = pd.DataFrame({"grade": grade.astype("int64"), "x": x, "target": y})
    return as_decimal, as_int


def _fit_config() -> dict[str, Any]:
    config: dict[str, Any] = json.loads(BASE_CONFIG.read_text())
    config.pop("tuning", None)
    config["data"]["target"] = "target"
    config["split"]["n_splits"] = 3
    config["features"]["exclude"] = []
    config["features"]["categorical"] = ["grade"]
    config["features"]["auto_categorical"] = False
    config["features"]["unseen_policy"] = "mode"
    return config


@pytest.fixture()
def fitted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[dict[str, Any]]:
    as_decimal, as_int = _frames()
    train_path = tmp_path / "train.parquet"
    as_decimal.to_parquet(train_path)
    # Inference files carry no target, so the only warnings are about grade.
    decimal_path = tmp_path / "infer_decimal.parquet"
    as_decimal.drop(columns=["target"]).to_parquet(decimal_path)
    int_path = tmp_path / "infer_int.parquet"
    as_int.drop(columns=["target"]).to_parquet(int_path)
    unseen_path = tmp_path / "infer_unseen.parquet"
    as_int.drop(columns=["target"]).assign(grade=99).to_parquet(unseen_path)

    train = load_dataframe(str(train_path))
    jobs_dir = tmp_path / "jobs"
    job_store = JobStore(jobs_dir)
    config = _fit_config()
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(train_path),
            filename=train_path.name,
            fingerprint="decimal-train",
            shape=train.shape,
        ),
        job_type="fit",
    )
    assert job is not None
    done = run_fit(
        job=job,
        job_store=job_store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=train,
    )
    assert done.status == "completed", done.error

    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    with TestClient(create_app()) as client:
        yield {
            "client": client,
            "job_id": job.job_id,
            "train": train,
            "paths": {
                "decimal": decimal_path,
                "int": int_path,
                "unseen": unseen_path,
            },
        }


def _infer(fitted: dict[str, Any], kind: str) -> tuple[list[str], list[float]]:
    client: TestClient = fitted["client"]
    job_id = fitted["job_id"]
    run = client.post(
        "/api/inference/run",
        json={
            "job_id": job_id,
            "data": {"source_type": "path", "path": str(fitted["paths"][kind])},
        },
    )
    assert run.status_code == 200, run.text
    inf_id = run.json()["inf_id"]
    record = client.get(f"/api/inference/{inf_id}", params={"job_id": job_id})
    assert record.status_code == 200, record.text
    preds = client.get(
        f"/api/inference/{inf_id}/predictions",
        params={"job_id": job_id, "rows": N_ROWS},
    )
    assert preds.status_code == 200, preds.text
    body = preds.json()
    assert body["total_rows"] == N_ROWS
    proba = [float(row["proba"]) for row in body["data"]]
    assert len(proba) == N_ROWS
    return list(record.json()["warnings"]), proba


def test_training_reads_the_decimal_column_as_decimal_objects(
    fitted: dict[str, Any],
) -> None:
    grade = fitted["train"]["grade"]
    assert grade.dtype == object
    assert {type(v) for v in grade} == {decimal.Decimal}
    assert set(grade) == {decimal.Decimal(1), decimal.Decimal(2), decimal.Decimal(3)}


def test_integer_values_at_inference_are_the_trained_decimal_categories(
    fitted: dict[str, Any],
) -> None:
    decimal_warnings, decimal_proba = _infer(fitted, "decimal")
    int_warnings, int_proba = _infer(fitted, "int")

    assert decimal_warnings == []
    # Seen: no unseen-category replacement, and the same predictions row by row.
    assert int_warnings == []
    assert int_proba == decimal_proba


def test_a_value_never_trained_is_still_unseen(fitted: dict[str, Any]) -> None:
    # The control: the comparison above can tell seen from unseen.
    warnings, _ = _infer(fitted, "unseen")

    assert len(warnings) == 1
    assert "grade" in warnings[0]
    assert "unseen" in warnings[0]
