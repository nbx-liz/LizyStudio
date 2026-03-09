"""Training service — run fit/tune jobs (BLUEPRINT §4.2.4, H-0002 Case B)."""

from __future__ import annotations

import io
import logging
import traceback
from datetime import datetime, timezone
from typing import Any

from lizystudio.backends.base import BackendAdapter, ProgressCallback
from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.services.jobs import Job, JobStore


def run_fit(
    *,
    job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    config: dict[str, Any],
    dataframe: Any,
    params: dict[str, Any] | None = None,
    on_progress: ProgressCallback | None = None,
) -> Job:
    """Execute a fit job synchronously. Updates job in-place and on disk."""
    job.status = "running"
    job_store.update(job)

    # Capture execution logs from backend
    log_buffer = io.StringIO()
    handler = logging.StreamHandler(log_buffer)
    handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)

    try:
        model = backend.create_model(config, dataframe)
        fit_result: FitSummary = backend.fit(
            model, params=params, on_progress=on_progress
        )
        # Export model
        model_dir = str(job_store.jobs_dir / job.job_id / "model")
        backend.export_model(model, model_dir)
        # Update job
        job.status = "completed"
        job.fit_result = fit_result
        job.model_path = model_dir
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
    except Exception as exc:
        job.status = "failed"
        job.error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
    finally:
        root_logger.removeHandler(handler)
        handler.close()
        log_path = job_store.jobs_dir / job.job_id / "execution.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(log_buffer.getvalue(), encoding="utf-8")

    return job


def run_tune(
    *,
    job: Job,
    job_store: JobStore,
    backend: BackendAdapter,
    config: dict[str, Any],
    dataframe: Any,
    on_progress: ProgressCallback | None = None,
) -> Job:
    """Execute a tune job: tune -> auto-fit with best params (H-0002 B)."""
    job.status = "running"
    job_store.update(job)

    # Capture execution logs from backend
    log_buffer = io.StringIO()
    handler = logging.StreamHandler(log_buffer)
    handler.setLevel(logging.DEBUG)
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)

    try:
        model = backend.create_model(config, dataframe)
        tune_result: TuningSummary = backend.tune(model, on_progress=on_progress)
        job.tune_result = tune_result
        # Auto-fit with best params
        model2 = backend.create_model(config, dataframe)
        fit_result: FitSummary = backend.fit(model2, params=tune_result.best_params)
        # Export model (the one fit with best params)
        model_dir = str(job_store.jobs_dir / job.job_id / "model")
        backend.export_model(model2, model_dir)
        job.status = "completed"
        job.fit_result = fit_result
        job.model_path = model_dir
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
    except Exception as exc:
        job.status = "failed"
        job.error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        job.completed_at = datetime.now(timezone.utc).isoformat()
        job_store.update(job)
    finally:
        root_logger.removeHandler(handler)
        handler.close()
        log_path = job_store.jobs_dir / job.job_id / "execution.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(log_buffer.getvalue(), encoding="utf-8")

    return job
