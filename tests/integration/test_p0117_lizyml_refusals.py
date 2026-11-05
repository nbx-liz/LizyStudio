"""lizyml 0.21's refusals reach the user as coded errors (P-0117 D2).

Each case runs the route where the refusal actually happens with the
installed lizyml, from a parquet file read by Studio's own loader:

* export-code of a model whose data had a column name with a NUL
  (``SERIALIZATION_FAILED`` / ``unsupported_column_name``) -> 400;
* a Fit job whose categorical column holds ``Period`` or ``Interval``
  values a saved model cannot hold (``SERIALIZATION_FAILED``, H-0145) ->
  a failed job with the coded reason, in the thread and the subprocess
  worker;
* inference on a saved model whose category identity marker is unknown or
  whose ``identity_columns`` is corrupted (``DESERIALIZATION_FAILED``) ->
  409.

None of them is 500 ``BACKEND_ERROR``, and no local path reaches the body.
The reasons no Studio route can reach are covered by
``tests/test_p0117_error_mapping.py``.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal
from unittest.mock import MagicMock

import joblib
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from lizyml import Model
from lizyml.core.exceptions import LizyMLError

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.server import create_app
from lizystudio.services.data import load_dataframe
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.subprocess_runner import run_job_in_subprocess
from lizystudio.services.training import run_fit

pytestmark = pytest.mark.integration

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
# A production config the UI wrote; only the data-specific fields change.
BASE_CONFIG = _FIXTURES / "lizyml" / "tune" / "config.json"
N_ROWS = 200
INPUT_CODE = "BACKEND_INPUT_REJECTED"
ARTIFACT_CODE = "MODEL_ARTIFACT_INVALID"


def _config(categorical: list[str]) -> dict[str, Any]:
    config: dict[str, Any] = json.loads(BASE_CONFIG.read_text())
    config.pop("tuning", None)
    config["data"]["target"] = "target"
    config["split"]["n_splits"] = 3
    config["features"]["exclude"] = []
    config["features"]["categorical"] = categorical
    config["features"]["auto_categorical"] = False
    return config


def _frame(extra: dict[str, Any]) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    return pd.DataFrame(
        {"x": rng.normal(size=N_ROWS), "target": rng.integers(0, 2, size=N_ROWS)}
        | extra
    )


def _codes() -> np.ndarray[Any, Any]:
    return np.random.default_rng(1).integers(0, 3, size=N_ROWS)


def _write(frame: pd.DataFrame, path: Path) -> Path:
    frame.to_parquet(path)
    return path


def _new_job(store: JobStore, config: dict[str, Any], data: Path) -> Job:
    frame = load_dataframe(str(data))
    job = store.create(
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(data),
            filename=data.name,
            fingerprint="p0117",
            shape=frame.shape,
        ),
        job_type="fit",
    )
    return job


def _fit(
    store: JobStore,
    config: dict[str, Any],
    data: Path,
    *,
    mode: Literal["thread", "subprocess"] = "thread",
    broadcaster: Any = None,
) -> Job:
    job = _new_job(store, config, data)
    if mode == "subprocess":
        return run_job_in_subprocess(
            job=job,
            job_store=store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(data),
        )
    return run_fit(
        job=job,
        job_store=store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=load_dataframe(str(data)),
        broadcaster=broadcaster,
    )


@pytest.fixture()
def jobs_dir(tmp_path: Path) -> Path:
    return tmp_path / "jobs"


@pytest.fixture()
def client(jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    with TestClient(create_app()) as c:
        yield c


def _assert_no_local_path(text: str, tmp_path: Path) -> None:
    assert str(tmp_path) not in text
    assert str(tmp_path.resolve()) not in text


# --- export-code: a column name a project cannot hold ------------------------


def test_export_code_with_a_nul_column_name_is_an_input_refusal(
    tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    data = _write(_frame({"a\x00b": _codes().astype(float)}), tmp_path / "nul.parquet")
    assert "a\x00b" in load_dataframe(str(data)).columns
    done = _fit(JobStore(jobs_dir), _config([]), data)
    assert done.status == "completed", done.error

    res = client.get(f"/api/jobs/{done.job_id}/export-code")

    assert res.status_code == 400, res.text
    error = res.json()["error"]
    assert error["code"] == INPUT_CODE
    assert error["code"] != "BACKEND_ERROR"
    details = error["details"]
    assert details["backend_code"] == "SERIALIZATION_FAILED"
    assert details["reason"] == "unsupported_column_name"
    assert details["context"]["kind"] == "invalid_alias_text"
    assert details["context"]["surface"] == "export_code"
    assert details["recovery_hint"].startswith("Rename the column")
    assert "invalid_alias_text" in error["message"]
    _assert_no_local_path(res.text, tmp_path)


# --- a Fit job: a category value a saved model cannot hold -------------------


def _period_frame() -> pd.DataFrame:
    values = pd.period_range("2020-01", periods=3, freq="M")
    return _frame({"c": pd.Series(values[_codes()])})


def _interval_frame() -> pd.DataFrame:
    values = pd.arrays.IntervalArray.from_breaks([0, 1, 2, 3])
    return _frame({"c": pd.Series(values[_codes()])})


def _time_frame() -> pd.DataFrame:
    # Parquet's time64 reads back as datetime.time objects.
    values = [dt.time(1), dt.time(2), dt.time(3)]
    return _frame({"c": [values[i] for i in _codes()]})


@pytest.mark.parametrize("mode", ["thread", "subprocess"])
@pytest.mark.parametrize(
    ("make", "value_type"),
    [(_period_frame, "Period"), (_interval_frame, "Interval"), (_time_frame, "time")],
    ids=["period", "interval", "time"],
)
def test_fit_job_with_an_unsaveable_category_value_reports_the_reason(
    tmp_path: Path,
    jobs_dir: Path,
    make: Any,
    value_type: str,
    mode: Literal["thread", "subprocess"],
) -> None:
    data = _write(make(), tmp_path / "train.parquet")
    store = JobStore(jobs_dir)
    broadcaster = MagicMock()

    done = _fit(store, _config(["c"]), data, mode=mode, broadcaster=broadcaster)

    assert done.status == "failed"
    record = JobStore(jobs_dir).get(done.job_id)
    assert record is not None and record.error is not None
    prefix = f"{INPUT_CODE} (SERIALIZATION_FAILED: unsaveable_category_value): "
    assert record.error.startswith(prefix), record.error
    assert f"of type {value_type}" in record.error
    assert "Remedy: Convert the column's values" in record.error
    assert "Traceback" not in record.error
    _assert_no_local_path(record.error, tmp_path)

    # One terminal error, under the coded reason (the subprocess worker
    # forwards it from the child's progress file).
    assert broadcaster.send_error.call_count == 1
    args, kwargs = broadcaster.send_error.call_args
    assert args == (done.job_id, record.error)
    assert kwargs == {"code": INPUT_CODE}

    # The traceback is kept, in the job's execution log.
    log = store.get_log(done.job_id)
    assert "Traceback" in log
    assert "SERIALIZATION_FAILED" in log


def test_the_job_api_returns_the_coded_error(
    tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    data = _write(_period_frame(), tmp_path / "train.parquet")
    done = _fit(JobStore(jobs_dir), _config(["c"]), data)
    assert done.status == "failed"

    res = client.get(f"/api/jobs/{done.job_id}")

    assert res.status_code == 200, res.text
    error = res.json()["error"]
    assert error.startswith(f"{INPUT_CODE} (SERIALIZATION_FAILED:")
    assert "Traceback" not in error
    _assert_no_local_path(res.text, tmp_path)


def test_an_unclassified_job_failure_keeps_its_traceback(
    tmp_path: Path, jobs_dir: Path
) -> None:
    # A dict category fails before lizyml can classify it (TypeError:
    # unhashable type): the job error keeps today's shape.
    data = _write(
        _frame({"c": [{"a": int(v)} for v in _codes()]}), tmp_path / "dict.parquet"
    )
    broadcaster = MagicMock()

    done = _fit(JobStore(jobs_dir), _config(["c"]), data, broadcaster=broadcaster)

    assert done.status == "failed"
    assert done.error is not None
    assert done.error.startswith("TypeError: ")
    assert "Traceback" in done.error
    assert broadcaster.send_error.call_count == 1
    assert broadcaster.send_error.call_args.kwargs == {}


# --- inference: a saved model whose category identity is corrupted -----------


def _encoder_states(obj: Any) -> list[dict[str, Any]]:
    states = [getattr(obj, "pipeline_state", None)]
    states += list(getattr(obj, "pipeline_state_per_fold", None) or [])
    return [
        s["encoder"]
        for s in states
        if isinstance(s, dict) and isinstance(s.get("encoder"), dict)
    ]


def _corrupt(model_dir: Path, field: str, value: Any) -> None:
    """Set *field* of every saved encoder state and re-sign the manifest.

    The checksums are recomputed so lizyml reaches the identity check
    instead of refusing the edited pickles as tampered.
    """
    meta_path = model_dir / "metadata.json"
    meta = json.loads(meta_path.read_text())
    edited = 0
    for name in ("fit_result.pkl", "refit_model.pkl"):
        obj = joblib.load(model_dir / name)
        for encoder in _encoder_states(obj):
            assert "category_identity_version" in encoder
            encoder[field] = value
            edited += 1
        joblib.dump(obj, model_dir / name)
        digest = hashlib.sha256((model_dir / name).read_bytes()).hexdigest()
        meta["checksums"]["files"][name] = digest
    assert edited > 0
    meta_path.write_text(json.dumps(meta))


@pytest.mark.parametrize(
    ("field", "value", "context_key", "reason"),
    [
        (
            "category_identity_version",
            2,
            "category_identity_version",
            "unknown_category_identity_version",
        ),
        (
            "identity_columns",
            ["no_such_column"],
            "identity_columns",
            "malformed_identity_columns",
        ),
    ],
    ids=["unknown-version", "corrupted-columns"],
)
def test_inference_on_a_corrupted_identity_model_is_an_artifact_refusal(
    tmp_path: Path,
    jobs_dir: Path,
    client: TestClient,
    field: str,
    value: Any,
    context_key: str,
    reason: str,
) -> None:
    frame = _frame({"c": _codes().astype(str)})
    data = _write(frame, tmp_path / "train.parquet")
    done = _fit(JobStore(jobs_dir), _config(["c"]), data)
    assert done.status == "completed", done.error
    assert done.model_path is not None
    _corrupt(Path(done.model_path), field, value)
    # The edit really trips lizyml's identity check (DC7), and lizyml puts
    # the artifact's absolute path in the context.
    with pytest.raises(LizyMLError) as caught:
        Model.load(done.model_path)
    assert caught.value.code.value == "DESERIALIZATION_FAILED"
    assert context_key in caught.value.context
    assert caught.value.context["path"] == done.model_path
    infer = _write(frame.drop(columns=["target"]), tmp_path / "infer.parquet")

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": done.job_id,
            "data": {"source_type": "path", "path": str(infer)},
            "return_shap": False,
        },
    )

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == ARTIFACT_CODE
    assert error["code"] != "BACKEND_ERROR"
    details = error["details"]
    assert details["backend_code"] == "DESERIALIZATION_FAILED"
    assert details["reason"] == reason
    assert context_key in details["context"]
    assert "path" not in details["context"]
    assert details["recovery_hint"].endswith("run a new Fit")
    assert reason in error["message"]
    _assert_no_local_path(res.text, tmp_path)


def test_inference_on_a_tampered_model_is_an_artifact_refusal(
    tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    # A pickle rewritten without re-signing the manifest: lizyml refuses it
    # at its integrity check, naming the file (the artifact_unreadable row).
    frame = _frame({"c": _codes().astype(str)})
    done = _fit(
        JobStore(jobs_dir), _config(["c"]), _write(frame, tmp_path / "t.parquet")
    )
    assert done.status == "completed", done.error
    assert done.model_path is not None
    pickle_path = Path(done.model_path) / "refit_model.pkl"
    joblib.dump(joblib.load(pickle_path), pickle_path, compress=3)
    with pytest.raises(LizyMLError) as caught:
        Model.load(done.model_path)
    assert caught.value.code.value == "DESERIALIZATION_FAILED"
    assert caught.value.context["file"] == "refit_model.pkl"
    assert "reason" not in caught.value.context
    infer = _write(frame.drop(columns=["target"]), tmp_path / "infer.parquet")

    res = client.post(
        "/api/inference/run",
        json={
            "job_id": done.job_id,
            "data": {"source_type": "path", "path": str(infer)},
            "return_shap": False,
        },
    )

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == ARTIFACT_CODE
    assert error["details"]["backend_code"] == "DESERIALIZATION_FAILED"
    assert error["details"]["reason"] == "artifact_unreadable"
    assert error["details"]["context"] == {"file": "refit_model.pkl"}
    _assert_no_local_path(res.text, tmp_path)
