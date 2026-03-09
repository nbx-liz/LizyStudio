"""Jobs API router — list, get, and stubs for job management.

Full endpoints (metrics, plots, export, etc.) are implemented in Phase 5–6.
"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends

from lizystudio.api.errors import JobNotFoundError
from lizystudio.services.jobs import JobStore, get_job_store

router = APIRouter()


@router.get("/")
def list_jobs(
    status: str | None = None,
    sort: str = "created_at",
    job_store: JobStore = Depends(get_job_store),
) -> list[dict[str, Any]]:
    """List all jobs, optionally filtered by status."""
    jobs = job_store.list(status=status, sort=sort)
    return [_job_summary(j) for j in jobs]


@router.get("/{job_id}")
def get_job(
    job_id: str,
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Get job details."""
    job = job_store.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)
    result: dict[str, Any] = _job_summary(job)
    if job.fit_result is not None:
        result["fit_result"] = asdict(job.fit_result)
    if job.tune_result is not None:
        result["tune_result"] = asdict(job.tune_result)
    return result


def _job_summary(job: Any) -> dict[str, Any]:
    return {
        "job_id": job.job_id,
        "status": job.status,
        "backend_name": job.backend_name,
        "job_type": job.job_type,
        "created_at": job.created_at,
        "completed_at": job.completed_at,
        "error": job.error,
    }
