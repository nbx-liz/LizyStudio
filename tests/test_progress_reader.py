"""Unit tests for the incremental ``_ProgressReader`` (Issue #87).

The legacy ``_poll_progress`` read the progress file in full on every
poll via ``read_text().splitlines()[lines_read:]``. That is O(N) per
poll in the number of already-consumed lines, so a long tune (hundreds
of trials + per-fold progress) stalls the parent thread proportionally
as the file grows. It also dropped partial writes: if a poll raced the
child between ``f.write(...)`` and the trailing newline, the incomplete
tail got parsed as JSON, failed, and was never retried.

The replacement is a file-handle-backed reader that:

1. Keeps an open ``open(path, 'rb')`` handle and reads only new bytes
   since the last call (``os.read``-style tail semantics).
2. Buffers a partial trailing line across calls so it is never dropped.
3. Decodes and splits into *complete* lines on each call, leaving any
   unterminated tail in the buffer.
4. Exposes a ``final_flush()`` that returns whatever is still in the
   buffer when the subprocess has exited — the caller can choose to
   forward it even without a terminating newline (end-of-stream).

These tests lock the contract before the implementation lands.
"""

from __future__ import annotations

from pathlib import Path

import pytest

pytestmark = pytest.mark.unit


def _append_text(path: Path, text: str) -> None:
    """Append ``text`` to ``path`` using the same flush semantics as
    the real ``_write_progress`` helper (write -> flush -> fsync).
    """
    import os

    with open(path, "a", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())


@pytest.fixture()
def progress_path(tmp_path: Path) -> Path:
    return tmp_path / "progress.jsonl"


# ---------------------------------------------------------------------------
# Core contract: incremental reads, no full re-parse
# ---------------------------------------------------------------------------
class TestProgressReaderIncremental:
    def test_returns_empty_list_when_file_missing(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == []

    def test_returns_complete_lines_on_first_call(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, '{"type": "progress", "n": 1}\n')
        _append_text(progress_path, '{"type": "progress", "n": 2}\n')

        reader = _ProgressReader(str(progress_path))
        lines = reader.read_new_lines()

        assert lines == [
            '{"type": "progress", "n": 1}',
            '{"type": "progress", "n": 2}',
        ]

    def test_subsequent_calls_only_return_new_lines(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "line-1\n")
        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == ["line-1"]

        # Second call with no new data must return nothing.
        assert reader.read_new_lines() == []

        # New data appended -> only the new line is returned.
        _append_text(progress_path, "line-2\n")
        assert reader.read_new_lines() == ["line-2"]

    def test_does_not_re_emit_already_returned_lines(self, progress_path: Path) -> None:
        """Regression guard for the legacy ``lines[lines_read:]`` slicing.

        If a future refactor goes back to re-reading from offset 0, the
        earlier lines will be returned again. This is an explicit "no
        duplicates" assertion.
        """
        from lizystudio.services.subprocess_runner import _ProgressReader

        for i in range(5):
            _append_text(progress_path, f"line-{i}\n")
        reader = _ProgressReader(str(progress_path))

        first_batch = reader.read_new_lines()
        assert len(first_batch) == 5

        # Append two more lines.
        _append_text(progress_path, "line-5\n")
        _append_text(progress_path, "line-6\n")

        second_batch = reader.read_new_lines()
        assert second_batch == ["line-5", "line-6"]


# ---------------------------------------------------------------------------
# Partial-line buffering: the core bug fix
# ---------------------------------------------------------------------------
class TestProgressReaderPartialLines:
    def test_partial_tail_is_buffered_not_returned(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        # Simulate a child that wrote the JSON payload then died before
        # appending the newline. The caller should NOT see a half line.
        _append_text(progress_path, '{"type": "progress"')

        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == []

    def test_partial_tail_is_completed_by_next_write(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        reader = _ProgressReader(str(progress_path))
        # Partial line written before first poll.
        _append_text(progress_path, '{"type": "progress"')
        assert reader.read_new_lines() == []

        # Rest of the line arrives.
        _append_text(progress_path, ', "n": 1}\n')
        assert reader.read_new_lines() == ['{"type": "progress", "n": 1}']

    def test_mixed_complete_and_partial_in_single_read(
        self, progress_path: Path
    ) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "complete-1\ncomplete-2\npartial-ta")

        reader = _ProgressReader(str(progress_path))
        first = reader.read_new_lines()
        assert first == ["complete-1", "complete-2"]

        _append_text(progress_path, "il\n")
        assert reader.read_new_lines() == ["partial-tail"]


# ---------------------------------------------------------------------------
# final_flush: end-of-stream handling
# ---------------------------------------------------------------------------
class TestProgressReaderFinalFlush:
    def test_final_flush_returns_any_buffered_partial_line(
        self, progress_path: Path
    ) -> None:
        """At subprocess EOF, any unterminated tail should be emitted.

        This is the "child was killed mid-write" path. The legacy code
        silently dropped these; with an explicit ``final_flush``, the
        caller can forward them as best-effort messages (or at least
        log them) instead of losing the information.
        """
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "complete-line\nhalf-")
        reader = _ProgressReader(str(progress_path))

        complete = reader.read_new_lines()
        assert complete == ["complete-line"]

        remaining = reader.final_flush()
        assert remaining == ["half-"]

    def test_final_flush_empty_when_no_buffered_partial(
        self, progress_path: Path
    ) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "a\nb\n")
        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == ["a", "b"]
        assert reader.final_flush() == []

    def test_final_flush_is_idempotent(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "partial")
        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == []
        assert reader.final_flush() == ["partial"]
        # Second flush must not re-emit the same buffered line.
        assert reader.final_flush() == []


# ---------------------------------------------------------------------------
# File-descriptor lifecycle: close is safe, reopen after missing is safe
# ---------------------------------------------------------------------------
class TestProgressReaderLifecycle:
    def test_close_releases_file_handle_safely(self, progress_path: Path) -> None:
        from lizystudio.services.subprocess_runner import _ProgressReader

        _append_text(progress_path, "line\n")
        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == ["line"]
        reader.close()
        # Calling close twice must not raise.
        reader.close()

    def test_file_created_after_reader_init(self, progress_path: Path) -> None:
        """Reader is typically instantiated before the subprocess has
        written anything. It must handle the "file does not exist yet"
        state and start streaming as soon as writes begin.
        """
        from lizystudio.services.subprocess_runner import _ProgressReader

        reader = _ProgressReader(str(progress_path))
        assert reader.read_new_lines() == []

        _append_text(progress_path, "first-write\n")
        assert reader.read_new_lines() == ["first-write"]
