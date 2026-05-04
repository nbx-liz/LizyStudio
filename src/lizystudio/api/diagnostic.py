"""Diagnostic export endpoint (R-3.4 / P-0097).

Returns a small JSON snapshot a user can attach to a support request
without leaking JobStore internals or shipping multi-megabyte
artefacts. Heavy data (fit_result.json, model.pkl) stays on disk —
the support team asks for it separately if they need it.

Schema version 1:

    {
      "schema_version": 1,
      "timestamp": "2026-05-04T...Z",
      "job": {
        "job_id": str,
        "status": str,
        "job_type": str,
        "backend_name": str,
        "config": dict,
        "data_ref": dict | None,
        "error": str | None,
        "created_at": str | None,
        "completed_at": str | None,
        "parent_job_id": str | None
      },
      "system": {
        "platform": str,        # e.g. "linux"
        "python_version": str,  # e.g. "3.11.14"
        "lizystudio_version": str,
        "lizyml_version": str
      }
    }
"""

from __future__ import annotations

import platform
import sys
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Query

from lizystudio.api.errors import JobNotFoundError
from lizystudio.services.jobs import JobStore, get_job_store

router = APIRouter()

DIAGNOSTIC_SCHEMA_VERSION = 1


def _safe_lizyml_version() -> str:
    """Read lizyml's installed version via importlib.metadata so the
    diagnostic export does not import the ML backend directly (the
    api layer is forbidden from importing ``lizyml`` per the layer
    audit in ``tests/test_layer_audit.py``)."""
    try:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("lizyml")
        except PackageNotFoundError:
            return "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def _safe_lizystudio_version() -> str:
    try:
        from importlib.metadata import PackageNotFoundError, version

        try:
            return version("lizystudio")
        except PackageNotFoundError:
            return "unknown"
    except Exception:  # noqa: BLE001
        return "unknown"


def _serialise_data_ref(data_ref: Any) -> dict[str, Any] | None:
    if data_ref is None:
        return None
    # ``isinstance(data_ref, type)`` filters out the dataclass *class*
    # itself; ``asdict`` only operates on instances.
    if is_dataclass(data_ref) and not isinstance(data_ref, type):
        return asdict(data_ref)
    if isinstance(data_ref, dict):
        return dict(data_ref)
    return None


@router.get("/export")
def diagnostic_export(
    job_id: str = Query(..., min_length=1),
    job_store: JobStore = Depends(get_job_store),
) -> dict[str, Any]:
    """Return a sanitised diagnostic snapshot for ``job_id``.

    Echoes the user-supplied config + data_ref so the support team can
    reproduce a bug without asking for extra files. Internal JobStore
    paths and the on-disk model_path are NOT included — they are
    user-laptop-specific and add no diagnostic value.
    """
    job = job_store.get(job_id)
    if job is None:
        raise JobNotFoundError(job_id)

    return {
        "schema_version": DIAGNOSTIC_SCHEMA_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "job": {
            "job_id": job.job_id,
            "status": job.status,
            "job_type": job.job_type,
            "backend_name": job.backend_name,
            "config": job.config,
            "data_ref": _serialise_data_ref(job.data_ref),
            "error": job.error,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "parent_job_id": job.parent_job_id,
        },
        "system": {
            "platform": platform.system().lower(),
            "python_version": (
                f"{sys.version_info.major}.{sys.version_info.minor}."
                f"{sys.version_info.micro}"
            ),
            "lizystudio_version": _safe_lizystudio_version(),
            "lizyml_version": _safe_lizyml_version(),
        },
    }
