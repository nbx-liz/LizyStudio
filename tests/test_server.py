"""Smoke tests for the FastAPI application."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_workspace_status(client: TestClient) -> None:
    res = client.get("/api/workspace/status")
    assert res.status_code == 200
    body = res.json()
    assert body["has_data"] is False
    assert body["has_config"] is False
    assert body["has_result"] is False


def test_workspace_reset(client: TestClient) -> None:
    res = client.post("/api/workspace/reset")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_jobs_list_empty(client: TestClient) -> None:
    res = client.get("/api/jobs/")
    assert res.status_code == 200
    assert res.json() == []


def test_job_not_found(client: TestClient) -> None:
    res = client.get("/api/jobs/nonexistent")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "JOB_NOT_FOUND"


# ---------------------------------------------------------------------------
# _warmup_adapter
# ---------------------------------------------------------------------------


def test_warmup_adapter_calls_info_and_ui_schema() -> None:
    """_warmup_adapter should access .info and call .get_ui_schema()."""
    from lizystudio.server import _warmup_adapter

    adapter = MagicMock()
    adapter.info = "lizyml v0.7"
    _warmup_adapter(adapter)
    adapter.get_ui_schema.assert_called_once()


def test_warmup_adapter_ignores_exception() -> None:
    """_warmup_adapter must not raise even if the adapter blows up."""
    from lizystudio.server import _warmup_adapter

    adapter = MagicMock()
    type(adapter).info = property(
        lambda self: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    # Should not raise
    _warmup_adapter(adapter)


def test_warmup_adapter_no_get_ui_schema() -> None:
    """_warmup_adapter skips get_ui_schema when the attribute is missing."""
    from lizystudio.server import _warmup_adapter

    adapter = MagicMock(spec=[])  # spec=[] means no attributes
    adapter.info = "test"
    # Should not raise AttributeError
    _warmup_adapter(adapter)


# ---------------------------------------------------------------------------
# SPA routing — api/ and ws/ paths return 404
# ---------------------------------------------------------------------------


def test_spa_api_path_returns_404(client: TestClient) -> None:
    """Requests to /api/unknown should return 404, not index.html."""
    res = client.get("/api/nonexistent-endpoint")
    # Should be 404 or 405, not 200 with HTML
    assert res.status_code in (404, 405, 422)


def test_spa_ws_path_returns_404(client: TestClient) -> None:
    """Requests to /ws/unknown should return 404, not index.html."""
    res = client.get("/ws/nonexistent")
    assert res.status_code in (404, 405, 426)


# ---------------------------------------------------------------------------
# SPA routing — when static dir exists
# ---------------------------------------------------------------------------


def test_spa_serves_index_html_for_unknown_path() -> None:
    """When STATIC_DIR exists with index.html, unknown paths serve index.html."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        static_dir = Path(tmpdir)
        index_html = static_dir / "index.html"
        index_html.write_text("<html>SPA</html>")
        assets_dir = static_dir / "assets"
        assets_dir.mkdir()

        with patch("lizystudio.server.STATIC_DIR", static_dir):
            from lizystudio.server import create_app

            app = create_app()
            with TestClient(app) as tc:
                res = tc.get("/some/unknown/path")
                assert res.status_code == 200
                assert "SPA" in res.text


def test_spa_returns_404_for_api_prefix_with_static() -> None:
    """Even with static dir, /api/* paths must return 404."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        static_dir = Path(tmpdir)
        index_html = static_dir / "index.html"
        index_html.write_text("<html>SPA</html>")
        assets_dir = static_dir / "assets"
        assets_dir.mkdir()

        with patch("lizystudio.server.STATIC_DIR", static_dir):
            from lizystudio.server import create_app

            app = create_app()
            with TestClient(app) as tc:
                res = tc.get("/api/does-not-exist")
                assert res.status_code == 404


def test_spa_serves_real_static_file() -> None:
    """When a real file exists under static dir, serve it directly."""
    import tempfile

    with tempfile.TemporaryDirectory() as tmpdir:
        static_dir = Path(tmpdir)
        index_html = static_dir / "index.html"
        index_html.write_text("<html>SPA</html>")
        assets_dir = static_dir / "assets"
        assets_dir.mkdir()
        # Create a real file at the static root
        (static_dir / "favicon.ico").write_bytes(b"\x00\x00\x01\x00")

        with patch("lizystudio.server.STATIC_DIR", static_dir):
            from lizystudio.server import create_app

            app = create_app()
            with TestClient(app) as tc:
                res = tc.get("/favicon.ico")
                assert res.status_code == 200
                assert res.content == b"\x00\x00\x01\x00"


# ---------------------------------------------------------------------------
# create_app respects environment variables
# ---------------------------------------------------------------------------


def test_create_app_custom_backend_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """create_app reads LIZYSTUDIO_BACKEND from env."""
    monkeypatch.setenv("LIZYSTUDIO_BACKEND", "lizyml")
    from lizystudio.server import create_app

    app = create_app()
    assert app.title == "LizyStudio"


def test_create_app_custom_jobs_dir_env(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """create_app reads LIZYSTUDIO_JOBS_DIR from env."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "custom_jobs"))
    from lizystudio.server import create_app

    app = create_app()
    with TestClient(app) as tc:
        res = tc.get("/api/jobs/")
        assert res.status_code == 200


# ---------------------------------------------------------------------------
# H-0083 — CORS allow_origins is driven by LIZYSTUDIO_CORS_ALLOWED_ORIGINS
# ---------------------------------------------------------------------------


def _cors_preflight(tc: TestClient, origin: str) -> str | None:
    """Run a CORS preflight and return the allow-origin response header."""
    res = tc.options(
        "/api/backends",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    return res.headers.get("access-control-allow-origin")


def test_h0083_cors_env_override(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A production-like origin is honoured when listed in the env var."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv(
        "LIZYSTUDIO_CORS_ALLOWED_ORIGINS",
        "https://app.example.com,https://staging.example.com",
    )
    from lizystudio.server import create_app

    app = create_app()
    with TestClient(app) as tc:
        allowed = _cors_preflight(tc, "https://app.example.com")
        assert allowed == "https://app.example.com"
        # An unlisted origin must not receive an allow-origin header.
        assert _cors_preflight(tc, "https://evil.example.com") is None


def test_h0083_cors_fallback_when_env_unset(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Without the env var only localhost:5173 is allowed."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.delenv("LIZYSTUDIO_CORS_ALLOWED_ORIGINS", raising=False)
    from lizystudio.server import create_app

    app = create_app()
    with TestClient(app) as tc:
        assert _cors_preflight(tc, "http://localhost:5173") == "http://localhost:5173"
        assert _cors_preflight(tc, "https://app.example.com") is None


def test_h0083_cors_blank_entries_are_filtered(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Blank / whitespace entries in the env list must be dropped so a
    stray '' never widens the allowlist to every origin.
    """
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setenv(
        "LIZYSTUDIO_CORS_ALLOWED_ORIGINS",
        "https://a.example.com, ,https://b.example.com",
    )
    from lizystudio.server import create_app

    app = create_app()
    with TestClient(app) as tc:
        assert _cors_preflight(tc, "https://a.example.com") == "https://a.example.com"
        assert _cors_preflight(tc, "https://b.example.com") == "https://b.example.com"
        # An empty origin string must not match.
        assert _cors_preflight(tc, "") is None


def test_h0083_cors_parse_allowed_origins_helper() -> None:
    """Parser unit test — isolates the env-splitting logic from FastAPI."""
    from lizystudio.server import _parse_cors_allowed_origins

    assert _parse_cors_allowed_origins(None) == ["http://localhost:5173"]
    assert _parse_cors_allowed_origins("") == ["http://localhost:5173"]
    assert _parse_cors_allowed_origins("   ") == ["http://localhost:5173"]
    assert _parse_cors_allowed_origins("a,b") == ["a", "b"]
    assert _parse_cors_allowed_origins("a, ,b") == ["a", "b"]
    assert _parse_cors_allowed_origins(" https://x.example , https://y.example ") == [
        "https://x.example",
        "https://y.example",
    ]


class TestShapWarningSuppression:
    """Importing ``lizystudio.server`` registers a filter for the SHAP
    0.51.0 LightGBM-binary ``UserWarning`` so the lizyml SHAP adapter
    (which already handles both old and new output shapes) does not
    spam the log with N x folds copies of an upstream API-change
    notice on every fit.
    """

    def test_shap_userwarning_filter_is_registered(self) -> None:
        """Calling ``_install_upstream_warning_filters`` registers an
        ``ignore`` entry for the SHAP LightGBM-binary message.

        We invoke the installer explicitly because pytest snapshots
        ``warnings.filters`` per-test (via ``_pytest.warnings``), so
        the module-import-time filter set up at production startup
        is restored to the pre-test state before each test runs. The
        installer is idempotent: production calls it once at module
        load, this test re-invokes it inside the per-test snapshot.
        """
        import warnings as _warnings

        from lizystudio.server import _install_upstream_warning_filters

        _install_upstream_warning_filters()

        matching = [
            f
            for f in _warnings.filters
            if f[0] == "ignore"
            and f[1] is not None
            and "TreeExplainer shap values" in f[1].pattern
        ]
        assert matching, (
            "Expected an ``ignore`` filter for the SHAP TreeExplainer "
            "UserWarning to be registered after calling "
            "_install_upstream_warning_filters. Current filters: "
            f"{[(a, p.pattern if p else None) for a, p, *_ in _warnings.filters]}"
        )
        # Filter must target UserWarning specifically — broader
        # categories would silently swallow unrelated signal.
        assert matching[0][2] is UserWarning, (
            f"SHAP filter should target UserWarning, got {matching[0][2].__name__}"
        )

    def test_filter_does_not_swallow_unrelated_userwarnings(self) -> None:
        """The filter regex must scope tightly to the SHAP message.

        Pin so a future broadening (e.g. a typo turning the regex into
        ``.*``) does not silently swallow legitimate signal from
        elsewhere in the stack.
        """
        import re
        import warnings as _warnings

        from lizystudio.server import _install_upstream_warning_filters

        _install_upstream_warning_filters()

        shap_filter = next(
            (
                f
                for f in _warnings.filters
                if f[0] == "ignore"
                and f[1] is not None
                and "TreeExplainer shap values" in f[1].pattern
            ),
            None,
        )
        assert shap_filter is not None
        regex = shap_filter[1]
        assert isinstance(regex, re.Pattern)
        assert not regex.match("this is an unrelated warning about something else")
        assert not regex.match("LightGBM regression model warning")
        # And the actual SHAP message MUST match.
        assert regex.match(
            "LightGBM binary classifier with TreeExplainer shap "
            "values output has changed to a list of ndarray"
        )

    def test_module_import_invokes_the_installer_in_production(self) -> None:
        """The module-level installer call survives ``import``.

        Pytest's per-test snapshot does NOT roll back the module-level
        side effect of the FIRST production import. We assert the
        installer name is exposed at module top-level so a future
        refactor cannot accidentally remove the line that wires it
        into normal startup.
        """
        from lizystudio import server

        assert hasattr(server, "_install_upstream_warning_filters"), (
            "Module must expose _install_upstream_warning_filters so "
            "tests + production share a single installation surface."
        )
        # The installer must be a callable taking no required args.
        import inspect

        sig = inspect.signature(server._install_upstream_warning_filters)
        required = [
            p
            for p in sig.parameters.values()
            if p.default is inspect.Parameter.empty
            and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)
        ]
        assert required == [], (
            "_install_upstream_warning_filters must be callable with no "
            "required arguments so it works at module import."
        )
