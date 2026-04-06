"""OpenMP detection utility (H-0036).

Detects whether OpenMP shared libraries (libgomp / libomp) are present
on the system.  When running ML backends (e.g. LightGBM) inside daemon
threads, OpenMP binds its thread pool to the first calling thread.  This
causes 50× performance degradation.  The workaround is to run the backend
in a subprocess instead.
"""

from __future__ import annotations

import ctypes.util
import functools
import os


@functools.lru_cache(maxsize=1)
def has_openmp() -> bool:
    """Return True if an OpenMP runtime library is found on the system."""
    return (
        ctypes.util.find_library("gomp") is not None
        or ctypes.util.find_library("omp") is not None
    )


def should_use_subprocess() -> bool:
    """Decide whether to use subprocess mode for job execution.

    Returns True when:
    - ``LIZYSTUDIO_FORCE_SUBPROCESS=1`` is set, **or**
    - an OpenMP runtime is detected on the system.
    """
    force = os.environ.get("LIZYSTUDIO_FORCE_SUBPROCESS", "")
    if force == "1":
        return True
    return has_openmp()
