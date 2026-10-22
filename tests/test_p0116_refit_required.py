"""Narrow refusals for models that need a new Fit (P-0116 D4, child 7).

Unit level, with stub models: which lizyml errors become
``RefitRequiredError`` (exactly one symptom each), how the routes map it to
400 ``REFIT_REQUIRED``, and the unpause preflight's skip when the job never
wrote its study.  The real 0.15 artifacts are exercised in
``tests/integration/test_p0116_legacy_015_jobs.py``.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from lizyml.core.exceptions import ErrorCode, LizyMLError

from lizystudio.backends.exceptions import RefitRequiredError
from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.lizyml.space_wire import names_routed_outside_model_params
from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.jobs import JobStore
from lizystudio.services.training import verify_unpause_study

pytestmark = pytest.mark.unit

_PER_FOLD = "pipeline_state_per_fold"


def _lizyml_error(code: ErrorCode, **context: Any) -> LizyMLError:
    return LizyMLError(code=code, user_message="stub", context=context)


# --- names_routed_outside_model_params --------------------------------------


@pytest.mark.parametrize(
    ("params", "expected"),
    [
        # Catalog keys and wire names of smart and training destinations.
        ({"num_leaves_ratio": 0.5, "learning_rate": 0.1}, ("num_leaves_ratio",)),
        ({"early_stopping.rounds": 50}, ("early_stopping.rounds",)),
        ({"early_stopping_rounds": 50}, ("early_stopping_rounds",)),
        ({"validation_ratio": 0.1}, ("validation_ratio",)),
        ({"seed": 1}, ("seed",)),
        # Native LightGBM names, known or not, stay.
        ({"learning_rate": 0.1, "num_leaves": 31, "max_depth": 5}, ()),
        ({"some_future_lgbm_param": 1}, ()),
        # A name sharing a prefix is not the routed name (DC2).
        ({"num_leaves_ratio_x": 1, "seed_offset": 2}, ()),
        ({}, ()),
        (None, ()),
        (["num_leaves_ratio"], ()),
    ],
)
def test_names_routed_outside_model_params(
    params: Any, expected: tuple[str, ...]
) -> None:
    assert names_routed_outside_model_params(params) == expected


# --- SHAP translator ---------------------------------------------------------


class _RaisingModel:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc

    def importance(self, kind: str) -> dict[str, float]:
        raise self.exc

    def importance_plot(self, **kwargs: Any) -> Any:
        raise self.exc


def _call(surface: str, model: Any) -> Any:
    adapter = LizyMLAdapter()
    if surface == "importance":
        return adapter.importance(model, kind="shap")
    return adapter.plot(model, "shap-summary")


@pytest.mark.parametrize("surface", ["importance", "plot"])
def test_shap_without_per_fold_states_is_refit_required(surface: str) -> None:
    exc = _lizyml_error(ErrorCode.MODEL_NOT_FIT, missing=_PER_FOLD, kind="shap")

    with pytest.raises(RefitRequiredError) as caught:
        _call(surface, _RaisingModel(exc))

    assert caught.value.kind == "shap_per_fold_state_missing"
    assert caught.value.names == ()
    assert caught.value.__cause__ is exc


@pytest.mark.parametrize("surface", ["importance", "plot"])
@pytest.mark.parametrize(
    "exc",
    [
        # The other MODEL_NOT_FIT: no training data, no ``missing``.
        _lizyml_error(ErrorCode.MODEL_NOT_FIT, kind="shap"),
        # ``missing`` must match exactly, not as a prefix (DC2).
        _lizyml_error(ErrorCode.MODEL_NOT_FIT, missing="pipeline_state"),
        _lizyml_error(ErrorCode.MODEL_NOT_FIT, missing=f"{_PER_FOLD}_x"),
        # The right ``missing`` under another code.
        _lizyml_error(ErrorCode.CONFIG_INVALID, missing=_PER_FOLD),
        _lizyml_error(ErrorCode.OPTIONAL_DEP_MISSING),
    ],
    ids=["no-missing", "prefix", "suffix", "other-code", "optional-dep"],
)
def test_other_shap_errors_propagate_unchanged(surface: str, exc: LizyMLError) -> None:
    with pytest.raises(LizyMLError) as caught:
        _call(surface, _RaisingModel(exc))

    assert caught.value is exc


# --- export-code preflight ---------------------------------------------------


def _export_model(params: Any, export: Any = None) -> Any:
    model = MagicMock()
    model.fit_result = SimpleNamespace(
        run_meta=SimpleNamespace(
            config_normalized={"task": "binary", "model": {"params": params}}
        )
    )
    if isinstance(export, Exception):
        model.export_code.side_effect = export
    else:
        model.export_code.return_value = Path("/out/code")
    return model


def test_export_code_with_routed_names_is_refit_required_before_lizyml() -> None:
    model = _export_model(
        {"num_leaves_ratio": 0.5, "learning_rate": 0.1, "validation_ratio": 0.1}
    )

    with pytest.raises(RefitRequiredError) as caught:
        LizyMLAdapter().export_code(model, "/out/code")

    assert caught.value.kind == "export_param_names"
    assert caught.value.names == ("num_leaves_ratio", "validation_ratio")
    assert model.export_code.call_count == 0


@pytest.mark.parametrize("params", [{"learning_rate": 0.1}, {}, None])
def test_export_code_with_native_params_is_exported(params: Any) -> None:
    model = _export_model(params)

    assert LizyMLAdapter().export_code(model, "/out/code") == "/out/code"
    assert model.export_code.call_count == 1


def test_other_config_invalid_from_export_code_propagates_unchanged() -> None:
    exc = _lizyml_error(ErrorCode.CONFIG_INVALID)
    model = _export_model({"learning_rate": 0.1}, export=exc)

    with pytest.raises(LizyMLError) as caught:
        LizyMLAdapter().export_code(model, "/out/code")

    assert caught.value is exc


# --- routes --------------------------------------------------------------------


@pytest.fixture()
def completed_job(client: TestClient, tmp_path: Path) -> str:
    app: Any = client.app
    job_store: JobStore = app.state.job_store
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/train.csv",
            filename="train.csv",
            fingerprint="abc123",
            shape=(100, 10),
        ),
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = str(tmp_path / "model")
    job.fit_result = FitSummary(metrics={"auc": 0.9}, fold_count=3, params=[])
    job_store.update(job)
    return job.job_id


def _with_backend(client: TestClient, backend: Any) -> Any:
    app: Any = client.app
    original = app.state.workspace.backend
    app.state.workspace.backend = backend
    return original


_ROUTES = {
    "importance": ("importance", "importance?kind=shap"),
    "plot": ("plot", "plot/shap-summary"),
    "export-code": ("export_code", "export-code"),
}


@pytest.mark.parametrize("route", list(_ROUTES))
def test_routes_map_refit_required_to_400(
    client: TestClient, completed_job: str, route: str
) -> None:
    method, path = _ROUTES[route]
    backend = MagicMock()
    getattr(backend, method).side_effect = RefitRequiredError(
        "needs a new Fit", kind="export_param_names", names=("seed",)
    )
    original = _with_backend(client, backend)
    try:
        res = client.get(f"/api/jobs/{completed_job}/{path}")
    finally:
        _with_backend(client, original)

    assert res.status_code == 400, res.text
    error = res.json()["error"]
    assert error["code"] == "REFIT_REQUIRED"
    assert error["details"] == {
        "kind": "export_param_names",
        "names": ["seed"],
        "recovery_hint": "Fit the model again with the current version",
    }


@pytest.mark.parametrize("route", list(_ROUTES))
def test_routes_keep_other_backend_errors_generic(
    client: TestClient, completed_job: str, route: str
) -> None:
    method, path = _ROUTES[route]
    backend = MagicMock()
    getattr(backend, method).side_effect = _lizyml_error(
        ErrorCode.MODEL_NOT_FIT, kind="shap"
    )
    original = _with_backend(client, backend)
    try:
        res = client.get(f"/api/jobs/{completed_job}/{path}")
    finally:
        _with_backend(client, original)

    assert res.status_code == 500, res.text
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- unpause preflight -----------------------------------------------------------


def _paused_tune(tmp_path: Path) -> tuple[JobStore, Any]:
    job_store = JobStore(tmp_path / "jobs")
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/train.csv",
            filename="train.csv",
            fingerprint="abc123",
            shape=(100, 10),
        ),
        job_type="tune",
    )
    return job_store, job


def test_unpause_preflight_skips_a_job_without_a_study(tmp_path: Path) -> None:
    job_store, job = _paused_tune(tmp_path)
    backend = MagicMock()

    verify_unpause_study(backend=backend, job_store=job_store, job=job)

    assert backend.verify_study_continuable.call_count == 0
    assert not (job_store.job_dir(job.job_id) / "optuna.db").exists()


def test_unpause_preflight_asks_the_adapter_about_the_job_study(
    tmp_path: Path,
) -> None:
    job_store, job = _paused_tune(tmp_path)
    db = job_store.job_dir(job.job_id) / "optuna.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    db.write_bytes(b"")
    backend = MagicMock()

    verify_unpause_study(backend=backend, job_store=job_store, job=job)

    backend.verify_study_continuable.assert_called_once_with(
        f"sqlite:///{db.resolve()}", f"studio-tune-{job.job_id}"
    )
