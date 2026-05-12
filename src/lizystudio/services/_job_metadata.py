"""Job metadata persistence — pure on-disk CRUD for the job index (#451).

Extracted from ``services/jobs.py`` so the latter can become a thin
orchestrator over focused collaborators (``JobMetadataStore``,
``ActiveJobSlot``, ``JobControlFlags``, ``JobLineage``).

This module owns:

- the :data:`Job` dataclass (persistent job metadata),
- the BLUEPRINT §3.4.4 on-disk layout (:data:`ARTIFACT_FILENAMES` +
  :func:`artifact_path`) and the cancel/pause IPC flag filenames,
- :class:`JobMetadataStore` — create / get / list / update + the
  versioned-JSON round-trip (C-9 / H-0081) for ``meta.json`` /
  ``fit_result.json`` / ``tune_result.json``.

It has **no** knowledge of concurrency (the active slot), cancel/pause
flags, or lineage — those concerns live in their own collaborators that
:class:`~lizystudio.services.jobs.JobStore` wires together.
"""

from __future__ import annotations

import builtins
import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.security import validate_path_within
from lizystudio.storage.versions import read_versioned_json, write_versioned_json

_logger = logging.getLogger(__name__)


# Issue #152: filename of the on-disk cancel flag. In subprocess mode
# the child constructs a fresh JobStore whose in-memory
# ``_cancel_requested`` set is disjoint from the parent's. The flag
# file is the IPC channel that lets the child observe the parent's
# ``request_cancel`` between trials, so cooperative cancel (H-0011)
# actually fires before the SIGTERM escalation.
CANCEL_FLAG_FILENAME = "CANCEL"

# P-0099 v3-20c: on-disk pause flag mirrors the cancel-flag IPC pattern
# so the subprocess child's fresh JobStore observes pause requests at
# the cancel-aware callback boundary even though its in-memory
# ``_pause_requested`` set is disjoint from the parent's.
PAUSE_FLAG_FILENAME = "PAUSE"


# A-10: BLUEPRINT §3.4.4 on-disk layout for a single job. Centralising
# this map is the core of the path-layout SSOT — every artifact filename
# lives here, and every caller goes through ``JobStore.path_for`` (or
# the module-level :func:`artifact_path` helper, used by call sites
# that have a ``jobs_dir`` but no ``JobStore`` instance).
ArtifactKind = Literal[
    "meta",
    "fit_result",
    "tune_result",
    "model",
    "log",
    "tuning_plot",
    "cancel_flag",
    "pause_flag",
]

ARTIFACT_FILENAMES: dict[ArtifactKind, str] = {
    "meta": "meta.json",
    "fit_result": "fit_result.json",
    "tune_result": "tune_result.json",
    "model": "model",  # directory (see load/save in adapters)
    "log": "execution.log",
    "tuning_plot": "tuning_plot.json",
    "cancel_flag": CANCEL_FLAG_FILENAME,
    "pause_flag": PAUSE_FLAG_FILENAME,
}


def artifact_path(jobs_dir: Path, job_id: str, kind: ArtifactKind) -> Path:
    """Resolve ``{jobs_dir}/{job_id}/<artifact>`` without a ``JobStore``.

    ``JobStore.path_for`` is the preferred entry point (it also applies
    path-traversal guards). This helper exists for call sites — e.g.
    :mod:`lizystudio.services.job_results` — that hold a ``Job`` and can
    derive ``jobs_dir`` from ``Job.model_path`` but do not own the
    ``JobStore`` instance. Callers are responsible for validating
    ``job_id`` when it is user-controlled.
    """
    return jobs_dir / job_id / ARTIFACT_FILENAMES[kind]


def write_job_json(path: Path, data: dict[str, Any]) -> None:
    """Write a Studio-owned JSON artefact with ``format_version`` embedded.

    Routes through :func:`lizystudio.storage.versions.write_versioned_json`
    (C-9 / H-0081) so every persisted file declares its schema version.
    ``data`` must already be a dict — fit/tune results and job meta all
    derive from ``asdict(...)`` so this is satisfied at the one call site
    that serialises a dataclass directly.
    """
    write_versioned_json(path, data)


def read_job_json(path: Path) -> dict[str, Any]:
    """Load a versioned JSON artefact and run migrations if needed.

    Returns the migrated domain payload with the ``format_version``
    sentinel stripped, so callers consume the same shape regardless of
    whether the file was written by a pre-C-9 or post-C-9 runtime
    (missing key is treated as v0 per H-0081).
    """
    _, payload = read_versioned_json(path)
    return payload


@dataclass
class Job:
    """Persistent job metadata."""

    job_id: str
    # P-0099 v3-20a: ``paused`` is a non-terminal state introduced for
    # R-1.4 (Tune long-run resumability, Issue #360). The state machine
    # contract (legal transitions, slot ownership, terminal vs non-
    # terminal classification) is declared in
    # ``tests/regression/test_inv_state_machine.py``; runtime assertion
    # of illegal transitions lives in ``JobStore.set_status`` alongside
    # the ``request_pause`` / ``PausedError`` plumbing.
    status: Literal[
        "pending",
        "running",
        "completed",
        "failed",
        "cancelled",
        "paused",
    ]
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
    # H-0062: job lineage for Re-tune / Resume child jobs. Optional so
    # existing jobs on disk (written before Phase B) continue to load.
    parent_job_id: str | None = None


class JobMetadataStore:
    """Disk-backed CRUD for job metadata (BLUEPRINT §3.4.2 / §3.4.4).

    Owns nothing but ``jobs_dir`` and the read/write path. Concurrency,
    cancel/pause, lineage and the model cache are external collaborators'
    business — keeping this class side-effect-light makes it trivial to
    set up in invariant tests.
    """

    def __init__(self, jobs_dir: Path) -> None:
        self.jobs_dir = jobs_dir
        self.jobs_dir.mkdir(parents=True, exist_ok=True)

    # --- Path resolution (A-10) ---

    def job_dir(self, job_id: str) -> Path:
        """Resolve the job directory with a path-traversal guard.

        Callers should prefer :meth:`path_for` for named artifacts and
        reserve :meth:`job_dir` for cases that need the directory itself
        (e.g. the checkpoint base dir for subprocess runners).
        """
        candidate = (self.jobs_dir / job_id).resolve()
        validate_path_within(candidate, self.jobs_dir)
        return candidate

    def path_for(self, job_id: str, kind: ArtifactKind) -> Path:
        """Resolve the on-disk path of a named job artifact.

        Backed by the module-level :data:`ARTIFACT_FILENAMES` map so the
        layout stays a single source of truth. The returned path is
        already guarded against traversal via :meth:`job_dir`.
        """
        return self.job_dir(job_id) / ARTIFACT_FILENAMES[kind]

    # --- CRUD ---

    def create(
        self,
        *,
        backend_name: str,
        config: dict[str, Any],
        data_ref: DataRef,
        job_type: Literal["fit", "tune"],
        parent_job_id: str | None = None,
    ) -> Job:
        """Create a new pending job and persist its metadata.

        When *parent_job_id* is provided the new job is recorded as a
        child in the lineage graph (H-0062).
        """
        job_id = f"job_{uuid4().hex[:8]}"
        job = Job(
            job_id=job_id,
            status="pending",
            backend_name=backend_name,
            config=config,
            data_ref=data_ref,
            job_type=job_type,
            created_at=datetime.now(timezone.utc).isoformat(),
            parent_job_id=parent_job_id,
        )
        self.save_meta(job)
        return job

    def get(self, job_id: str) -> Job | None:
        """Load a job by ID. Returns ``None`` if not found."""
        if not self.path_for(job_id, "meta").exists():
            return None
        return self.load_job(job_id)

    def list(
        self,
        *,
        status: str | None = None,
        sort: str = "created_at",
    ) -> builtins.list[Job]:
        """List all jobs, optionally filtered/sorted.

        Entries that disappear or become unreadable between ``iterdir``
        and :meth:`load_job` (concurrent delete, partial write, corrupted
        meta.json) are skipped with a warning rather than crashing the
        whole listing.
        """
        jobs: builtins.list[Job] = []
        if not self.jobs_dir.exists():
            return jobs
        for d in self.jobs_dir.iterdir():
            if not d.is_dir() or not (d / "meta.json").exists():
                continue
            try:
                job = self.load_job(d.name)
            except (FileNotFoundError, OSError, json.JSONDecodeError, KeyError):
                _logger.warning(
                    "Skipping unreadable job directory %s", d.name, exc_info=True
                )
                continue
            if status is None or job.status == status:
                jobs.append(job)
        _SORTABLE_FIELDS = {
            "created_at",
            "completed_at",
            "status",
            "job_type",
            "backend_name",
        }
        safe_sort = sort if sort in _SORTABLE_FIELDS else "created_at"
        reverse = True  # newest first
        jobs.sort(key=lambda j: getattr(j, safe_sort) or "", reverse=reverse)
        return jobs

    def update(self, job: Job) -> None:
        """Persist updated job state to disk (meta + result sidecars)."""
        self.save_meta(job)
        if job.fit_result is not None:
            write_job_json(
                self.path_for(job.job_id, "fit_result"),
                asdict(job.fit_result),
            )
        if job.tune_result is not None:
            write_job_json(
                self.path_for(job.job_id, "tune_result"),
                asdict(job.tune_result),
            )

    # --- Persistence internals ---

    def save_meta(self, job: Job) -> None:
        """Write ``meta.json`` for *job* (creating its directory)."""
        job_dir = self.job_dir(job.job_id)
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
            "parent_job_id": job.parent_job_id,
        }
        write_job_json(self.path_for(job.job_id, "meta"), meta)

    def load_job(self, job_id: str) -> Job:
        """Deserialise a job (meta + fit/tune result sidecars) from disk.

        Raises the underlying ``OSError`` / ``json.JSONDecodeError`` /
        ``KeyError`` if ``meta.json`` is missing or corrupt — callers
        that want a ``None`` fallback should go through :meth:`get`.
        """
        meta = read_job_json(self.path_for(job_id, "meta"))

        fit_result = None
        fit_path = self.path_for(job_id, "fit_result")
        if fit_path.exists():
            d = read_job_json(fit_path)
            fit_result = FitSummary(**d)

        tune_result = None
        tune_path = self.path_for(job_id, "tune_result")
        if tune_path.exists():
            d = read_job_json(tune_path)
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
            parent_job_id=meta.get("parent_job_id"),
        )
