"""Health / readiness endpoints (BLUEPRINT §5.8, H-0064).

Issue #30 Phase 1. These endpoints intentionally have zero dependency
on workspace state and no authentication, so k8s liveness / readiness
probes and upstream proxies can reach them before any user session has
been established.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request, Response

from lizystudio import __version__
from lizystudio.services.workspace import get_backend_name

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("")
def liveness() -> dict[str, str]:
    """Liveness probe — always 200 while the ASGI app can serve requests.

    Must not touch app.state or any adapter; a flaky backend must not
    make k8s restart the whole pod.
    """
    return {"status": "ok", "version": __version__}


@router.get("/ready")
def readiness(request: Request, response: Response) -> dict[str, Any]:
    """Readiness probe — 200 when the app is ready to accept traffic.

    Checks the two heavyweight startup-time resources: the backend
    adapter (must expose `info.name`) and the JobStore base directory
    (must exist on disk). Returns 503 otherwise so upstream load
    balancers stop sending traffic.
    """
    backend_name: str | None = None
    try:
        workspace = request.app.state.workspace
        backend_name = get_backend_name(workspace)
    except Exception:  # noqa: BLE001 — any import/init failure => not ready
        logger.debug("readiness: backend probe failed", exc_info=True)
        backend_name = None

    jobs_dir_ok = False
    try:
        job_store = request.app.state.job_store
        jobs_dir_ok = job_store.jobs_dir.is_dir()
    except Exception:  # noqa: BLE001
        logger.debug("readiness: jobs_dir probe failed", exc_info=True)
        jobs_dir_ok = False

    ready = backend_name is not None and jobs_dir_ok
    if not ready:
        response.status_code = 503

    return {
        "status": "ready" if ready else "not_ready",
        "version": __version__,
        "backend": backend_name,
        "jobs_dir": jobs_dir_ok,
    }
