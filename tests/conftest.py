"""Shared test fixtures."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from lizystudio.server import create_app


@pytest.fixture()
def tmp_jobs_dir(tmp_path: Path) -> Path:
    """Return a temporary directory for job storage."""
    return tmp_path / "jobs"


@pytest.fixture()
def client(tmp_jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    """TestClient with isolated job storage. Enters lifespan context."""
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_jobs_dir))
    application = create_app()
    with TestClient(application) as c:
        yield c
