"""Tests for OpenMP detection utility (H-0036).

Verifies detection of libgomp.so/libomp.so and the force-subprocess env var.
"""

from __future__ import annotations

import ctypes.util
from unittest.mock import patch

import pytest

from lizystudio.services.openmp_detect import has_openmp, should_use_subprocess

pytestmark = pytest.mark.unit


class TestHasOpenMP:
    """Detect presence of OpenMP shared libraries."""

    def setup_method(self) -> None:
        """Clear lru_cache before each test."""
        has_openmp.cache_clear()

    def test_returns_true_when_libgomp_found(self) -> None:
        with patch.object(
            ctypes.util,
            "find_library",
            side_effect=lambda name: "/usr/lib/libgomp.so" if name == "gomp" else None,
        ):
            assert has_openmp() is True

    def test_returns_true_when_libomp_found(self) -> None:
        has_openmp.cache_clear()
        with patch.object(
            ctypes.util,
            "find_library",
            side_effect=lambda name: "/usr/lib/libomp.so" if name == "omp" else None,
        ):
            assert has_openmp() is True

    def test_returns_false_when_no_openmp(self) -> None:
        has_openmp.cache_clear()
        with patch.object(ctypes.util, "find_library", return_value=None):
            assert has_openmp() is False


class TestShouldUseSubprocess:
    """Decide whether to use subprocess mode."""

    def test_force_subprocess_env_var(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """LIZYSTUDIO_FORCE_SUBPROCESS=1 forces subprocess mode."""
        monkeypatch.setenv("LIZYSTUDIO_FORCE_SUBPROCESS", "1")
        assert should_use_subprocess() is True

    def test_no_force_and_no_openmp(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Without force and without OpenMP, thread mode is used."""
        monkeypatch.delenv("LIZYSTUDIO_FORCE_SUBPROCESS", raising=False)
        with patch(
            "lizystudio.services.openmp_detect.has_openmp",
            return_value=False,
        ):
            assert should_use_subprocess() is False

    def test_no_force_but_openmp_detected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """With OpenMP detected, subprocess mode is used."""
        monkeypatch.delenv("LIZYSTUDIO_FORCE_SUBPROCESS", raising=False)
        with patch(
            "lizystudio.services.openmp_detect.has_openmp",
            return_value=True,
        ):
            assert should_use_subprocess() is True

    def test_force_subprocess_zero_is_not_forced(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """LIZYSTUDIO_FORCE_SUBPROCESS=0 does not force subprocess."""
        monkeypatch.setenv("LIZYSTUDIO_FORCE_SUBPROCESS", "0")
        with patch(
            "lizystudio.services.openmp_detect.has_openmp",
            return_value=False,
        ):
            assert should_use_subprocess() is False
