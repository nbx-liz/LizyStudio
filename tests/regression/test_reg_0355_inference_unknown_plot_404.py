"""Regression test for Issue #355: ``/plot/shap-summary`` returned 500.

Before the fix, requesting an unknown plot type from either the
inference or jobs plot endpoint funnelled the backend's bare
``ValueError("Unknown plot type: ...")`` through the catch-all
``except Exception: raise BackendError`` block, producing a 500
response with code ``BACKEND_ERROR``.

That hid a 4xx-shaped condition (the *client* asked for a plot the
backend doesn't render) behind a 5xx envelope, which scared new users
during the v0.3.0 PyPI release rehearsal: every Inference run logged
a 500 in the browser DevTools console even though the SHAP accordion
silently hid itself.

The fix introduces a typed
``lizystudio.backends.exceptions.PlotNotAvailableError`` that the
lizyml ``EvaluationMixin`` raises when the plot type is not in
``_PLOT_DISPATCH``. The API layer translates it to a 404 response
with the structured code ``PLOT_NOT_AVAILABLE`` and a body that lists
the supported plot types so the client can recover gracefully.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.exceptions import PlotNotAvailableError
from lizystudio.backends.lizyml.evaluation_mixin import EvaluationMixin
from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services.inference import InferenceRecord, InferenceStore
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.integration


# --- Unit-level: backend raises typed error, not bare ValueError ---


def test_evaluation_mixin_unknown_plot_raises_typed_error() -> None:
    """Unknown plot types raise PlotNotAvailableError (not bare ValueError).

    ``ValueError`` is too coarse — the API layer cannot distinguish
    "client asked for an unsupported plot" from "the underlying
    plot-generating code blew up". A typed exception lets the API map
    the former to 404 while leaving genuine backend failures as 500.
    """
    mixin = EvaluationMixin()
    fake_model = MagicMock()

    with pytest.raises(PlotNotAvailableError) as exc_info:
        mixin.plot(fake_model, "shap-summary")

    err = exc_info.value
    assert err.plot_type == "shap-summary"
    assert isinstance(err.available, list)
    assert "learning-curve" in err.available  # known supported plot
    # Bare ValueError must NOT be raised — that was the old behaviour
    assert not isinstance(err, ValueError) or isinstance(err, PlotNotAvailableError)


def test_evaluation_mixin_known_plot_does_not_raise() -> None:
    """Sanity check: a plot type that IS in the dispatch must still
    look up the method and call it on the model — no early raise.
    """
    mixin = EvaluationMixin()
    fake_model = MagicMock()
    fake_model.plot_learning_curve.return_value.to_json.return_value = "{}"

    # Should not raise PlotNotAvailableError for a supported type
    result = mixin.plot(fake_model, "learning-curve")
    assert result.plotly_json == "{}"


# --- API-level: shared fixtures (mirrored from tests/test_inference_api.py) ---


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/test.csv",
        filename="test.csv",
        fingerprint="abc",
        shape=(100, 5),
    )


def _create_inference_setup(
    client: TestClient,
    sample_data_ref: DataRef,
) -> tuple[str, str]:
    """Create a completed job and a mock inference record."""
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
    pred_df = pd.DataFrame(
        {
            "idx": range(10),
            "pred": [0.1] * 5 + [0.9] * 5,
            "proba": [0.1] * 5 + [0.9] * 5,
        }
    )
    record = InferenceRecord(
        inf_id="inf_test355",
        job_id=job.job_id,
        data_ref=sample_data_ref,
        has_ground_truth=False,
        created_at="2026-05-03T00:00:00Z",
        row_count=10,
        warnings=[],
    )
    inf_store.save(record, pred_df)

    return job.job_id, record.inf_id


def _patch_backend_to_raise(
    client: TestClient, plot_type: str, available: list[str]
) -> object:
    """Swap the workspace backend with a mock that raises
    PlotNotAvailableError when plot() is called."""
    app = client.app  # type: ignore[union-attr]
    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.plot.side_effect = PlotNotAvailableError(plot_type, available)
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    return original


# --- API: inference plot endpoint ---


def test_inference_unknown_plot_returns_404_not_500(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """``GET /api/inference/{id}/plot/shap-summary`` must return 404.

    Pre-fix this returned 500 with code ``BACKEND_ERROR`` because the
    bare ``ValueError`` from the backend was caught by ``except
    Exception``. The fix maps the typed
    :class:`PlotNotAvailableError` to a 404 with code
    ``PLOT_NOT_AVAILABLE``.
    """
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    available = ["learning-curve", "roc-curve", "importance"]
    original = _patch_backend_to_raise(client, "shap-summary", available)
    try:
        res = client.get(f"/api/inference/{inf_id}/plot/shap-summary?job_id={job_id}")
    finally:
        client.app.state.workspace.backend = original  # type: ignore[union-attr]

    assert res.status_code == 404, (
        f"expected 404 for unknown plot type, got {res.status_code}: {res.text}"
    )
    body = res.json()
    assert body["error"]["code"] == "PLOT_NOT_AVAILABLE"
    # Body must surface the supported plots so the client can recover
    assert "available" in body["error"]["details"]
    assert "learning-curve" in body["error"]["details"]["available"]


def test_inference_unknown_plot_response_lists_plot_type(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """The 404 response must include the requested plot type so logs
    are actionable when many endpoints fan out simultaneously.
    """
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    original = _patch_backend_to_raise(client, "shap-summary", ["learning-curve"])
    try:
        res = client.get(f"/api/inference/{inf_id}/plot/shap-summary?job_id={job_id}")
    finally:
        client.app.state.workspace.backend = original  # type: ignore[union-attr]

    body = res.json()
    assert body["error"]["details"]["plot_type"] == "shap-summary"


def test_inference_runtime_error_still_returns_500(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """Genuine backend failures (RuntimeError mid-plot) must still
    return 500 with ``BACKEND_ERROR`` — the new 404 path is reserved
    for "this plot type isn't available", not "rendering blew up".

    Otherwise we'd silently downgrade real errors to 4xx and lose the
    on-call signal.
    """
    job_id, inf_id = _create_inference_setup(client, sample_data_ref)
    app = client.app  # type: ignore[union-attr]
    mock_backend = MagicMock()
    mock_backend.load_model.return_value = MagicMock()
    mock_backend.plot.side_effect = RuntimeError("kaboom")
    original = app.state.workspace.backend
    app.state.workspace.backend = mock_backend
    try:
        res = client.get(f"/api/inference/{inf_id}/plot/roc-curve?job_id={job_id}")
    finally:
        app.state.workspace.backend = original

    assert res.status_code == 500
    assert res.json()["error"]["code"] == "BACKEND_ERROR"


# --- API: jobs plot endpoint (same dispatch, same fix) ---


def test_jobs_unknown_plot_returns_404_not_500(
    client: TestClient, sample_data_ref: DataRef
) -> None:
    """``GET /api/jobs/{id}/plot/shap-summary`` must return 404 too.

    The jobs plot endpoint shares the same ``backend.plot()``
    dispatch and the same bare ``except Exception`` block, so the
    same fix must apply on both routes.
    """
    job_id, _ = _create_inference_setup(client, sample_data_ref)
    original = _patch_backend_to_raise(
        client, "shap-summary", ["learning-curve", "roc-curve"]
    )
    try:
        res = client.get(f"/api/jobs/{job_id}/plot/shap-summary")
    finally:
        client.app.state.workspace.backend = original  # type: ignore[union-attr]

    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "PLOT_NOT_AVAILABLE"
