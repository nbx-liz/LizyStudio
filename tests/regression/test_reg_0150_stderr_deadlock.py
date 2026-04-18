"""Regression test for subprocess stderr pipe deadlock (Issue #150).

The parent previously set ``stderr=subprocess.PIPE`` on the child
subprocess but never drained it concurrently. Once the child wrote
more than the OS pipe buffer (~64 KiB on Linux), ``write(2)`` in the
child blocked forever and the subprocess poll loop stalled.

## Invariants

- INV-1: The child MUST never block on write(stderr) regardless of how
  many bytes it emits. Verified by running a child that writes a
  large, fixed amount of stderr in one burst and asserting clean exit
  within a generous timeout.
- INV-2: For every ``subprocess.Popen`` created by
  ``run_job_in_subprocess``, ``proc.stderr`` (if present) is closed
  exactly once before the function returns. Verified indirectly by
  the drainer's own ``close`` contract — no FD leak across N runs.
"""

from __future__ import annotations

import subprocess
import sys
import time

import pytest

from lizystudio.services.subprocess_runner import _StderrDrainer

pytestmark = pytest.mark.unit


def _spawn_writer(n_bytes: int) -> subprocess.Popen[bytes]:
    """Launch a minimal Python child that writes *n_bytes* of stderr."""
    script = (
        "import sys; "
        f"sys.stderr.buffer.write(b'x' * {n_bytes}); "
        "sys.stderr.flush(); "
        "sys.exit(0)"
    )
    return subprocess.Popen(
        [sys.executable, "-c", script],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def test_large_stderr_does_not_deadlock_child() -> None:
    """INV-1: child writing 500 KiB exits cleanly when stderr is drained.

    Without draining, the child blocks on write(2) after ~64 KiB on
    Linux (the pipe buffer is full and the parent never reads).
    """
    n_bytes = 500_000
    proc = _spawn_writer(n_bytes)
    assert proc.stderr is not None
    drainer = _StderrDrainer(proc.stderr)
    drainer.start()
    try:
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2.0)
            pytest.fail(
                f"child blocked on stderr write of {n_bytes} bytes "
                "(drainer did not drain the pipe)"
            )
        assert proc.returncode == 0
    finally:
        drainer.join(timeout=2.0)


@pytest.mark.parametrize("n_bytes", [64 * 1024, 256 * 1024, 1_024 * 1024])
def test_parametrized_stderr_sizes(n_bytes: int) -> None:
    """INV-1: holds across pipe-buffer, 4x, 16x capacity."""
    proc = _spawn_writer(n_bytes)
    assert proc.stderr is not None
    drainer = _StderrDrainer(proc.stderr)
    drainer.start()
    try:
        proc.wait(timeout=5.0)
        assert proc.returncode == 0
    finally:
        drainer.join(timeout=2.0)


def test_drainer_captures_tail_bytes() -> None:
    """The drainer retains the trailing bytes so error reporting
    preserves the final diagnostic lines of a verbose child.
    """
    n_bytes = 200_000
    proc = _spawn_writer(n_bytes)
    assert proc.stderr is not None
    drainer = _StderrDrainer(proc.stderr)
    drainer.start()
    try:
        proc.wait(timeout=5.0)
    finally:
        drainer.join(timeout=2.0)
    tail = drainer.tail_bytes()
    # Bounded: the drainer caps the retained buffer; exact cap is an
    # implementation detail, but it must be non-empty and not larger
    # than the total written.
    assert tail, "expected non-empty tail from drainer"
    assert len(tail) <= n_bytes


def test_drainer_join_releases_handle() -> None:
    """INV-2: after join(), the drainer has closed its stderr handle."""
    proc = _spawn_writer(1024)
    assert proc.stderr is not None
    drainer = _StderrDrainer(proc.stderr)
    drainer.start()
    proc.wait(timeout=5.0)
    drainer.join(timeout=2.0)
    # The underlying stream should be closed; read from a closed stream
    # raises ValueError.
    assert proc.stderr.closed


def test_no_fd_leak_over_sequential_runs() -> None:
    """INV-2 (FD release): running many drained subprocesses in
    sequence does not accumulate open FDs in the parent.
    """
    import os

    if not sys.platform.startswith("linux"):
        pytest.skip("FD-count assertion is Linux-only")

    def count_fds() -> int:
        return len(os.listdir(f"/proc/{os.getpid()}/fd"))

    baseline = count_fds()
    for _ in range(10):
        proc = _spawn_writer(4096)
        assert proc.stderr is not None
        drainer = _StderrDrainer(proc.stderr)
        drainer.start()
        proc.wait(timeout=5.0)
        drainer.join(timeout=2.0)
    # Allow a small slack (test infrastructure may open a few FDs) but
    # catch the old behaviour of leaking one FD per run.
    assert count_fds() - baseline < 5, f"FD leak: baseline={baseline}, after=10 runs"


def test_drainer_survives_child_that_writes_nothing() -> None:
    """Child exits without writing to stderr — drainer must not hang."""
    proc = subprocess.Popen(
        [sys.executable, "-c", "import sys; sys.exit(0)"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )
    assert proc.stderr is not None
    drainer = _StderrDrainer(proc.stderr)
    drainer.start()
    try:
        proc.wait(timeout=5.0)
    finally:
        start = time.monotonic()
        drainer.join(timeout=2.0)
        elapsed = time.monotonic() - start
        assert elapsed < 2.0, f"drainer hung on empty stderr ({elapsed:.2f}s)"
    assert drainer.tail_bytes() == b""
