"""Regression test for SIGTERM skipping Python finally (Issue #153).

Python's default SIGTERM handler calls ``_exit`` which does NOT run
Python-level ``finally`` blocks. In subprocess mode, the parent
SIGTERMs the child after cancel timeout, so ``_run_job_core``'s
``finally`` (which writes execution.log and releases state) does
not execute. The fix installs a handler in ``_child_main`` that
raises ``KeyboardInterrupt`` on the main thread so the existing
``except (CancelledError, KeyboardInterrupt)`` path runs.

## Invariants

- INV-7: on SIGTERM to the child, ``_run_job_core.finally`` runs to
  completion: ``execution.log`` is flushed and terminal status is
  persisted.
- INV-8: the SIGTERM handler is single-shot. A second SIGTERM is
  a no-op (handler reset to SIG_DFL so SIGKILL-class escalation
  via ``proc.kill()`` still works).
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time

import pytest

pytestmark = pytest.mark.unit


_HANDLER_SCRIPT = """
import sys
import time

from lizystudio.services.subprocess_runner import _install_sigterm_handler

_install_sigterm_handler()
sys.stdout.write("READY\\n")
sys.stdout.flush()

try:
    # Block until SIGTERM arrives. time.sleep is interruptible by
    # signals on POSIX.
    for _ in range(100):
        time.sleep(0.1)
except KeyboardInterrupt:
    # The fix: SIGTERM was converted to KeyboardInterrupt on the
    # main thread, so finally can run.
    sys.stdout.write("KI_CAUGHT\\n")
    sys.stdout.flush()
    sys.exit(0)
# If we get here, SIGTERM did not raise — the handler was not installed
# or not wired correctly. Exit non-zero so the test fails loudly.
sys.stdout.write("NO_KI\\n")
sys.stdout.flush()
sys.exit(2)
"""


def _wait_for_ready(proc: subprocess.Popen[bytes]) -> None:
    """Block until the child prints 'READY' so the SIGTERM handler is
    definitely installed before we start signalling.
    """
    assert proc.stdout is not None
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if line.startswith(b"READY"):
            return
        if not line and proc.poll() is not None:
            raise AssertionError(f"child exited before READY: rc={proc.returncode}")
    raise AssertionError("child did not print READY within 5s")


@pytest.mark.skipif(
    not sys.platform.startswith(("linux", "darwin")),
    reason="SIGTERM semantics are POSIX-only",
)
def test_sigterm_converts_to_keyboardinterrupt() -> None:
    """INV-7: SIGTERM raises KeyboardInterrupt on the main thread so
    the existing finally/except path runs instead of _exit."""
    proc = subprocess.Popen(
        [sys.executable, "-u", "-c", _HANDLER_SCRIPT],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _wait_for_ready(proc)
    proc.send_signal(signal.SIGTERM)
    try:
        stdout, stderr = proc.communicate(timeout=5.0)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=2.0)
        pytest.fail("child did not exit after SIGTERM; handler not working")

    assert proc.returncode == 0, (
        f"child exited with {proc.returncode}; stdout={stdout!r} stderr={stderr!r}"
    )
    assert b"KI_CAUGHT" in stdout, (
        f"KeyboardInterrupt was not raised; stdout={stdout!r}"
    )


_SINGLE_SHOT_SCRIPT = """
import sys
import time

from lizystudio.services.subprocess_runner import _install_sigterm_handler

_install_sigterm_handler()
sys.stdout.write("READY\\n")
sys.stdout.flush()

try:
    for _ in range(100):
        time.sleep(0.1)
except KeyboardInterrupt:
    # First SIGTERM converted to KI. Second SIGTERM should now use
    # the default handler (SIG_DFL) and terminate the process with
    # the default signal action — no second KeyboardInterrupt.
    sys.stdout.write("KI_FIRST\\n")
    sys.stdout.flush()
    # Block again to receive the second SIGTERM.
    try:
        for _ in range(100):
            time.sleep(0.1)
    except KeyboardInterrupt:
        sys.stdout.write("KI_SECOND\\n")
        sys.stdout.flush()
        sys.exit(3)
    sys.exit(0)
"""


@pytest.mark.skipif(
    not sys.platform.startswith(("linux", "darwin")),
    reason="SIGTERM semantics are POSIX-only",
)
def test_sigterm_handler_is_single_shot() -> None:
    """INV-8: after the first SIGTERM → KI, the handler is reset to
    SIG_DFL so a subsequent SIGTERM terminates the process normally
    (not as another KeyboardInterrupt) — this keeps the parent's
    proc.kill() escalation path intact.
    """
    proc = subprocess.Popen(
        [sys.executable, "-u", "-c", _SINGLE_SHOT_SCRIPT],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    _wait_for_ready(proc)
    proc.send_signal(signal.SIGTERM)
    # Wait for KI_FIRST so the handler has definitely finished its
    # first-shot branch before we escalate. Otherwise the second
    # SIGTERM can race into the still-unreset handler slot.
    assert proc.stdout is not None
    deadline = time.monotonic() + 5.0
    ki_seen = False
    while time.monotonic() < deadline:
        line = proc.stdout.readline()
        if line.startswith(b"KI_FIRST"):
            ki_seen = True
            break
    assert ki_seen, "child did not print KI_FIRST after SIGTERM"
    proc.send_signal(signal.SIGTERM)
    try:
        stdout, _ = proc.communicate(timeout=5.0)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=2.0)
        pytest.fail("child hung after second SIGTERM")

    # The process must have received the default SIGTERM action on the
    # second signal. The default action kills the process with signal
    # SIGTERM, so the exit status is -SIGTERM (i.e. negative signal
    # number). If the handler had re-triggered, we'd see KI_SECOND and
    # exit code 3 instead. KI_FIRST was already consumed by the
    # readline loop above so it won't appear in `stdout` here.
    assert b"KI_SECOND" not in stdout, (
        f"handler re-fired; single-shot invariant broken. stdout={stdout!r}"
    )
    assert proc.returncode == -signal.SIGTERM or proc.returncode == (
        128 + signal.SIGTERM
    ), f"expected SIGTERM-default exit, got {proc.returncode}"


def test_install_sigterm_handler_is_idempotent() -> None:
    """Installing the handler twice from the same process must not
    leak prior handlers. The second call wins (SIGTERM handler is a
    single OS-level slot).
    """
    from lizystudio.services.subprocess_runner import _install_sigterm_handler

    # Capture whatever is currently installed so we can restore it.
    prev = signal.getsignal(signal.SIGTERM)
    try:
        _install_sigterm_handler()
        first = signal.getsignal(signal.SIGTERM)
        _install_sigterm_handler()
        second = signal.getsignal(signal.SIGTERM)
        # Both invocations set a handler (not SIG_DFL / SIG_IGN).
        assert callable(first)
        assert callable(second)
    finally:
        signal.signal(signal.SIGTERM, prev)  # type: ignore[arg-type]


def _raise_sigterm_to_self() -> None:
    """Helper: send SIGTERM to the current process from a thread."""
    time.sleep(0.05)
    os.kill(os.getpid(), signal.SIGTERM)


@pytest.mark.skipif(
    not sys.platform.startswith(("linux", "darwin")),
    reason="POSIX signals only",
)
def test_handler_raises_ki_on_main_thread_in_process() -> None:
    """In-process sanity check that the handler injects KI via
    ``_thread.interrupt_main`` on the main thread (not on the worker).

    We install the handler, spawn a thread that sends SIGTERM to
    ourselves, and expect KeyboardInterrupt on the main thread.
    """
    from lizystudio.services.subprocess_runner import _install_sigterm_handler

    prev = signal.getsignal(signal.SIGTERM)
    try:
        _install_sigterm_handler()
        t = threading.Thread(target=_raise_sigterm_to_self, daemon=True)
        t.start()
        caught = False
        try:
            time.sleep(2.0)
        except KeyboardInterrupt:
            caught = True
        t.join(timeout=1.0)
        assert caught, "expected KeyboardInterrupt on main thread"
    finally:
        signal.signal(signal.SIGTERM, prev)  # type: ignore[arg-type]
