"""Tests for the C-8 / C-10 / C-12 mop-up batch.

C-8 — SPA catch-all 404 must use the StudioError envelope so the
frontend's ``getErrorMessage`` / ``isStudioError`` path handles it
uniformly instead of falling through to "API error 404".

C-10 — The WebSocket origin allowlist must be overridable via the
``LIZYSTUDIO_WS_ALLOWED_ORIGINS`` environment variable so remote
deployments don't need a source patch.

C-12 — When the static-assets directory is expected but empty (no
``index.html``), the application must log a clear warning at startup
instead of silently serving 404s for every non-API route.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# C-8 — SPA 404 returns StudioError envelope
# ---------------------------------------------------------------------------


def test_c8_spa_catchall_404_returns_studio_error_envelope() -> None:
    """GET /api/<unknown> must return the StudioError envelope, not the
    FastAPI default ``{"detail": "Not found"}``.
    """
    # Ensure STATIC_DIR exists so the catch-all route is registered.
    from lizystudio.server import STATIC_DIR, create_app

    with tempfile.TemporaryDirectory() as tmp:
        static_dir = Path(tmp)
        (static_dir / "index.html").write_text("<html>SPA</html>")
        (static_dir / "assets").mkdir()
        original = os.environ.get("LIZYSTUDIO_JOBS_DIR")
        os.environ["LIZYSTUDIO_JOBS_DIR"] = str(Path(tmp) / "jobs")
        # Patch STATIC_DIR module-level constant via monkey-patching.
        import lizystudio.server as server_module

        original_static = server_module.STATIC_DIR
        server_module.STATIC_DIR = static_dir
        try:
            app = create_app()
            with TestClient(app) as client:
                res = client.get("/api/definitely-not-a-real-endpoint")
                assert res.status_code == 404
                body = res.json()
                # StudioError envelope shape: {error: {code, message, details}}
                assert "error" in body, f"Expected error envelope, got: {body}"
                assert body["error"]["code"] == "NOT_FOUND"
        finally:
            server_module.STATIC_DIR = original_static
            if original is None:
                os.environ.pop("LIZYSTUDIO_JOBS_DIR", None)
            else:
                os.environ["LIZYSTUDIO_JOBS_DIR"] = original
        # Silence ruff about unused STATIC_DIR import
        _ = STATIC_DIR


# ---------------------------------------------------------------------------
# C-10 — WS origin allowlist is overridable via env
# ---------------------------------------------------------------------------


def test_c10_ws_allowed_origins_env_var_overrides_defaults(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Setting ``LIZYSTUDIO_WS_ALLOWED_ORIGINS`` replaces the hard-coded
    allowlist.
    """
    monkeypatch.setenv(
        "LIZYSTUDIO_WS_ALLOWED_ORIGINS",
        "https://studio.example.com,https://staging.example.com",
    )
    # H-0083: get_allowed_ws_origins() is lru_cache'd per process, so
    # tests that change the env must reset the cache before the call.
    from lizystudio.ws.progress import get_allowed_ws_origins

    get_allowed_ws_origins.cache_clear()
    origins = get_allowed_ws_origins()
    assert "https://studio.example.com" in origins
    assert "https://staging.example.com" in origins
    # Env override replaces defaults entirely
    assert "http://localhost:5173" not in origins


def test_c10_ws_allowed_origins_default_when_env_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """With no env override the default localhost set is returned."""
    monkeypatch.delenv("LIZYSTUDIO_WS_ALLOWED_ORIGINS", raising=False)
    from lizystudio.ws.progress import get_allowed_ws_origins

    get_allowed_ws_origins.cache_clear()
    origins = get_allowed_ws_origins()
    assert "http://localhost:5173" in origins
    assert "http://127.0.0.1:5173" in origins


def test_c10_ws_allowed_origins_ignores_blank_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Whitespace / empty entries in the env list must not appear in the
    allowlist (they would silently accept requests without an Origin
    header otherwise).
    """
    monkeypatch.setenv(
        "LIZYSTUDIO_WS_ALLOWED_ORIGINS",
        "https://a.example.com, ,https://b.example.com",
    )
    from lizystudio.ws.progress import get_allowed_ws_origins

    get_allowed_ws_origins.cache_clear()
    origins = get_allowed_ws_origins()
    assert "" not in origins
    assert "https://a.example.com" in origins
    assert "https://b.example.com" in origins


# ---------------------------------------------------------------------------
# H-0083 — WS origin allowlist cache behaviour
# ---------------------------------------------------------------------------


def test_h0083_ws_allowed_origins_is_cached_across_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Second call returns the value captured at the first call even if
    the env var was changed afterwards (Issue #234)."""
    from lizystudio.ws.progress import get_allowed_ws_origins

    monkeypatch.setenv("LIZYSTUDIO_WS_ALLOWED_ORIGINS", "https://first.example.com")
    get_allowed_ws_origins.cache_clear()
    first = get_allowed_ws_origins()
    assert "https://first.example.com" in first

    # Env change without cache_clear is NOT observed.
    monkeypatch.setenv("LIZYSTUDIO_WS_ALLOWED_ORIGINS", "https://second.example.com")
    cached = get_allowed_ws_origins()
    assert cached is first
    assert "https://second.example.com" not in cached


def test_h0083_ws_allowed_origins_cache_clear_reevaluates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """After ``cache_clear`` the helper reads the env again (Issue #234)."""
    from lizystudio.ws.progress import get_allowed_ws_origins

    monkeypatch.setenv("LIZYSTUDIO_WS_ALLOWED_ORIGINS", "https://first.example.com")
    get_allowed_ws_origins.cache_clear()
    first = get_allowed_ws_origins()
    assert "https://first.example.com" in first

    monkeypatch.setenv("LIZYSTUDIO_WS_ALLOWED_ORIGINS", "https://second.example.com")
    get_allowed_ws_origins.cache_clear()
    refreshed = get_allowed_ws_origins()
    assert "https://second.example.com" in refreshed
    assert "https://first.example.com" not in refreshed


# ---------------------------------------------------------------------------
# C-12 — STATIC_DIR sanity check at startup
# ---------------------------------------------------------------------------


def test_c12_missing_static_dir_logs_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When STATIC_DIR is unset / missing at app creation, a startup
    warning must be emitted so an ops person notices the misconfigured
    deployment before every SPA request 404s.
    """
    import lizystudio.server as server_module

    original = server_module.STATIC_DIR
    # Point at a path that definitely does not exist
    server_module.STATIC_DIR = Path("/tmp/lizystudio-does-not-exist-xyz")
    try:
        with caplog.at_level(logging.WARNING, logger="lizystudio.server"):
            server_module.create_app()
        # The warning should mention the static dir path or make the
        # situation discoverable to ops.
        assert any("static" in record.message.lower() for record in caplog.records), (
            "Expected a startup warning about the missing STATIC_DIR"
        )
    finally:
        server_module.STATIC_DIR = original


def test_c12_valid_static_dir_does_not_warn(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When STATIC_DIR exists with index.html, startup must be silent."""
    import lizystudio.server as server_module

    with tempfile.TemporaryDirectory() as tmp:
        static_dir = Path(tmp)
        (static_dir / "index.html").write_text("<html>SPA</html>")
        (static_dir / "assets").mkdir()
        original = server_module.STATIC_DIR
        server_module.STATIC_DIR = static_dir
        try:
            with caplog.at_level(logging.WARNING, logger="lizystudio.server"):
                server_module.create_app()
            static_warnings = [
                r for r in caplog.records if "static" in r.message.lower()
            ]
            assert static_warnings == []
        finally:
            server_module.STATIC_DIR = original
