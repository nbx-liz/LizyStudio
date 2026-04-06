"""Tests for lizystudio.cli module."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from lizystudio.cli import main


class TestCli:
    def test_parse_default_args(self) -> None:
        """Default args set host=127.0.0.1, port=8501, no reload."""
        with patch("uvicorn.run") as mock_run:
            main([])
            mock_run.assert_called_once_with(
                "lizystudio.server:app",
                host="127.0.0.1",
                port=8501,
                reload=False,
            )

    def test_parse_custom_host_port(self) -> None:
        """Custom host and port are passed to uvicorn."""
        with patch("uvicorn.run") as mock_run:
            main(["--host", "0.0.0.0", "--port", "9000"])
            mock_run.assert_called_once_with(
                "lizystudio.server:app",
                host="0.0.0.0",
                port=9000,
                reload=False,
            )

    def test_parse_reload_flag(self) -> None:
        """--reload flag is passed to uvicorn."""
        with patch("uvicorn.run") as mock_run:
            main(["--reload"])
            mock_run.assert_called_once_with(
                "lizystudio.server:app",
                host="127.0.0.1",
                port=8501,
                reload=True,
            )

    def test_backend_env_var(self) -> None:
        """--backend sets LIZYSTUDIO_BACKEND env var."""
        with patch("uvicorn.run"):
            main(["--backend", "custom_backend"])
            assert os.environ["LIZYSTUDIO_BACKEND"] == "custom_backend"

    def test_jobs_dir_env_var(self) -> None:
        """--jobs-dir sets LIZYSTUDIO_JOBS_DIR env var."""
        with patch("uvicorn.run"):
            main(["--jobs-dir", "/tmp/test_jobs"])
            assert os.environ["LIZYSTUDIO_JOBS_DIR"] == "/tmp/test_jobs"

    def test_invalid_args_exits(self) -> None:
        """Unknown arguments cause SystemExit."""
        with pytest.raises(SystemExit):
            main(["--unknown-flag"])

    def test_help_exits(self) -> None:
        """--help causes SystemExit."""
        with pytest.raises(SystemExit):
            main(["--help"])
