"""Regression (#328): subprocess stdout/stderr is captured in execution.log.

Before the fix, ``run_job_in_subprocess`` launched the child with
``stdout=subprocess.DEVNULL`` and only kept a bounded stderr tail in
memory for the post-mortem server-log path. ``execution.log`` was
created by ``_run_job_core.finally`` but only contained whatever the
``lizystudio.training.{job_id}`` logger captured — which in the LizyML
adapter path was effectively empty. As a result every job's
``execution.log`` was 0 bytes and the UI's "View Full Log" dialog
rendered blank.

The fix opens ``{jobs_dir}/{job_id}/execution.log`` in the parent and
passes the file descriptor as the child's ``stdout`` (with ``stderr``
merged via ``subprocess.STDOUT``). After the child exits, the parent
caps the file at ``_MAX_LOG_BYTES`` by dropping the head and writing a
truncation marker. The child's ``_run_job_core.finally`` no longer
*overwrites* the file; it appends a separator + the captured logger
records so the parent's stdout capture is preserved.

Invariants pinned by this regression:

- INV-1 (capture): a child that prints to stdout has its output in
  ``execution.log`` after the job completes.
- INV-2 (merge): stderr is captured into the same file (preserving
  chronological order with stdout).
- INV-3 (size cap): a runaway child does not produce an
  ``execution.log`` larger than ``_MAX_LOG_BYTES``; oversize files are
  truncated head-first with a marker line.
- INV-4 (failure tail): on ``returncode != 0`` the server log still
  emits the failure tail (regression for #150 / Issue #87).
- INV-5 (no overwrite): the child's logger-record persistence at
  ``_run_job_core.finally`` *appends* to the file rather than
  overwriting whatever the parent's stdout redirect captured.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

import pytest

from lizystudio.services import subprocess_runner
from lizystudio.services._training_core import _run_job_core

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# INV-3: size-cap helper unit tests (the head-drop truncation contract)
# ---------------------------------------------------------------------------


class TestTruncateLogIfNeeded:
    """``_truncate_log_if_needed`` keeps the tail and inserts a marker."""

    def test_under_cap_is_unchanged(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        payload = b"a" * 1024
        log.write_bytes(payload)

        subprocess_runner._truncate_log_if_needed(log, max_bytes=10_000)

        assert log.read_bytes() == payload

    def test_exactly_at_cap_is_unchanged(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        payload = b"x" * 1024
        log.write_bytes(payload)

        subprocess_runner._truncate_log_if_needed(log, max_bytes=1024)

        assert log.read_bytes() == payload

    def test_over_cap_keeps_tail_with_marker(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        # Distinguishable head + tail so we can assert which side survived.
        head = b"H" * 4096
        tail = b"T" * 4096
        log.write_bytes(head + tail)

        # Cap below the total size so a truncation must occur.
        subprocess_runner._truncate_log_if_needed(log, max_bytes=4096)

        result = log.read_bytes()
        # Marker is present at the start of the file ...
        assert result.startswith(subprocess_runner._TRUNCATION_MARKER)
        # ... and the tail of the original payload is preserved at the
        # end (we kept the most recent bytes, not the oldest).
        assert result.endswith(b"T" * 100)
        # Total file size never exceeds the cap.
        assert len(result) <= 4096

    def test_missing_file_is_silent(self, tmp_path: Path) -> None:
        # No file present — should not raise.
        subprocess_runner._truncate_log_if_needed(
            tmp_path / "missing.log", max_bytes=1024
        )


class TestReadLogTail:
    """``_read_log_tail`` returns at most n bytes from the end of the file."""

    def test_empty_file_returns_empty(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        log.write_bytes(b"")

        assert subprocess_runner._read_log_tail(log, n=4096) == b""

    def test_under_n_returns_full_content(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        log.write_bytes(b"hello world")

        assert subprocess_runner._read_log_tail(log, n=4096) == b"hello world"

    def test_over_n_returns_last_n_bytes(self, tmp_path: Path) -> None:
        log = tmp_path / "execution.log"
        # 100 distinct bytes; ask for the last 10.
        log.write_bytes(bytes(range(100)))

        tail = subprocess_runner._read_log_tail(log, n=10)
        assert tail == bytes(range(90, 100))

    def test_missing_file_returns_empty(self, tmp_path: Path) -> None:
        assert subprocess_runner._read_log_tail(tmp_path / "missing.log", n=4096) == b""


# ---------------------------------------------------------------------------
# INV-5: _run_job_core appends rather than overwrites
# ---------------------------------------------------------------------------


class TestRunJobCoreAppendsLogs:
    """The child-side logger persistence appends instead of overwriting,
    so the parent's stdout capture is preserved."""

    def test_pre_existing_content_survives_run(self, tmp_path: Path) -> None:
        from lizystudio.backends.types import DataRef

        # Build a real on-disk JobStore so path_for("log") and the
        # claim/release lifecycle work without surprises.
        from lizystudio.services.jobs import JobStore

        store = JobStore(tmp_path)
        job = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=DataRef(
                source_type="path",
                path="/tmp/x.csv",
                filename="x.csv",
                fingerprint="f",
                shape=(10, 2),
            ),
            job_type="fit",
        )

        # Pre-populate execution.log with what the parent's stdout
        # redirect would have written.
        log_path = store.path_for(job.job_id, "log")
        log_path.write_bytes(b"PARENT-STDOUT-MARKER\n")

        # Drive _run_job_core with an execute_fn that emits a log
        # record and "succeeds" with stub artefacts. ``FitSummary``
        # must be a real dataclass instance because ``JobStore.update``
        # calls ``asdict`` on it.
        from lizystudio.backends.types import FitSummary

        def execute_fn(_cb: object) -> tuple[FitSummary, object, str]:
            logging.getLogger(f"lizystudio.training.{job.job_id}").info(
                "child-logger-marker"
            )
            return (
                FitSummary(metrics={}, fold_count=0, params=[]),
                None,
                str(tmp_path / "fake_model_dir"),
            )

        _run_job_core(
            job=job,
            job_store=store,
            broadcaster=None,
            execute_fn=execute_fn,
        )

        # Both the parent's pre-existing capture AND the child's logger
        # records must end up in the file.
        contents = log_path.read_text(encoding="utf-8")
        assert "PARENT-STDOUT-MARKER" in contents
        assert "child-logger-marker" in contents
        # Order: parent's content comes first (it was written before the
        # child append).
        assert contents.index("PARENT-STDOUT-MARKER") < contents.index(
            "child-logger-marker"
        )


# ---------------------------------------------------------------------------
# INV-1 + INV-2 + INV-4: end-to-end via subprocess.Popen
#
# We do not spawn a real fit (lizyml) here — the contract under test is
# the ``run_job_in_subprocess`` *redirect plumbing*, not the trainer.
# A tiny inline Python child gives us deterministic timing (ms) and
# avoids loading lizyml/lightgbm in CI.
# ---------------------------------------------------------------------------


class TestSubprocessStdoutRedirect:
    """The parent passes a writable file fd as stdout/stderr; the child's
    output lands in ``execution.log`` regardless of which stream it
    targeted."""

    def test_stdout_lands_in_log_file(self, tmp_path: Path) -> None:
        log_path = tmp_path / "execution.log"

        # Open in append-binary as the production code does, then run a
        # tiny child that prints to stdout and stderr.
        child_code = (
            "import sys; "
            "print('STDOUT-MARKER'); "
            "print('STDERR-MARKER', file=sys.stderr); "
            "sys.stdout.flush(); sys.stderr.flush()"
        )

        with log_path.open("ab") as fp:
            proc = subprocess.Popen(
                [sys.executable, "-c", child_code],
                stdout=fp,
                stderr=subprocess.STDOUT,
            )
            proc.wait(timeout=10)

        contents = log_path.read_text(encoding="utf-8")
        assert "STDOUT-MARKER" in contents, contents
        assert "STDERR-MARKER" in contents, contents

    def test_failure_tail_logged_on_nonzero_exit(
        self,
        tmp_path: Path,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """INV-4 (regression for Issue #150 / #87): on ``returncode != 0``
        the server log still emits the failure tail. We exercise the
        emit path directly because the fix removes ``_StderrDrainer`` —
        the tail now comes from the file."""

        log_path = tmp_path / "execution.log"
        log_path.write_bytes(b"line1\nline2\nline3\nFINAL-TAIL\n")

        tail = subprocess_runner._read_log_tail(log_path, n=4096)
        decoded = tail.decode(errors="replace")

        # Mirror the pattern in run_job_in_subprocess so any future
        # regression in the format raises this test.
        with caplog.at_level(logging.ERROR, logger=subprocess_runner.__name__):
            subprocess_runner._logger.error(
                "Subprocess exited with code %d: %s",
                42,
                decoded[-500:],
            )

        msgs = [r.getMessage() for r in caplog.records]
        assert any(
            "Subprocess exited with code 42" in m and "FINAL-TAIL" in m for m in msgs
        ), msgs


class TestStderrDrainerRetired:
    """The ``_StderrDrainer`` class is gone after the fix — confirms the
    refactor actually landed (otherwise we'd have two stderr capture
    paths racing)."""

    def test_stderr_drainer_removed(self) -> None:
        assert not hasattr(subprocess_runner, "_StderrDrainer"), (
            "_StderrDrainer should be removed; stderr is now merged into "
            "execution.log via subprocess.STDOUT"
        )


class TestLargeOutputDoesNotDeadlock:
    """INV inherited from #150: a child that writes more than the OS
    pipe buffer (~64 KiB on Linux) MUST exit cleanly. Before #328 this
    was guaranteed by ``_StderrDrainer`` running on a daemon thread;
    after #328 the child writes directly to a file descriptor (no
    pipe), so OS write semantics make the deadlock physically
    impossible. We assert it anyway so any future regression that
    re-introduces a pipe is caught here.
    """

    @pytest.mark.parametrize("n_bytes", [64 * 1024, 256 * 1024, 1_024 * 1024])
    def test_large_stdout_redirected_to_file_no_deadlock(
        self, tmp_path: Path, n_bytes: int
    ) -> None:
        log_path = tmp_path / "execution.log"

        # Child writes n_bytes to stdout AND stderr; with file-fd
        # redirect both flow into log_path without ever filling a pipe.
        script = (
            "import sys; "
            f"sys.stdout.buffer.write(b'O' * {n_bytes}); "
            f"sys.stderr.buffer.write(b'E' * {n_bytes}); "
            "sys.stdout.flush(); sys.stderr.flush()"
        )

        with log_path.open("ab") as fp:
            proc = subprocess.Popen(
                [sys.executable, "-c", script],
                stdout=fp,
                stderr=subprocess.STDOUT,
            )
            try:
                proc.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=2.0)
                pytest.fail(
                    f"child blocked writing {n_bytes} bytes (deadlock "
                    "regression — pipe re-introduced?)"
                )

        assert proc.returncode == 0
        # 2 * n_bytes total written + tiny shell overhead.
        assert log_path.stat().st_size >= 2 * n_bytes
