"""Test that python -m lizystudio entry point works."""

from __future__ import annotations

import subprocess
import sys

import pytest

pytestmark = pytest.mark.unit


def test_python_m_lizystudio_help() -> None:
    """python -m lizystudio --help should exit 0 and show usage."""
    result = subprocess.run(
        [sys.executable, "-m", "lizystudio", "--help"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0
    assert "usage" in result.stdout.lower() or "lizystudio" in result.stdout.lower()


def test_python_m_lizystudio_bad_arg_exits_nonzero() -> None:
    """python -m lizystudio with unknown args should exit non-zero."""
    result = subprocess.run(
        [sys.executable, "-m", "lizystudio", "--nonexistent-flag"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode != 0
    assert "error" in result.stderr.lower() or "usage" in result.stderr.lower()
