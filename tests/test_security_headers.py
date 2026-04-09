"""Tests for CSP and security headers (H-0039).

Verifies that production responses include Content-Security-Policy,
X-Content-Type-Options, and X-Frame-Options headers.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lizystudio.server import create_app

pytestmark = pytest.mark.integration


@pytest.fixture()
def prod_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    """TestClient without --reload (production mode)."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    # Ensure not in reload mode
    monkeypatch.delenv("LIZYSTUDIO_RELOAD", raising=False)
    application = create_app()
    with TestClient(application) as c:
        yield c


class TestSecurityHeaders:
    """Responses should include security headers."""

    def test_csp_header_present(self, prod_client: TestClient) -> None:
        """API responses should include Content-Security-Policy."""
        resp = prod_client.get("/api/workspace/status")
        csp = resp.headers.get("content-security-policy")
        assert csp is not None
        assert "default-src" in csp

    def test_csp_allows_self(self, prod_client: TestClient) -> None:
        """CSP should allow 'self' for default-src."""
        resp = prod_client.get("/api/workspace/status")
        csp = resp.headers["content-security-policy"]
        assert "'self'" in csp

    def test_csp_allows_websocket(self, prod_client: TestClient) -> None:
        """CSP connect-src should allow WebSocket connections."""
        resp = prod_client.get("/api/workspace/status")
        csp = resp.headers["content-security-policy"]
        assert "ws:" in csp or "connect-src" in csp

    def test_csp_allows_unsafe_inline_styles(self, prod_client: TestClient) -> None:
        """CSP style-src should allow 'unsafe-inline' for Tailwind."""
        resp = prod_client.get("/api/workspace/status")
        csp = resp.headers["content-security-policy"]
        assert "'unsafe-inline'" in csp

    def test_csp_allows_data_images(self, prod_client: TestClient) -> None:
        """CSP img-src should allow data: URIs for Plotly."""
        resp = prod_client.get("/api/workspace/status")
        csp = resp.headers["content-security-policy"]
        assert "data:" in csp

    def test_x_content_type_options(self, prod_client: TestClient) -> None:
        """Responses should include X-Content-Type-Options: nosniff."""
        resp = prod_client.get("/api/workspace/status")
        assert resp.headers.get("x-content-type-options") == "nosniff"

    def test_x_frame_options(self, prod_client: TestClient) -> None:
        """Responses should include X-Frame-Options: DENY."""
        resp = prod_client.get("/api/workspace/status")
        assert resp.headers.get("x-frame-options") == "DENY"

    def test_referrer_policy(self, prod_client: TestClient) -> None:
        """Responses should include Referrer-Policy."""
        resp = prod_client.get("/api/workspace/status")
        assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"

    def test_permissions_policy(self, prod_client: TestClient) -> None:
        """Responses should include Permissions-Policy."""
        resp = prod_client.get("/api/workspace/status")
        pp = resp.headers.get("permissions-policy")
        assert pp is not None
        assert "camera=()" in pp


class TestDevModeHeaders:
    """Development mode should relax CSP for HMR."""

    @pytest.fixture()
    def dev_client(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> Iterator[TestClient]:
        """TestClient in reload/dev mode."""
        monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))
        tmp_root = Path("/tmp").resolve()
        monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
        import lizystudio.security as sec

        monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
        monkeypatch.setenv("LIZYSTUDIO_RELOAD", "1")
        application = create_app()
        with TestClient(application) as c:
            yield c

    def test_dev_mode_relaxes_csp(self, dev_client: TestClient) -> None:
        """In dev mode, CSP should be relaxed or absent for HMR."""
        resp = dev_client.get("/api/workspace/status")
        csp = resp.headers.get("content-security-policy")
        # Dev mode: either no CSP or more permissive
        if csp is not None:
            # Should at minimum allow unsafe-eval or unsafe-inline for HMR
            assert "'unsafe-eval'" in csp or "'unsafe-inline'" in csp

    def test_dev_mode_still_has_basic_headers(self, dev_client: TestClient) -> None:
        """Even in dev mode, basic security headers should be present."""
        resp = dev_client.get("/api/workspace/status")
        assert resp.headers.get("x-content-type-options") == "nosniff"
        assert resp.headers.get("x-frame-options") == "DENY"
