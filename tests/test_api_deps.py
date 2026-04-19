"""Tests for the centralized API dependency module (A-8).

Covers:

- `api/deps` exposes factories that resolve the shared app.state objects.
- Invariant INV-DEPS-1: no router module may reach for `request.app.state.*`
  directly — every access must be mediated by `api/deps`. The readiness
  probe in `api/health.py` is the single allowed exception (it deliberately
  swallows `app.state` access failures to return 503 instead of 500 when the
  lifespan hasn't finished initializing state).

RED expectations before implementation:

- `lizystudio.api.deps` does not exist → imports fail.
- Routers still access `request.app.state.broadcaster|workspace|job_store`
  outside the readiness allowlist → AST audit fails.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_DIR = _REPO_ROOT / "src" / "lizystudio" / "api"
_SERVER_PY = _REPO_ROOT / "src" / "lizystudio" / "server.py"

# Files where `request.app.state.*` is still allowed.  `health.py` uses the
# raw attribute access inside a broad try/except so the readiness probe can
# reply 503 rather than 500 when the lifespan has not finished running yet
# — converting that to `Depends(...)` would raise AttributeError at binding
# time and break the contract.  Keep this allowlist tight; do not add new
# entries without also adding a counterpart invariant test.
_ALLOWLIST: frozenset[str] = frozenset({"health.py"})


def test_api_deps_module_importable() -> None:
    """`lizystudio.api.deps` exists and is a real module."""
    import importlib

    deps = importlib.import_module("lizystudio.api.deps")
    assert hasattr(deps, "get_workspace"), "deps must re-export get_workspace"
    assert hasattr(deps, "get_job_store"), "deps must re-export get_job_store"
    assert hasattr(deps, "get_broadcaster"), "deps must expose get_broadcaster"
    assert hasattr(deps, "get_backend"), "deps must expose get_backend"


def test_get_broadcaster_returns_app_state_broadcaster(client: TestClient) -> None:
    """`get_broadcaster` resolves to the live broadcaster on app.state."""
    from lizystudio.api.deps import get_broadcaster

    # TestClient's portal exposes the FastAPI app via .app
    app = client.app
    broadcaster = app.state.broadcaster  # type: ignore[union-attr]

    # Build a stand-in Request with the right scope so Depends can call it
    from starlette.requests import Request

    scope = {"type": "http", "app": app}
    req = Request(scope=scope)
    resolved = get_broadcaster(req)
    assert resolved is broadcaster


def test_get_backend_returns_workspace_backend(client: TestClient) -> None:
    """`get_backend` resolves to `workspace.backend` off app.state."""
    from lizystudio.api.deps import get_backend

    app = client.app
    expected = app.state.workspace.backend  # type: ignore[union-attr]

    from starlette.requests import Request

    scope = {"type": "http", "app": app}
    req = Request(scope=scope)
    resolved = get_backend(req)
    assert resolved is expected


# --- INV-DEPS-1: no router may touch request.app.state.* outside allowlist ---


def _accesses_app_state(tree: ast.AST) -> list[str]:
    """Return every `*.app.state.<attr>` READ chain found in the AST.

    Matches patterns like `request.app.state.broadcaster` OR
    `application.state.foo`.  Only ``ast.Load`` contexts are flagged —
    lifespan assignments such as ``application.state.workspace = ...``
    use ``ast.Store`` and must not trigger the invariant.
    """
    hits: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        if not isinstance(node.ctx, ast.Load):
            continue
        inner = node.value
        if not isinstance(inner, ast.Attribute) or inner.attr != "state":
            continue
        innermost = inner.value
        if isinstance(innermost, ast.Attribute) and innermost.attr == "app":
            hits.append(f".app.state.{node.attr}")
        elif isinstance(innermost, ast.Name) and innermost.id in {
            "app",
            "application",
        }:
            hits.append(f"{innermost.id}.state.{node.attr}")
    return hits


def test_no_router_touches_app_state_directly() -> None:
    """Every router module goes through `api/deps` (INV-DEPS-1)."""
    offenders: list[str] = []
    for py in _API_DIR.glob("*.py"):
        if py.name in _ALLOWLIST or py.name == "deps.py":
            continue
        tree = ast.parse(py.read_text())
        hits = _accesses_app_state(tree)
        if hits:
            offenders.append(f"{py.name}: {hits}")
    assert not offenders, (
        "Routers must use api/deps.Depends(get_*) instead of raw "
        f"request.app.state access. Offenders: {offenders}"
    )


def test_server_ws_handler_uses_deps() -> None:
    """The WebSocket handler in server.py must not read app.state directly.

    The route definition in `create_app()` closes over `application`,
    so the offending pattern is `application.state.broadcaster`.  After
    the refactor this becomes a call into `api/deps.get_broadcaster`
    (with a `Request` proxy) or an equivalent factory.
    """
    tree = ast.parse(_SERVER_PY.read_text())
    hits = _accesses_app_state(tree)
    # The lifespan assignments (`application.state.workspace = ...`) are
    # *writes* and pass through ast.Assign targets — those don't count
    # because ast.walk visits them as Attribute nodes too. Accept only
    # reads within the WS handler body.
    read_hits = [h for h in hits if h.endswith(".broadcaster")]
    assert not read_hits, (
        "server.ws_job_progress must resolve the broadcaster via "
        f"api/deps, not app.state. Offenders: {read_hits}"
    )


# --- no duplicate _get_broadcaster helpers ---


def test_no_duplicate_get_broadcaster_helpers() -> None:
    """`_get_broadcaster` must exist in at most one place (api/deps)."""
    offenders: list[str] = []
    for py in _API_DIR.glob("*.py"):
        if py.name == "deps.py":
            continue
        src = py.read_text()
        if "_get_broadcaster" in src or "def get_broadcaster" in src:
            offenders.append(py.name)
    assert not offenders, (
        f"Broadcaster helpers must live in api/deps only. Offenders: {offenders}"
    )
