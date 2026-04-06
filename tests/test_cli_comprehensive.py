"""Comprehensive CLI tests — all options, env vars, edge cases.

Extends the basic test_cli.py with full option coverage.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from lizystudio.cli import main


class TestCliAllOptions:
    """Test all CLI option combinations."""

    def test_all_options_combined(self) -> None:
        """All options specified together are passed correctly."""
        with patch("uvicorn.run") as mock_run:
            main(
                [
                    "--host",
                    "0.0.0.0",
                    "--port",
                    "9000",
                    "--reload",
                    "--backend",
                    "custom",
                    "--jobs-dir",
                    "/tmp/test_jobs",
                ]
            )
            mock_run.assert_called_once_with(
                "lizystudio.server:app",
                host="0.0.0.0",
                port=9000,
                reload=True,
            )

    def test_reload_sets_env_var(self) -> None:
        """--reload sets LIZYSTUDIO_RELOAD=1."""
        with patch("uvicorn.run"):
            main(["--reload"])
            assert os.environ.get("LIZYSTUDIO_RELOAD") == "1"

    def test_no_reload_does_not_set_env_var(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Without --reload, LIZYSTUDIO_RELOAD is not set."""
        monkeypatch.delenv("LIZYSTUDIO_RELOAD", raising=False)
        with patch("uvicorn.run"):
            main([])
            assert os.environ.get("LIZYSTUDIO_RELOAD") is None

    def test_backend_env_var_set(self) -> None:
        """--backend sets LIZYSTUDIO_BACKEND."""
        with patch("uvicorn.run"):
            main(["--backend", "test_backend"])
            assert os.environ["LIZYSTUDIO_BACKEND"] == "test_backend"

    def test_jobs_dir_env_var_set(self) -> None:
        """--jobs-dir sets LIZYSTUDIO_JOBS_DIR."""
        with patch("uvicorn.run"):
            main(["--jobs-dir", "/custom/path"])
            assert os.environ["LIZYSTUDIO_JOBS_DIR"] == "/custom/path"

    def test_jobs_dir_is_path_type(self) -> None:
        """--jobs-dir is parsed as a Path, stored as str in env."""
        with patch("uvicorn.run"):
            main(["--jobs-dir", "/tmp/j"])
            # The env var stores the string representation
            assert os.environ["LIZYSTUDIO_JOBS_DIR"] == "/tmp/j"


class TestCliDefaults:
    """Verify default values when no options are given."""

    def test_default_host(self) -> None:
        """Default host is 127.0.0.1."""
        with patch("uvicorn.run") as mock_run:
            main([])
            call_kwargs = mock_run.call_args
            assert (
                call_kwargs[1]["host"] == "127.0.0.1"
                or call_kwargs[0][1] == "127.0.0.1"
                if len(call_kwargs[0]) > 1
                else call_kwargs[1]["host"] == "127.0.0.1"
            )

    def test_default_port(self) -> None:
        """Default port is 8501."""
        with patch("uvicorn.run") as mock_run:
            main([])
            assert mock_run.call_args[1]["port"] == 8501

    def test_default_backend(self) -> None:
        """Default backend is lizyml."""
        with patch("uvicorn.run"):
            main([])
            assert os.environ["LIZYSTUDIO_BACKEND"] == "lizyml"

    def test_default_jobs_dir(self) -> None:
        """Default jobs dir is .lizystudio/jobs."""
        with patch("uvicorn.run"):
            main([])
            assert os.environ["LIZYSTUDIO_JOBS_DIR"] == ".lizystudio/jobs"


class TestCliErrorHandling:
    """Verify error handling for invalid arguments."""

    def test_invalid_port_type(self) -> None:
        """Non-integer port causes SystemExit."""
        with pytest.raises(SystemExit) as exc_info:
            main(["--port", "abc"])
        assert exc_info.value.code == 2

    def test_unknown_flag(self) -> None:
        """Unknown flags cause SystemExit."""
        with pytest.raises(SystemExit) as exc_info:
            main(["--unknown-flag"])
        assert exc_info.value.code == 2

    def test_help_exits_cleanly(self) -> None:
        """--help causes SystemExit(0)."""
        with pytest.raises(SystemExit) as exc_info:
            main(["--help"])
        assert exc_info.value.code == 0

    def test_help_output_contains_all_options(
        self, capsys: pytest.CaptureFixture[str]
    ) -> None:
        """--help output mentions all supported flags."""
        with pytest.raises(SystemExit):
            main(["--help"])
        captured = capsys.readouterr()
        for flag in ["--host", "--port", "--reload", "--backend", "--jobs-dir"]:
            assert flag in captured.out, f"Missing {flag} in help output"


class TestCliEnvOverride:
    """Verify CLI args override pre-existing env vars."""

    def test_cli_overrides_existing_backend_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """CLI --backend overrides pre-existing LIZYSTUDIO_BACKEND."""
        monkeypatch.setenv("LIZYSTUDIO_BACKEND", "old_backend")
        with patch("uvicorn.run"):
            main(["--backend", "new_backend"])
            assert os.environ["LIZYSTUDIO_BACKEND"] == "new_backend"

    def test_cli_overrides_existing_jobs_dir_env(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """CLI --jobs-dir overrides pre-existing LIZYSTUDIO_JOBS_DIR."""
        monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", "/old/path")
        with patch("uvicorn.run"):
            main(["--jobs-dir", "/new/path"])
            assert os.environ["LIZYSTUDIO_JOBS_DIR"] == "/new/path"
