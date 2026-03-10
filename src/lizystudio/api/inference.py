"""Inference API router (BLUEPRINT §5.4, H-0003).

Covers: run, upload-and-run, history, get, predictions, metrics, plot,
download, comparison.
"""

from __future__ import annotations

import tempfile
from dataclasses import asdict
from io import StringIO
from typing import Any

from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from lizystudio.api.errors import (
    BackendError,
    InferenceNotFoundError,
    JobNotCompletedError,
    JobNotFoundError,
)
from lizystudio.services.inference import (
    InferenceStore,
    get_comparison_stats,
    get_inference_plot,
    run_inference,
)
from lizystudio.services.jobs import JobStore, get_job_store
from lizystudio.services.workspace import WorkspaceState, get_workspace

router = APIRouter()


# --- Helpers ---


def _get_inf_store(job_store: JobStore) -> InferenceStore:
    return InferenceStore(job_store.jobs_dir)


def _get_job_or_404(job_id: str, job_store: JobStore) -> Any:
    from lizystudio.services.jobs import Job

    job: Job | None = job_store.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    if job.status != "completed":
        raise JobNotCompletedError(job_id)
    return job


# --- Run ---


class DataSource(BaseModel):
    source_type: str  # "path" or "upload"
    path: str


class RunRequest(BaseModel):
    job_id: str
    data: DataSource
    return_shap: bool = False
    evaluate: bool = True


@router.post("/run")
def inference_run(
    body: RunRequest,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Run inference with a path to data (H-0009)."""
    job = _get_job_or_404(body.job_id, job_store)
    try:
        record = run_inference(
            job=job,
            job_store=job_store,
            backend=ws.backend,
            data_path=body.data.path,
            return_shap=body.return_shap,
            evaluate=body.evaluate,
        )
        return {"inf_id": record.inf_id, "job_id": record.job_id}
    except Exception as exc:
        raise BackendError(exc) from exc


@router.post("/upload")
async def inference_upload(
    file: UploadFile,
) -> dict[str, str]:
    """Upload data file for inference (H-0015)."""
    suffix = ".csv"
    if file.filename and file.filename.endswith(".parquet"):
        suffix = ".parquet"
    content = await file.read()
    with tempfile.NamedTemporaryFile(
        suffix=suffix, delete=False, prefix="lizystudio_"
    ) as tmp:
        tmp.write(content)
        tmp_path = tmp.name
    return {"upload_path": tmp_path, "filename": file.filename or "upload"}


# --- Query ---


@router.get("/history")
def inference_history(
    job_id: str | None = None,
    job_store: JobStore = Depends(get_job_store),
) -> list[dict[str, Any]]:
    """List inference records. job_id optional — omit for all records (H-0010)."""
    store = _get_inf_store(job_store)
    records = store.list_all() if job_id is None else store.list(job_id)
    return [asdict(r) for r in records]


@router.get("/{inf_id}")
def inference_get(
    inf_id: str,
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get inference record metadata."""
    store = _get_inf_store(job_store)
    record = store.get(job_id, inf_id)
    if record is None:
        raise InferenceNotFoundError(inf_id)
    return asdict(record)


@router.get("/{inf_id}/predictions")
def inference_predictions(
    inf_id: str,
    job_id: str,
    rows: int = 50,
    offset: int = 0,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get paginated predictions table."""
    store = _get_inf_store(job_store)
    record = store.get(job_id, inf_id)
    if record is None:
        raise InferenceNotFoundError(inf_id)
    return store.get_predictions(job_id, inf_id, rows=rows, offset=offset)


@router.get("/{inf_id}/metrics")
def inference_metrics(
    inf_id: str,
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get inference metrics (requires ground truth)."""
    store = _get_inf_store(job_store)
    record = store.get(job_id, inf_id)
    if record is None:
        raise InferenceNotFoundError(inf_id)
    metrics = store.get_metrics(job_id, inf_id)
    if metrics is None:
        raise InferenceNotFoundError(f"{inf_id}/metrics (no ground truth)")
    return metrics


@router.get("/{inf_id}/plot/{plot_type}")
def inference_plot(
    inf_id: str,
    plot_type: str,
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
    ws: WorkspaceState = Depends(get_workspace),
) -> dict[str, str]:
    """Get a plot from the model used for inference."""
    store = _get_inf_store(job_store)
    record = store.get(job_id, inf_id)
    if record is None:
        raise InferenceNotFoundError(inf_id)
    # Load model from the parent job and generate plot
    job = job_store.get(job_id)
    if job is None or job.model_path is None:
        raise JobNotFoundError(job_id)
    try:
        plot_data = get_inference_plot(job, ws.backend, plot_type)
        return {"plotly_json": plot_data.plotly_json}
    except Exception as exc:
        raise BackendError(exc) from exc


@router.get("/{inf_id}/download")
def inference_download(
    inf_id: str,
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> StreamingResponse:
    """Download predictions as CSV."""
    store = _get_inf_store(job_store)
    record = store.get(job_id, inf_id)
    if record is None:
        raise InferenceNotFoundError(inf_id)
    df = store.get_predictions_df(job_id, inf_id)
    if df is None:
        raise InferenceNotFoundError(inf_id)
    buf = StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)
    filename = f"inference_{inf_id}_{job_id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{inf_id}/comparison/{other_inf_id}")
def inference_comparison(
    inf_id: str,
    other_inf_id: str,
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Compare two inference runs."""
    store = _get_inf_store(job_store)

    # Resolve task type from the job's config
    task = "regression"
    record = store.get(job_id, inf_id)
    if record is not None:
        job = job_store.get(record.job_id)
        if job is not None:
            task = job.config.get("model", {}).get("task", "regression")

    return get_comparison_stats(store, job_id, inf_id, other_inf_id, task=task)
