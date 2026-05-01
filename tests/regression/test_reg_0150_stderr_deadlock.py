"""Regression test for subprocess stderr pipe deadlock (Issue #150).

## Status: superseded by Issue #328 (2026-05-01)

The original tests in this file exercised the ``_StderrDrainer`` class,
which existed to drain ``stderr=subprocess.PIPE`` concurrently and
prevent the child from blocking on ``write(2)`` once the OS pipe buffer
(~64 KiB on Linux) was full. Issue #328 retired ``_StderrDrainer``
entirely: ``run_job_in_subprocess`` now passes a parent-owned file
descriptor as the child's ``stdout`` and merges ``stderr`` into it via
``subprocess.STDOUT``. There is no pipe, so the deadlock that
motivated #150 is **structurally impossible** in the new implementation.

The invariant pinned by this file (a child that writes more than the
pipe buffer must still exit cleanly) is preserved by
``tests/regression/test_reg_0328_execution_log.py``::

    TestLargeOutputDoesNotDeadlock::
        test_large_stdout_redirected_to_file_no_deadlock

That test parametrises 64 KiB / 256 KiB / 1 MiB stdout + stderr writes
through the same ``stdout=<file fd>, stderr=STDOUT`` plumbing the
production code uses, and asserts the child exits within 5 s.

The original tests are kept in this file as ``pytest.skip`` placeholders
(per CLAUDE.md §"Never delete existing tests to make a suite pass") so
the regression history of #150 stays discoverable. They cannot be
re-enabled in their original form because ``_StderrDrainer`` is gone;
restoring them would require re-introducing the pipe path that #328
deliberately removed.
"""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.unit

_SUPERSEDED_REASON = (
    "Superseded by #328 (P-0093 / 2026-05-01): _StderrDrainer was "
    "retired when run_job_in_subprocess switched to a file-fd "
    "redirect. INV preserved by tests/regression/"
    "test_reg_0328_execution_log.py::TestLargeOutputDoesNotDeadlock."
)


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_large_stderr_does_not_deadlock_child() -> None:
    """Original INV-1: child writing 500 KiB exits cleanly."""


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_parametrized_stderr_sizes() -> None:
    """Original INV-1 parametrised across pipe-buffer / 4x / 16x."""


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_drainer_captures_tail_bytes() -> None:
    """Original: drainer retained tail for failure logging.

    Replaced by ``_read_log_tail`` reading directly from the captured
    log file; covered in test_reg_0328_execution_log.py::TestReadLogTail.
    """


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_drainer_join_releases_handle() -> None:
    """Original INV-2: drainer closed its stderr handle on join."""


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_no_fd_leak_over_sequential_runs() -> None:
    """Original INV-2 (FD release): no FD accumulation across runs.

    The new implementation closes its single file fd in the outer
    ``finally`` block of run_job_in_subprocess, guaranteed by the
    ``log_fp.close()`` line. No pipe handles are involved.
    """


@pytest.mark.skip(reason=_SUPERSEDED_REASON)
def test_drainer_survives_child_that_writes_nothing() -> None:
    """Original: drainer did not hang on empty stderr."""
