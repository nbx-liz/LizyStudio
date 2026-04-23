"""Shared test fixtures."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lizystudio.server import create_app


@pytest.fixture(autouse=True)
def _disable_subprocess_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    """Default all tests to thread mode (H-0036).

    Subprocess-specific tests override this by patching directly.
    """
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess",
        lambda: False,
    )


@pytest.fixture(autouse=True)
def _reset_ws_origin_cache() -> Iterator[None]:
    """Clear the WS origin allowlist cache before and after each test
    (H-0083). ``get_allowed_ws_origins`` is ``lru_cache``'d to avoid
    re-parsing ``os.environ`` on every WS handshake in production, but
    that process-wide memoisation otherwise leaks state between tests
    that monkeypatch ``LIZYSTUDIO_WS_ALLOWED_ORIGINS``.
    """
    from lizystudio.ws.progress import get_allowed_ws_origins

    get_allowed_ws_origins.cache_clear()
    yield
    get_allowed_ws_origins.cache_clear()


@pytest.fixture()
def tmp_jobs_dir(tmp_path: Path) -> Path:
    """Return a temporary directory for job storage."""
    return tmp_path / "jobs"


@pytest.fixture()
def client(
    tmp_jobs_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[TestClient]:
    """TestClient with isolated job storage. Enters lifespan context."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_jobs_dir))
    # Allow file access to /tmp for tests (test CSV files are created under /tmp)
    tmp_root = Path("/tmp").resolve()
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(tmp_root))
    # Force re-evaluation of module-level constant
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", tmp_root)
    application = create_app()
    with TestClient(application) as c:
        yield c
