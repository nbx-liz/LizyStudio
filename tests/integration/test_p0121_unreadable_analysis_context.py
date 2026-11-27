"""An unreadable saved model is a coded 409, and export never echoes (P-0121).

Every case runs lizyml's own load on a model Studio fitted and saved, then
corrupted on disk (DC7: the raw raise is asserted before the Studio answer):

* ``analysis_context.pkl`` that cannot be unpickled -> 409
  ``MODEL_ARTIFACT_INVALID`` / ``unreadable_analysis_context`` on all 12
  route cases that read a saved model;
* the seven other ``{"path"}``-only load failures stay unclassified (500
  ``BACKEND_ERROR``, and 500 ``EXPORT_ERROR`` with a fixed message on
  export);
* an unclassified export failure never carries the exception text.
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any
from unittest.mock import patch

import joblib
import pytest
from fastapi.testclient import TestClient
from lizyml import Model
from lizyml.core.exceptions import ErrorCode, LizyMLError

from lizystudio.backends.lizyml.error_mapping import classify
from lizystudio.services.jobs import Job, JobStore
from tests.integration import test_p0117_lizyml_refusals as _p0117
from tests.integration.test_p0117_lizyml_refusals import (
    _assert_no_local_path,
    _codes,
    _config,
    _fit,
    _frame,
    _infer,
    _write,
)

pytestmark = pytest.mark.integration

# The P-0117 suite's fixtures, reused by name.
jobs_dir = _p0117.jobs_dir
client = _p0117.client

ARTIFACT_CODE = "MODEL_ARTIFACT_INVALID"
SENTINEL = "P0121-SECRET-SENTINEL"
PREFIX = "Failed to load analysis_context: "


class _Unreadable:
    """Unpickling calls ``int(SENTINEL)``, which raises with the sentinel."""

    def __reduce__(self) -> tuple[Any, ...]:
        return (int, (SENTINEL,))


def _fitted(tmp_path: Path, jobs_dir: Path) -> tuple[Job, Path, Path]:
    frame = _frame({"c": _codes().astype(str)})
    done = _fit(
        JobStore(jobs_dir), _config(["c"]), _write(frame, tmp_path / "t.parquet")
    )
    assert done.status == "completed", done.error
    assert done.model_path is not None
    infer = _write(frame.drop(columns=["target"]), tmp_path / "infer.parquet")
    return done, Path(done.model_path), infer


def _replace_pickle(model_dir: Path, name: str) -> None:
    """Swap *name* for an unreadable pickle and re-sign the manifest."""
    (model_dir / name).write_bytes(joblib_dumps(_Unreadable()))
    meta_path = model_dir / "metadata.json"
    meta = json.loads(meta_path.read_text())
    digest = hashlib.sha256((model_dir / name).read_bytes()).hexdigest()
    meta["checksums"]["files"][name] = digest
    meta_path.write_text(json.dumps(meta))


def joblib_dumps(obj: Any) -> bytes:
    import io

    buffer = io.BytesIO()
    joblib.dump(obj, buffer)
    return buffer.getvalue()


def _raw_load_error(model_dir: Path) -> LizyMLError:
    with pytest.raises(LizyMLError) as caught:
        Model.load(str(model_dir))
    return caught.value


def _assert_raw_shape(
    exc: LizyMLError, message_prefix: str, *, has_cause: bool
) -> None:
    assert exc.code.value == "DESERIALIZATION_FAILED"
    assert set(exc.context) == {"path"}
    assert exc.user_message.startswith(message_prefix)
    assert (exc.cause is not None) is has_cause


# --- the positive case: 12 route cases ---------------------------------------


def _get(path: str) -> Callable[[TestClient, str, Path, str], Any]:
    return lambda c, job_id, _out, _inf: c.get(path.format(job_id=job_id))


def _export(kind: str) -> Callable[[TestClient, str, Path, str], Any]:
    def call(c: TestClient, job_id: str, out: Path, _inf: str) -> Any:
        target = out / f"{kind}-out"
        return c.post(
            f"/api/jobs/{job_id}/export",
            json={"export_type": kind, "output_path": str(target)},
        )

    return call


def _inference_plot(c: TestClient, job_id: str, _out: Path, inf_id: str) -> Any:
    return c.get(f"/api/inference/{inf_id}/plot/importance?job_id={job_id}")


def _inference_run(c: TestClient, job_id: str, out: Path, _inf: str) -> Any:
    return _infer(c, job_id, out / "infer.parquet")


ROUTES: dict[str, Callable[[TestClient, str, Path, str], Any]] = {
    "metrics": _get("/api/jobs/{job_id}/metrics"),
    "split-summary": _get("/api/jobs/{job_id}/split-summary"),
    "importance": _get("/api/jobs/{job_id}/importance"),
    "importance-kinds": _get("/api/jobs/{job_id}/importance-kinds"),
    "learning-curve-metrics": _get("/api/jobs/{job_id}/learning-curve/metrics"),
    "plot": _get("/api/jobs/{job_id}/plot/importance"),
    "plots": _get("/api/jobs/{job_id}/plots"),
    "export-model": _export("model"),
    "export-report": _export("report"),
    "export-code": _get("/api/jobs/{job_id}/export-code"),
    "inference-run": _inference_run,
    "inference-plot": _inference_plot,
}


def test_the_route_table_names_twelve_cases() -> None:
    assert len(ROUTES) == 12


def test_the_real_lizyml_raise_has_the_shape_the_row_matches(
    tmp_path: Path, jobs_dir: Path
) -> None:
    _done, model_dir, _infer_path = _fitted(tmp_path, jobs_dir)
    assert (model_dir / "analysis_context.pkl").exists()
    _replace_pickle(model_dir, "analysis_context.pkl")

    exc = _raw_load_error(model_dir)

    # A checksum refusal would carry {file, expected, actual}, not {path}.
    _assert_raw_shape(exc, PREFIX, has_cause=True)
    assert SENTINEL in exc.user_message
    found = classify(exc)
    assert found.error_class == "artifact"
    assert found.reason == "unreadable_analysis_context"


@pytest.mark.parametrize("route", list(ROUTES))
def test_an_unreadable_analysis_context_is_a_409_on_every_route(
    tmp_path: Path, jobs_dir: Path, client: TestClient, route: str
) -> None:
    done, model_dir, infer = _fitted(tmp_path, jobs_dir)
    inf_id = ""
    if route == "inference-plot":
        run = _infer(client, done.job_id, infer)
        assert run.status_code == 200, run.text
        inf_id = run.json()["inf_id"]
    _replace_pickle(model_dir, "analysis_context.pkl")
    # A cold ModelCache: nothing of the good model survives in memory.
    client.app.state.job_store.model_cache.clear()  # type: ignore[attr-defined]
    exc = _raw_load_error(model_dir)
    _assert_raw_shape(exc, PREFIX, has_cause=True)

    res = ROUTES[route](client, done.job_id, tmp_path, inf_id)

    assert res.status_code == 409, res.text
    error = res.json()["error"]
    assert error["code"] == ARTIFACT_CODE
    details = error["details"]
    assert details["backend_code"] == "DESERIALIZATION_FAILED"
    assert details["reason"] == "unreadable_analysis_context"
    assert details["context"] == {}
    assert details["recovery_hint"].endswith("run a new Fit")
    assert SENTINEL not in res.text
    assert str(model_dir) not in res.text
    _assert_no_local_path(res.text, tmp_path)


# --- the D2 boundary: the other path-only load failures stay as they are -----


def _rm_dir(model_dir: Path) -> None:
    shutil.rmtree(model_dir)


def _rm_metadata(model_dir: Path) -> None:
    (model_dir / "metadata.json").unlink()


def _bad_metadata(model_dir: Path) -> None:
    (model_dir / "metadata.json").write_text("{not json")


def _rm_pickle(name: str) -> Callable[[Path], None]:
    return lambda model_dir: (model_dir / name).unlink()


def _bad_pickle(name: str) -> Callable[[Path], None]:
    return lambda model_dir: _replace_pickle(model_dir, name)


NEGATIVE: dict[str, tuple[Callable[[Path], None], str, bool]] = {
    "missing-dir": (_rm_dir, "Export directory not found", False),
    "missing-metadata": (_rm_metadata, "metadata.json not found", False),
    "bad-metadata": (_bad_metadata, "Failed to parse metadata.json", True),
    "missing-fit-result": (
        _rm_pickle("fit_result.pkl"),
        "Required artifact not found",
        False,
    ),
    "missing-refit-model": (
        _rm_pickle("refit_model.pkl"),
        "Required artifact not found",
        False,
    ),
    "bad-fit-result": (
        _bad_pickle("fit_result.pkl"),
        "Failed to load model artifacts",
        True,
    ),
    "bad-refit-model": (
        _bad_pickle("refit_model.pkl"),
        "Failed to load model artifacts",
        True,
    ),
}


@pytest.mark.parametrize("case", list(NEGATIVE))
def test_the_other_path_only_load_failures_stay_unclassified(
    tmp_path: Path, jobs_dir: Path, client: TestClient, case: str
) -> None:
    corrupt, message_prefix, has_cause = NEGATIVE[case]
    done, model_dir, _infer_path = _fitted(tmp_path, jobs_dir)
    corrupt(model_dir)
    client.app.state.job_store.model_cache.clear()  # type: ignore[attr-defined]
    exc = _raw_load_error(model_dir)
    _assert_raw_shape(exc, message_prefix, has_cause=has_cause)
    assert classify(exc).error_class == "unclassified"

    metrics = client.get(f"/api/jobs/{done.job_id}/metrics")
    assert metrics.status_code == 500, metrics.text
    assert metrics.json()["error"]["code"] == "BACKEND_ERROR"
    assert metrics.json()["error"]["details"] == {"type": "LizyMLError"}

    for kind in ("model", "report"):
        res = client.post(
            f"/api/jobs/{done.job_id}/export",
            json={"export_type": kind, "output_path": str(tmp_path / f"o-{kind}")},
        )
        assert res.status_code == 500, res.text
        error = res.json()["error"]
        assert error["code"] == "EXPORT_ERROR"
        assert error["message"] == "Export failed (LizyMLError)"
        assert error["details"] == {}
        _assert_no_local_path(res.text, tmp_path)


# --- export: an unclassified failure never echoes the exception --------------


@pytest.mark.parametrize("kind", ["model", "report"])
def test_an_unclassified_export_failure_is_sanitized_and_logged(
    tmp_path: Path,
    jobs_dir: Path,
    client: TestClient,
    caplog: pytest.LogCaptureFixture,
    kind: str,
) -> None:
    done, _model_dir, _infer_path = _fitted(tmp_path, jobs_dir)
    target = "export_model" if kind == "model" else "export_report"
    boom = RuntimeError(f"{SENTINEL} at {tmp_path}/secret")

    with (
        caplog.at_level(logging.ERROR, logger="lizystudio.errors"),
        patch(f"lizystudio.api.jobs.{target}", side_effect=boom),
    ):
        res = client.post(
            f"/api/jobs/{done.job_id}/export",
            json={"export_type": kind, "output_path": str(tmp_path / "out")},
        )

    assert res.status_code == 500, res.text
    error = res.json()["error"]
    assert error["code"] == "EXPORT_ERROR"
    assert error["message"] == "Export failed (RuntimeError)"
    assert error["details"] == {}
    assert SENTINEL not in res.text
    assert str(tmp_path) not in res.text
    logged = [r for r in caplog.records if r.getMessage() == "Export failed"]
    assert len(logged) == 1
    assert logged[0].exc_info is not None
    assert logged[0].exc_info[1] is boom
    assert SENTINEL in caplog.text  # the traceback is on the server


def test_a_classified_input_refusal_on_model_export_keeps_the_d2_boundary(
    tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    # The explicit exception to P-0121's leak guarantee: an input refusal
    # lizyml classified returns the user's own values, capped in the
    # context and uncapped in the message (BLUEPRINT 6.2).
    done, _model_dir, _infer_path = _fitted(tmp_path, jobs_dir)
    message = "bad value " + "m" * 300
    refusal = LizyMLError(
        ErrorCode.SERIALIZATION_FAILED,
        message,
        context={"column": "c" * 300, "secret_key": "hidden", "kind": "k"},
    )

    with patch.object(Model, "export", side_effect=refusal):
        res = client.post(
            f"/api/jobs/{done.job_id}/export",
            json={"export_type": "model", "output_path": str(tmp_path / "out")},
        )

    assert res.status_code == 400, res.text
    error = res.json()["error"]
    assert error["code"] == "BACKEND_INPUT_REJECTED"
    context = error["details"]["context"]
    assert "secret_key" not in context
    assert context["column"] == "c" * 200
    assert error["message"] == message
    assert len(error["message"]) > 200
