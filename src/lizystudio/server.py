"""FastAPI application for LizyStudio."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from lizystudio.api import backends, files, inference, jobs, workspace
from lizystudio.api.errors import (
    StudioError,
    studio_error_handler,
    validation_error_handler,
)
from lizystudio.backends.registry import get_adapter
from lizystudio.services.jobs import JobStore
from lizystudio.services.workspace import WorkspaceState
from lizystudio.ws.progress import ProgressBroadcaster, websocket_progress

STATIC_DIR = Path(__file__).parent / "static"


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
        pass


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
