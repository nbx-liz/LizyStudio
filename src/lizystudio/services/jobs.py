"""Job persistence — CRUD for fit/tune jobs on disk (BLUEPRINT §3.4.2/§3.4.4)."""

from __future__ import annotations

import json
import shutil
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import Request

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary


@dataclass
class Job:
    """Persistent job metadata."""

    job_id: str
    status: Literal["pending", "running", "completed", "failed"]
    backend_name: str
    config: dict[str, Any]
    data_ref: DataRef
    job_type: Literal["fit", "tune"]
    created_at: str  # ISO-8601
    completed_at: str | None = None
    fit_result: FitSummary | None = None
    tune_result: TuningSummary | None = None
    model_path: str | None = None
    error: str | None = None


class JobStore:
    """Disk-backed job store.

    Layout per BLUEPRINT §3.4.4::

        {jobs_dir}/{job_id}/meta.json
        {jobs_dir}/{job_id}/fit_result.json
        {jobs_dir}/{job_id}/tune_result.json
        {jobs_dir}/{job_id}/model/
    """

    def __init__(self, jobs_dir: Path) -> None:
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    # --- CRUD ---

    def create(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
    ) -> Job:
        """Create a new pending job and persist its metadata."""
        job_id = f"job_{uuid4().hex[:8]}"
        job = Job(
            job_id=job_id,
            status="pending",
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self._save_meta(job)
        return job

    def get(self, job_id: str) -> Job | None:
        """Load a job by ID. Returns ``None`` if not found."""
        meta_path = self.jobs_dir / job_id / "meta.json"
        if not meta_path.exists():
            return None
        return self._load_job(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> list[Job]:
        """List all jobs, optionally filtered/sorted."""
        jobs: list[Job] = []
        if not self.jobs_dir.exists():
            return jobs
        for d in self.jobs_dir.iterdir():
            if d.is_dir() and (d / "meta.json").exists():
                job = self._load_job(d.name)
                if status is None or job.status == status:
                    jobs.append(job)
        reverse = True  # newest first
        jobs.sort(key=lambda j: getattr(j, sort, j.created_at), reverse=reverse)
        return jobs

    def update(self, job: Job) -> None:
        """Persist updated job state to disk."""
        self._save_meta(job)
        if job.fit_result is not None:
            self._write_json(
                self.jobs_dir / job.job_id / "fit_result.json",
                asdict(job.fit_result),
            )
        if job.tune_result is not None:
            self._write_json(
                self.jobs_dir / job.job_id / "tune_result.json",
                asdict(job.tune_result),
            )

    def delete(self, job_id: str) -> bool:
        """Delete a job directory. Returns True if it existed."""
        job_dir = self.jobs_dir / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir)
            return True
        return False

    def get_log(self, job_id: str) -> str:
        """Read execution log for a job. Returns empty string if not found."""
        log_path = self.jobs_dir / job_id / "execution.log"
        if not log_path.exists():
            return ""
        return log_path.read_text(encoding="utf-8")

    # --- Internal helpers ---

    def _save_meta(self, job: Job) -> None:
        job_dir = self.jobs_dir / job.job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        meta = {
            "job_id": job.job_id,
            "status": job.status,
            "backend_name": job.backend_name,
            "config": job.config,
            "data_ref": asdict(job.data_ref),
            "job_type": job.job_type,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "model_path": job.model_path,
            "error": job.error,
        }
        self._write_json(job_dir / "meta.json", meta)

    def _load_job(self, job_id: str) -> Job:
        job_dir = self.jobs_dir / job_id
        meta = self._read_json(job_dir / "meta.json")

        fit_result = None
        fit_path = job_dir / "fit_result.json"
        if fit_path.exists():
            d = self._read_json(fit_path)
            fit_result = FitSummary(**d)

        tune_result = None
        tune_path = job_dir / "tune_result.json"
        if tune_path.exists():
            d = self._read_json(tune_path)
            tune_result = TuningSummary(**d)

        data_ref_dict = meta["data_ref"]
        data_ref_dict["shape"] = tuple(data_ref_dict["shape"])
        return Job(
            job_id=meta["job_id"],
            status=meta["status"],
            backend_name=meta["backend_name"],
            config=meta["config"],
            data_ref=DataRef(**data_ref_dict),
            job_type=meta["job_type"],
            created_at=meta["created_at"],
            completed_at=meta.get("completed_at"),
            fit_result=fit_result,
            tune_result=tune_result,
            model_path=meta.get("model_path"),
            error=meta.get("error"),
        )

    @staticmethod
    def _write_json(path: Path, data: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        text = json.dumps(data, ensure_ascii=False, default=str)
        path.write_text(text, encoding="utf-8")

    @staticmethod
    def _read_json(path: Path) -> Any:
        return json.loads(path.read_text(encoding="utf-8"))


def get_job_store(request: Request) -> JobStore:
    """FastAPI dependency — retrieve job store from app.state."""
    return request.app.state.job_store  # type: ignore[no-any-return]
