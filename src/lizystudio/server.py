"""FastAPI application for LizyStudio."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from lizystudio.api import (
    backends,
    files,
    health,
    inference,
    jobs,
    metrics_api,
    workspace,
)
from lizystudio.api.errors import (
    StudioError,
    studio_error_handler,
    validation_error_handler,
)
from lizystudio.backends.registry import get_adapter
from lizystudio.metrics import REQUEST_DURATION, REQUESTS_TOTAL
from lizystudio.services.jobs import JobStore
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster, websocket_progress

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

# --- Security headers (H-0039) ---

_CSP_PRODUCTION = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "connect-src 'self' ws://localhost:* wss://localhost:*; "
    "img-src 'self' data: blob:; "
    "font-src 'self'"
)

_CSP_DEV = (
    "default-src 'self' http://localhost:*; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; "
    "style-src 'self' 'unsafe-inline'; "
    "connect-src 'self' ws://localhost:* wss://localhost:* http://localhost:*; "
    "img-src 'self' data: blob:; "
    "font-src 'self'"
)


def _warmup_adapter(adapter: object) -> None:
    """Pre-import ML backend modules to avoid import-lock deadlocks.

    When uvicorn serves concurrent requests, lazy ``import lizyml`` calls
    from different threads can deadlock on Python's global import lock.
    Calling ``info`` and ``get_ui_schema`` once during startup (single-
    threaded lifespan) forces the import to complete safely.
    """
    try:
        _ = adapter.info  # type: ignore[attr-defined]
        if hasattr(adapter, "get_ui_schema"):
            adapter.get_ui_schema()
    except Exception:  # noqa: BLE001
        # Non-fatal: the adapter may work once imports settle.
        logger.warning("Adapter warmup failed", exc_info=True)


def create_app() -> FastAPI:
    """Application factory.

    Settings are read from environment variables so they survive uvicorn
    ``--reload`` restarts:

    - ``LIZYSTUDIO_BACKEND`` — adapter name (default: ``"lizyml"``)
    - ``LIZYSTUDIO_JOBS_DIR`` — job storage directory (default: ``.lizystudio/jobs``)
    """
    backend_name = os.environ.get("LIZYSTUDIO_BACKEND", "lizyml")
    jobs_dir = Path(os.environ.get("LIZYSTUDIO_JOBS_DIR", ".lizystudio/jobs"))

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        adapter = get_adapter(backend_name)
        # Eagerly import the ML backend to avoid import-lock deadlocks
        # when concurrent API requests trigger lazy imports in threads.
        _warmup_adapter(adapter)
        application.state.workspace = WorkspaceState(backend=adapter)
        application.state.job_store = JobStore(jobs_dir)
        broadcaster = ProgressBroadcaster()
        broadcaster.set_loop(asyncio.get_running_loop())
        application.state.broadcaster = broadcaster
        yield

    application = FastAPI(
        title="LizyStudio",
        description="Web GUI for LizyML",
        lifespan=lifespan,
    )

    # Security headers middleware (H-0039) — must be added before CORS
    is_dev = os.environ.get("LIZYSTUDIO_RELOAD", "") == "1"
    csp_value = _CSP_DEV if is_dev else _CSP_PRODUCTION

    @application.middleware("http")
    async def security_headers_middleware(
        request: Request,
        call_next: Any,  # noqa: ANN401
    ) -> Response:
        response: Response = await call_next(request)
        response.headers["Content-Security-Policy"] = csp_value
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=()"
        )
        return response

    # Prometheus metrics middleware (H-0065). Added after security
    # headers so the decorator-order rule places it outermost: every
    # request is timed and counted before security_headers runs, which
    # means the counter reflects the raw HTTP surface rather than
    # post-filter traffic. `/api/metrics` itself is excluded so scrape
    # traffic does not pollute the baseline.
    @application.middleware("http")
    async def metrics_middleware(
        request: Request,
        call_next: Any,  # noqa: ANN401
    ) -> Response:
        path = request.url.path
        if path == "/api/metrics":
            excluded: Response = await call_next(request)
            return excluded

        start = time.perf_counter()
        response: Response = await call_next(request)
        elapsed = time.perf_counter() - start

        # Collapse path to a route template to keep label cardinality
        # bounded. `request.scope["route"]` is populated after routing,
        # but starlette only sets it for matched routes; unmatched 4xx
        # paths fall back to a sentinel string.
        route = request.scope.get("route")
        label_path = getattr(route, "path", None) or "unmatched"

        REQUESTS_TOTAL.labels(
            method=request.method,
            path=label_path,
            status=str(response.status_code),
        ).inc()
        REQUEST_DURATION.labels(
            method=request.method,
            path=label_path,
        ).observe(elapsed)
        return response

    # CORS — allow frontend dev server during development
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Exception handlers
    application.add_exception_handler(StudioError, studio_error_handler)  # type: ignore[arg-type]
    application.add_exception_handler(RequestValidationError, validation_error_handler)

    # API routers (BLUEPRINT §5.2–§5.4)
    application.include_router(
        workspace.router, prefix="/api/workspace", tags=["workspace"]
    )
    application.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
    application.include_router(
        inference.router, prefix="/api/inference", tags=["inference"]
    )
    application.include_router(
        backends.router, prefix="/api/backends", tags=["backends"]
    )
    application.include_router(files.router, prefix="/api/files", tags=["files"])
    # BLUEPRINT §5.8 / H-0064 — liveness + readiness probes
    application.include_router(health.router, prefix="/api/health", tags=["health"])
    # BLUEPRINT §5.9 / H-0065 — Prometheus metrics exposition
    application.include_router(
        metrics_api.router, prefix="/api/metrics", tags=["metrics"]
    )

    # WebSocket route for job progress (BLUEPRINT §5.5)
    @application.websocket("/ws/jobs/{job_id}/progress")
    async def ws_job_progress(ws: WebSocket, job_id: str) -> None:
        broadcaster: ProgressBroadcaster = application.state.broadcaster
        await websocket_progress(ws, job_id, broadcaster)

    # Serve built frontend (production)
    if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
        application.mount(
            "/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets"
        )

        @application.get("/{full_path:path}")
        async def serve_spa(full_path: str) -> FileResponse:
            """Serve the SPA — all non-API/WS routes return index.html."""
            if full_path.startswith(("api/", "ws/")):
                raise HTTPException(status_code=404, detail="Not found")
            from lizystudio.security import validate_static_path

            safe = validate_static_path(STATIC_DIR / full_path, STATIC_DIR)
            if safe is not None:
                return FileResponse(safe)
            return FileResponse(STATIC_DIR / "index.html")

    return application


# Module-level app for uvicorn (used by CLI: uvicorn lizystudio.server:app)
app = create_app()
