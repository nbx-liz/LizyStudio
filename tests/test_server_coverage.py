"""Additional tests for server.py to cover warmup, SPA routing, and edge cases."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

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
