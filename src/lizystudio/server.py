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

from fastapi import Depends, FastAPI, Request, Response, WebSocket
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
from lizystudio.api.deps import get_broadcaster
from lizystudio.api.errors import (
    StudioError,
    studio_error_handler,
    validation_error_handler,
)
from lizystudio.backends.registry import get_adapter
from lizystudio.metrics import MetricsRegistry
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

    # A-9: per-app Prometheus registry. Instantiated before ``lifespan``
    # so both the metrics_middleware closure below and the JobStore can
    # bind to the same registry. Each ``create_app()`` invocation builds
    # a fresh :class:`CollectorRegistry`, so two apps can coexist in
    # the same process (e.g. pytest).
    metrics = MetricsRegistry()

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        adapter = get_adapter(backend_name)
        # Eagerly import the ML backend to avoid import-lock deadlocks
        # when concurrent API requests trigger lazy imports in threads.
        _warmup_adapter(adapter)
        application.state.metrics = metrics
        application.state.workspace = WorkspaceState(backend=adapter)
        application.state.job_store = JobStore(jobs_dir, metrics=metrics)
        broadcaster = ProgressBroadcaster(metrics=metrics)
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

        metrics.requests_total.labels(
            method=request.method,
            path=label_path,
            status=str(response.status_code),
        ).inc()
        metrics.request_duration.labels(
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
    async def ws_job_progress(
        ws: WebSocket,
        job_id: str,
        broadcaster: ProgressBroadcaster = Depends(get_broadcaster),
    ) -> None:
        await websocket_progress(ws, job_id, broadcaster)

    # H-0069: expose the WebSocket message Pydantic union in OpenAPI so
    # openapi-typescript generates a concrete `WsMessage` type for the
    # frontend to import instead of hand-maintaining a duplicate.  The
    # schema is injected into ``components.schemas`` without adding a
    # real HTTP endpoint.
    _install_ws_message_schema(application)

    # Serve built frontend (production).
    # C-12: surface misconfigured deployments at startup instead of
    # silently 404-ing every SPA request — an ops person now sees a
    # single warning line at boot if the pnpm build artefacts are
    # missing / mounted at the wrong path.
    if not STATIC_DIR.is_dir() or not (STATIC_DIR / "index.html").exists():
        logger.warning(
            "Static assets directory missing or empty at %s — "
            "SPA requests will 404. Run `pnpm build` or point "
            "STATIC_DIR at the frontend dist/.",
            STATIC_DIR,
        )
    if STATIC_DIR.is_dir() and (STATIC_DIR / "index.html").exists():
        application.mount(
            "/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets"
        )

        @application.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            """Serve the SPA — all non-API/WS routes return index.html.

            Excluded from OpenAPI so the schema is identical whether or
            not the frontend build artefacts exist (C-1 drift gate).
            """
            if full_path.startswith(("api/", "ws/")):
                # C-8: use the StudioError envelope so the frontend's
                # ``isStudioError`` path handles this uniformly instead
                # of falling back to "API error 404".
                raise StudioError("NOT_FOUND", f"Route not found: /{full_path}", 404)
            from lizystudio.security import validate_static_path

            safe = validate_static_path(STATIC_DIR / full_path, STATIC_DIR)
            if safe is not None:
                return FileResponse(safe)
            return FileResponse(STATIC_DIR / "index.html")

    return application


def _install_ws_message_schema(application: FastAPI) -> None:
    """Inject ``WsMessage`` and its variants into ``components.schemas``.

    The WebSocket handler is not a regular HTTP route, so FastAPI's
    OpenAPI builder does not discover its Pydantic models on its own.
    We override ``app.openapi`` so the generated document carries
    ``WsMessage`` / ``WsProgress`` / ``WsCompleted`` / ``WsError`` /
    ``WsPing`` schemas — ``openapi-typescript`` then emits a typed
    union the frontend can import directly.
    """
    from fastapi.openapi.utils import get_openapi
    from pydantic import TypeAdapter

    from lizystudio.ws.messages import (
        WsCompleted,
        WsError,
        WsMessage,
        WsPing,
        WsProgress,
    )

    # Clear any schema that FastAPI may have already cached before this
    # hook was installed — otherwise the first call returns the
    # pre-injection version and locks it in for the life of the app.
    application.openapi_schema = None

    def _custom_openapi() -> dict[str, Any]:
        if application.openapi_schema:
            return application.openapi_schema
        schema = get_openapi(
            title=application.title,
            version=application.version,
            openapi_version=application.openapi_version,
            description=application.description,
            routes=application.routes,
        )
        components = schema.setdefault("components", {})
        schemas = components.setdefault("schemas", {})
        ws_schema = TypeAdapter(WsMessage).json_schema(
            ref_template="#/components/schemas/{model}",
        )
        # TypeAdapter emits `$defs` for the referenced variants; lift
        # them into `components.schemas` so openapi-typescript resolves
        # the refs correctly.
        for name, body in ws_schema.pop("$defs", {}).items():
            schemas[name] = body
        # Also register the union itself as a named schema so
        # consumers can `import { WsMessage } from schema`.
        schemas["WsMessage"] = ws_schema
        # Deterministic ordering — keeps the generated schema.d.ts
        # stable across dumps so the api-types-drift CI job does not
        # flap on dict ordering.
        for model in (WsProgress, WsCompleted, WsError, WsPing):
            name = model.__name__
            if name not in schemas:
                schemas[name] = model.model_json_schema(
                    ref_template="#/components/schemas/{model}",
                )
        application.openapi_schema = schema
        return schema

    application.openapi = _custom_openapi  # type: ignore[method-assign]


# Module-level app for uvicorn (used by CLI: uvicorn lizystudio.server:app)
app = create_app()
