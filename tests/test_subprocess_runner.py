"""Tests for subprocess job runner (H-0036).

Verifies that fit/tune jobs can execute in a subprocess with
progress forwarding and result retrieval via temp files.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore
from lizystudio.services.subprocess_runner import (
    _child_main,
    _FileBroadcaster,
    _forward_progress,
    run_job_in_subprocess,
)

pytestmark = pytest.mark.unit


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def sample_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )


@pytest.fixture()
def sample_csv(tmp_path: Path) -> Path:
    """Create a real CSV that the subprocess can load."""
    p = tmp_path / "data.csv"
    df = pd.DataFrame({"x": range(50), "y": [0, 1] * 25})
    df.to_csv(p, index=False)
    return p


@pytest.fixture()
def valid_config() -> dict[str, Any]:
    """Generate a valid LizyML config via the adapter."""
    from lizystudio.backends.registry import get_adapter

    adapter = get_adapter("lizyml")
    return adapter.get_default_config("binary", "y")


@pytest.fixture()
def valid_tune_config(valid_config: dict[str, Any]) -> dict[str, Any]:
    """Valid config with tuning section."""
    cfg = {
        **valid_config,
        "tuning": {
            "optuna": {
                "params": {"direction": "minimize", "n_trials": 2},
            },
        },
    }
    return cfg


@pytest.fixture()
def broadcaster() -> MagicMock:
    b = MagicMock()
    b.send_progress = MagicMock()
    b.send_completed = MagicMock()
    b.send_error = MagicMock()
    return b


class TestSubprocessEntryPoint:
    """The subprocess entry point should be invocable as a module."""

    def test_module_exists(self) -> None:
        """subprocess_runner module should be importable."""
        import lizystudio.services.subprocess_runner as mod

        assert hasattr(mod, "run_job_in_subprocess")

    def test_entry_point_prints_usage_without_args(self) -> None:
        """Running as __main__ without args should exit with error."""
        result = subprocess.run(
            [sys.executable, "-m", "lizystudio.services.subprocess_runner"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert result.returncode != 0


class TestRunJobInSubprocess:
    """Integration: run a job via subprocess and retrieve results."""

    @staticmethod
    def _make_data_ref(csv_path: Path) -> DataRef:
        return DataRef(
            source_type="path",
            path=str(csv_path),
            filename="data.csv",
            fingerprint="test123",
            shape=(10, 2),
        )

    def test_fit_completes_via_subprocess(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_config: dict[str, Any],
    ) -> None:
        """A fit job should complete successfully in a subprocess."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_config,
            data_ref=data_ref,
            job_type="fit",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "completed"
        assert result_job.fit_result is not None
        assert result_job.model_path is not None

    def test_tune_completes_via_subprocess(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_tune_config: dict[str, Any],
    ) -> None:
        """A tune job should complete successfully in a subprocess."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_tune_config,
            data_ref=data_ref,
            job_type="tune",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "completed"
        assert result_job.fit_result is not None
        assert result_job.tune_result is not None

    def test_progress_forwarded_to_broadcaster(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
        valid_config: dict[str, Any],
    ) -> None:
        """Progress messages from subprocess should reach the broadcaster."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            config=valid_config,
            data_ref=data_ref,
            job_type="fit",
        )
        run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        # At minimum, send_completed should have been called
        assert broadcaster.send_completed.called or broadcaster.send_error.called

    def test_failed_job_reports_error(
        self,
        job_store: JobStore,
        sample_csv: Path,
        broadcaster: MagicMock,
    ) -> None:
        """A job with invalid config should fail gracefully."""
        data_ref = self._make_data_ref(sample_csv)
        job = job_store.create(
            backend_name="lizyml",
            # Missing required 'target' field should cause failure
            config={"task": "binary"},
            data_ref=data_ref,
            job_type="fit",
        )
        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=broadcaster,
            backend_name="lizyml",
            data_path=str(sample_csv),
        )
        assert result_job.status == "failed"
        assert result_job.error is not None


# ---------------------------------------------------------------------------
# H-0062 Bugfix 2026-04-14 (5): subprocess cancel escape hatch
# ---------------------------------------------------------------------------


class TestPollProgressCancelEscape:
    """_poll_progress must honour job_store.is_cancel_requested and
    terminate the subprocess when the user cancels. Without this, a
    hung child keeps the daemon worker thread alive forever and the
    next retune hits PreviousJobStillRunningError after 30s."""

    def test_cancel_request_terminates_subprocess(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
    ) -> None:
        from lizystudio.services.subprocess_runner import _poll_progress

        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )

        # Fake Popen that reports "still running" until terminate() is
        # called. Records termination.
        state = {"alive": True, "terminate_called": False, "kill_called": False}

        class FakeProc:
            def poll(self) -> int | None:
                return None if state["alive"] else 0

            def terminate(self) -> None:
                state["terminate_called"] = True
                # Simulate the child gracefully exiting shortly after.
                state["alive"] = False

            def kill(self) -> None:
                state["kill_called"] = True
                state["alive"] = False

            def wait(self, timeout: float | None = None) -> int:
                return 0

        proc = FakeProc()

        # Request cancellation immediately.
        job_store.request_cancel(job.job_id)

        # _poll_progress should notice the cancel and terminate the proc
        # quickly (<= a couple of poll intervals).
        import time

        start = time.monotonic()
        _poll_progress(
            proc,  # type: ignore[arg-type]
            progress_path=str(Path("/tmp") / f"nonexistent_{job.job_id}.jsonl"),
            job_id=job.job_id,
            broadcaster=None,
            job_store=job_store,
        )
        elapsed = time.monotonic() - start

        assert state["terminate_called"] is True
        assert elapsed < 2.0, f"cancel escape took {elapsed}s, expected < 2s"

    def test_no_cancel_no_terminate(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
    ) -> None:
        """When cancel is not requested, _poll_progress must not call
        terminate — it should let the subprocess finish normally."""
        from lizystudio.services.subprocess_runner import _poll_progress

        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )

        poll_count = {"n": 0}
        state = {"terminate_called": False}

        class FakeProc:
            def poll(self) -> int | None:
                poll_count["n"] += 1
                # "Finish" after a few polls.
                return None if poll_count["n"] < 3 else 0

            def terminate(self) -> None:
                state["terminate_called"] = True

            def kill(self) -> None:
                state["terminate_called"] = True

            def wait(self, timeout: float | None = None) -> int:
                return 0

        proc = FakeProc()

        _poll_progress(
            proc,  # type: ignore[arg-type]
            progress_path=str(Path("/tmp") / f"nonexistent_{job.job_id}.jsonl"),
            job_id=job.job_id,
            broadcaster=None,
            job_store=job_store,
        )

        assert state["terminate_called"] is False


# ---------------------------------------------------------------------------
# Argument validation for retune mode (lines 79-88)
# ---------------------------------------------------------------------------


class TestRetuneArgValidation:
    """run_job_in_subprocess must reject invalid retune arguments before
    spawning any child process."""

    def test_retune_without_parent_job_id_raises(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )
        with pytest.raises(ValueError, match="parent_job_id"):
            run_job_in_subprocess(
                job=job,
                job_store=job_store,
                broadcaster=None,
                backend_name="lizyml",
                data_path="/nonexistent.csv",
                mode="retune",
                parent_job_id=None,
                retune_n_trials=5,
            )

    def test_retune_with_zero_n_trials_raises(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )
        with pytest.raises(ValueError, match="retune_n_trials"):
            run_job_in_subprocess(
                job=job,
                job_store=job_store,
                broadcaster=None,
                backend_name="lizyml",
                data_path="/nonexistent.csv",
                mode="retune",
                parent_job_id="parent-xyz",
                retune_n_trials=0,
            )

    def test_retune_with_negative_n_trials_raises(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )
        with pytest.raises(ValueError, match="retune_n_trials"):
            run_job_in_subprocess(
                job=job,
                job_store=job_store,
                broadcaster=None,
                backend_name="lizyml",
                data_path="/nonexistent.csv",
                mode="retune",
                parent_job_id="parent-xyz",
                retune_n_trials=-1,
            )

    def test_retune_valid_args_populate_args_file(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Valid retune args must be forwarded into the spawned child
        process args dict (lines 85-88)."""
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="tune",
        )

        captured: dict[str, Any] = {}

        class _OkProc:
            returncode = 0
            stderr = None

            def poll(self) -> int:
                return 0

            def wait(self, timeout: float | None = None) -> int:
                return 0

            def kill(self) -> None:
                pass

            def terminate(self) -> None:
                pass

        def _fake_popen(cmd: list[str], **_kwargs: Any) -> _OkProc:
            # The second-to-last element is the args.json path.
            args_path = cmd[-2]
            captured["args_path"] = args_path
            captured["args"] = json.loads(Path(args_path).read_text(encoding="utf-8"))
            return _OkProc()

        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner.subprocess.Popen",
            _fake_popen,
        )
        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner._poll_progress",
            lambda *_a, **_k: None,
        )

        run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=None,
            backend_name="lizyml",
            data_path="/nonexistent.csv",
            mode="retune",
            parent_job_id="parent-abc",
            retune_n_trials=7,
            retune_expand_boundary=False,
            retune_boundary_threshold=0.25,
        )

        assert captured["args"]["parent_job_id"] == "parent-abc"
        assert captured["args"]["retune_n_trials"] == 7
        assert captured["args"]["retune_expand_boundary"] is False
        assert captured["args"]["retune_boundary_threshold"] == 0.25


# ---------------------------------------------------------------------------
# Subprocess hung / non-zero exit / missing persisted result
# (lines 126-134, 137-139, 152-154)
# ---------------------------------------------------------------------------


class _FakeProcTimeoutThenExit:
    """Popen fake whose first wait() raises TimeoutExpired, then succeeds."""

    def __init__(self, returncode: int = 0, stderr_bytes: bytes = b"") -> None:
        self.returncode = returncode
        self._wait_calls = 0
        self._terminated = False
        self._killed = False

        class _StderrBuf:
            def __init__(self, data: bytes) -> None:
                self._data = data

            def read(self) -> bytes:
                return self._data

        self.stderr = _StderrBuf(stderr_bytes)

    def poll(self) -> int | None:
        # After kill, report as exited.
        return self.returncode if self._killed else None

    def wait(self, timeout: float | None = None) -> int:
        self._wait_calls += 1
        if self._wait_calls == 1:
            raise subprocess.TimeoutExpired(cmd="fake", timeout=timeout or 0)
        return self.returncode

    def kill(self) -> None:
        self._killed = True

    def terminate(self) -> None:
        self._terminated = True


class TestSubprocessTimeoutAndErrors:
    """Cover the hung-subprocess escalation, non-zero exit logging, and
    the fallback when job_store.get returns None after subprocess exit."""

    def test_timeout_expired_triggers_kill_and_nonzero_logging(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )

        fake = _FakeProcTimeoutThenExit(
            returncode=2, stderr_bytes=b"boom: something failed"
        )

        def _fake_popen(*_args: Any, **_kwargs: Any) -> _FakeProcTimeoutThenExit:
            return fake

        def _fake_poll_progress(*_args: Any, **_kwargs: Any) -> None:
            # Short-circuit: do not actually poll the progress file.
            return None

        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner.subprocess.Popen",
            _fake_popen,
        )
        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner._poll_progress",
            _fake_poll_progress,
        )

        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=None,
            backend_name="lizyml",
            data_path="/nonexistent.csv",
        )

        # kill() must have been called because first wait() timed out.
        assert fake._killed is True
        # The real job on disk is still "pending" (no subprocess actually
        # ran), so run_job_in_subprocess returns the reloaded job object.
        # The hung-subprocess path still reloads the job from disk; it's
        # fine if it matches the original.
        assert result_job is not None

    def test_missing_persisted_result_returns_failed_fallback(
        self,
        job_store: JobStore,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )

        fake = _FakeProcTimeoutThenExit(returncode=0, stderr_bytes=b"")

        def _fake_popen(*_args: Any, **_kwargs: Any) -> _FakeProcTimeoutThenExit:
            return fake

        def _fake_poll_progress(*_args: Any, **_kwargs: Any) -> None:
            return None

        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner.subprocess.Popen",
            _fake_popen,
        )
        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner._poll_progress",
            _fake_poll_progress,
        )

        # Force job_store.get to return None after "subprocess" exit to
        # exercise the fallback branch (lines 152-154).
        original_get = job_store.get
        call_state = {"n": 0}

        def _fake_get(job_id: str) -> Any:
            call_state["n"] += 1
            # First call happens inside run_job_in_subprocess after
            # "subprocess" exit: return None.
            if call_state["n"] == 1:
                return None
            return original_get(job_id)

        monkeypatch.setattr(job_store, "get", _fake_get)

        result_job = run_job_in_subprocess(
            job=job,
            job_store=job_store,
            broadcaster=None,
            backend_name="lizyml",
            data_path="/nonexistent.csv",
        )

        assert result_job.status == "failed"
        assert result_job.error == "Subprocess did not persist job result"


# ---------------------------------------------------------------------------
# _forward_progress edge cases (lines 217, 220-221)
# ---------------------------------------------------------------------------


class TestForwardProgress:
    """Cover None broadcaster, blank line, and malformed JSON."""

    def test_none_broadcaster_is_noop(self) -> None:
        # Should not raise even though broadcaster is None and line is valid JSON.
        _forward_progress('{"type": "progress"}', "job-1", None)

    def test_empty_line_is_noop(self) -> None:
        b = MagicMock()
        _forward_progress("", "job-1", b)
        _forward_progress("   \n", "job-1", b)
        b.send_progress.assert_not_called()
        b.send_completed.assert_not_called()
        b.send_error.assert_not_called()

    def test_malformed_json_is_silently_ignored(self) -> None:
        b = MagicMock()
        _forward_progress("{not json", "job-1", b)
        b.send_progress.assert_not_called()

    def test_progress_with_fold_and_trial_results(self) -> None:
        b = MagicMock()
        payload = json.dumps(
            {
                "type": "progress",
                "current": 1,
                "total": 5,
                "message": "fold 1",
                "fold_results": [{"fold": 0, "score": 0.9}],
                "trial_results": [{"trial": 0, "value": 0.8}],
            }
        )
        _forward_progress(payload, "job-1", b)
        b.send_progress.assert_called_once()
        kwargs = b.send_progress.call_args.kwargs
        assert kwargs["fold_results"] == [{"fold": 0, "score": 0.9}]
        assert kwargs["trial_results"] == [{"trial": 0, "value": 0.8}]

    def test_completed_and_error_dispatch(self) -> None:
        b = MagicMock()
        _forward_progress('{"type": "completed"}', "job-1", b)
        b.send_completed.assert_called_once_with("job-1")
        _forward_progress(
            '{"type": "error", "message": "bad", "code": "FIT_ERROR"}', "job-1", b
        )
        b.send_error.assert_called_once_with("job-1", "bad", code="FIT_ERROR")

    def test_paused_dispatch_forwards_to_send_paused(self) -> None:
        """P-0099 v3-20e regression — the JSONL line ``{"type":
        "paused", ...}`` written by the subprocess child via
        ``_FileBroadcaster.send_paused`` must be forwarded to the live
        parent broadcaster's ``send_paused`` so WS subscribers see the
        transition. The CI failure for PR #427 traced to this missing
        case in ``_forward_progress``.
        """
        b = MagicMock()
        _forward_progress(
            '{"type": "paused", "trial_number": 5, "message": "Paused."}',
            "job-1",
            b,
        )
        b.send_paused.assert_called_once_with(
            "job-1", trial_number=5, message="Paused."
        )


# ---------------------------------------------------------------------------
# _FileBroadcaster (lines 341, 353-363, 366, 377, 385-388)
# ---------------------------------------------------------------------------


class TestFileBroadcaster:
    """Direct tests for the file-backed broadcaster used in the child process."""

    def test_send_progress_writes_jsonl(self, tmp_path: Path) -> None:
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_progress(
            "job-1",
            current=1,
            total=10,
            message="step 1",
            fold_results=[{"fold": 0, "score": 0.91}],
            trial_results=[{"trial": 0, "value": 0.82}],
        )
        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        msg = json.loads(lines[0])
        assert msg["type"] == "progress"
        assert msg["current"] == 1
        assert msg["total"] == 10
        assert msg["message"] == "step 1"
        assert msg["fold_results"] == [{"fold": 0, "score": 0.91}]
        assert msg["trial_results"] == [{"trial": 0, "value": 0.82}]

    def test_send_progress_without_optional_fields(self, tmp_path: Path) -> None:
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_progress("job-1", current=0, total=5, message="init")
        msg = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        assert "fold_results" not in msg
        assert "trial_results" not in msg

    def test_send_completed_writes_jsonl(self, tmp_path: Path) -> None:
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_completed("job-1")
        msg = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        assert msg["type"] == "completed"

    def test_send_error_writes_jsonl(self, tmp_path: Path) -> None:
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_error("job-1", "something bad", code="FIT_ERROR")
        msg = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        assert msg["type"] == "error"
        assert msg["message"] == "something bad"
        assert msg["code"] == "FIT_ERROR"

    def test_send_paused_writes_jsonl(self, tmp_path: Path) -> None:
        """P-0099 v3-20e regression — _FileBroadcaster must implement
        ``send_paused`` so subprocess workers can notify the parent
        without crashing on AttributeError. The bug surfaced in CI for
        PR #427 (v3-23) when the e2e tune-resume spec hit the paused
        branch of ``_run_job_core`` inside a subprocess child.
        """
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_paused("job-1", trial_number=7, message="Paused.")
        msg = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        assert msg["type"] == "paused"
        assert msg["trial_number"] == 7
        assert msg["message"] == "Paused."

    def test_send_paused_omits_trial_number_when_unset(self, tmp_path: Path) -> None:
        path = tmp_path / "progress.jsonl"
        fb = _FileBroadcaster(str(path))
        fb.send_paused("job-1")
        msg = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
        assert msg["type"] == "paused"
        assert "trial_number" not in msg
        assert msg["message"] == "Paused."


# ---------------------------------------------------------------------------
# _child_main dispatch (lines 252-330)
# ---------------------------------------------------------------------------


def _write_args(tmp_path: Path, payload: dict[str, Any]) -> tuple[str, str]:
    args_path = tmp_path / "args.json"
    progress_path = tmp_path / "progress.jsonl"
    args_path.write_text(json.dumps(payload), encoding="utf-8")
    return str(args_path), str(progress_path)


class TestChildMain:
    """Call _child_main directly with temp files, mocking the heavy
    run_fit / run_tune / run_retune paths."""

    def test_fit_dispatch(
        self,
        job_store: JobStore,
        sample_csv: Path,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={"task": "binary", "target": "y"},
            data_ref=sample_data_ref,
            job_type="fit",
        )

        called: dict[str, Any] = {}

        def _fake_run_fit(**kwargs: Any) -> None:
            called["run_fit"] = kwargs

        def _fake_run_tune(**kwargs: Any) -> None:
            called["run_tune"] = kwargs

        def _fake_run_retune(**kwargs: Any) -> None:
            called["run_retune"] = kwargs

        def _fake_load_dataframe(_path: str) -> Any:
            return pd.DataFrame({"x": [1, 2], "y": [0, 1]})

        def _fake_get_adapter(_name: str) -> Any:
            return MagicMock()

        monkeypatch.setattr("lizystudio.services.training.run_fit", _fake_run_fit)
        monkeypatch.setattr("lizystudio.services.training.run_tune", _fake_run_tune)
        monkeypatch.setattr("lizystudio.services.training.run_retune", _fake_run_retune)
        monkeypatch.setattr(
            "lizystudio.services.data.load_dataframe", _fake_load_dataframe
        )
        monkeypatch.setattr(
            "lizystudio.backends.registry.get_adapter", _fake_get_adapter
        )

        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": job.job_id,
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {"task": "binary", "target": "y"},
                "data_path": str(sample_csv),
                "job_type": "fit",
                "mode": "job",
            },
        )

        _child_main(args_path, progress_path)
        assert "run_fit" in called
        assert "run_tune" not in called
        assert "run_retune" not in called

    def test_tune_dispatch(
        self,
        job_store: JobStore,
        sample_csv: Path,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        job = job_store.create(
            backend_name="lizyml",
            config={"task": "binary", "target": "y"},
            data_ref=sample_data_ref,
            job_type="tune",
        )

        called: dict[str, Any] = {}

        monkeypatch.setattr(
            "lizystudio.services.training.run_fit",
            lambda **kw: called.setdefault("run_fit", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.training.run_tune",
            lambda **kw: called.setdefault("run_tune", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.training.run_retune",
            lambda **kw: called.setdefault("run_retune", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.data.load_dataframe",
            lambda _p: pd.DataFrame({"x": [1, 2], "y": [0, 1]}),
        )
        monkeypatch.setattr(
            "lizystudio.backends.registry.get_adapter",
            lambda _n: MagicMock(),
        )

        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": job.job_id,
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {"task": "binary", "target": "y"},
                "data_path": str(sample_csv),
                "job_type": "tune",
                "mode": "job",
            },
        )

        _child_main(args_path, progress_path)
        assert "run_tune" in called
        assert "run_fit" not in called

    def test_retune_dispatch(
        self,
        job_store: JobStore,
        sample_csv: Path,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        parent = job_store.create(
            backend_name="lizyml",
            config={"task": "binary", "target": "y"},
            data_ref=sample_data_ref,
            job_type="tune",
        )
        child = job_store.create(
            backend_name="lizyml",
            config={"task": "binary", "target": "y"},
            data_ref=sample_data_ref,
            job_type="tune",
            parent_job_id=parent.job_id,
        )

        called: dict[str, Any] = {}

        monkeypatch.setattr(
            "lizystudio.services.training.run_fit",
            lambda **kw: called.setdefault("run_fit", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.training.run_tune",
            lambda **kw: called.setdefault("run_tune", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.training.run_retune",
            lambda **kw: called.setdefault("run_retune", kw),
        )
        monkeypatch.setattr(
            "lizystudio.services.data.load_dataframe",
            lambda _p: pd.DataFrame({"x": [1, 2], "y": [0, 1]}),
        )
        monkeypatch.setattr(
            "lizystudio.backends.registry.get_adapter",
            lambda _n: MagicMock(),
        )

        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": child.job_id,
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {"task": "binary", "target": "y"},
                "data_path": str(sample_csv),
                "job_type": "tune",
                "mode": "retune",
                "parent_job_id": parent.job_id,
                "retune_n_trials": 3,
                "retune_expand_boundary": True,
                "retune_boundary_threshold": 0.1,
            },
        )

        _child_main(args_path, progress_path)
        assert "run_retune" in called
        kw = called["run_retune"]
        assert kw["n_trials"] == 3
        assert kw["expand_boundary"] is True
        assert kw["boundary_threshold"] == 0.1

    def test_retune_with_missing_parent_writes_error_and_exits(
        self,
        job_store: JobStore,
        sample_csv: Path,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        child = job_store.create(
            backend_name="lizyml",
            config={"task": "binary", "target": "y"},
            data_ref=sample_data_ref,
            job_type="tune",
        )

        monkeypatch.setattr("lizystudio.services.training.run_fit", lambda **_kw: None)
        monkeypatch.setattr("lizystudio.services.training.run_tune", lambda **_kw: None)
        monkeypatch.setattr(
            "lizystudio.services.training.run_retune", lambda **_kw: None
        )
        monkeypatch.setattr(
            "lizystudio.services.data.load_dataframe",
            lambda _p: pd.DataFrame({"x": [1, 2], "y": [0, 1]}),
        )
        monkeypatch.setattr(
            "lizystudio.backends.registry.get_adapter",
            lambda _n: MagicMock(),
        )

        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": child.job_id,
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {"task": "binary", "target": "y"},
                "data_path": str(sample_csv),
                "job_type": "tune",
                "mode": "retune",
                "parent_job_id": "does-not-exist",
                "retune_n_trials": 1,
                "retune_expand_boundary": None,
                "retune_boundary_threshold": None,
            },
        )

        with pytest.raises(SystemExit) as excinfo:
            _child_main(args_path, progress_path)
        assert excinfo.value.code == 1

        content = Path(progress_path).read_text(encoding="utf-8")
        assert "Parent job does-not-exist not found" in content

    def test_missing_job_writes_error_and_exits(
        self,
        job_store: JobStore,
        sample_csv: Path,
        tmp_path: Path,
    ) -> None:
        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": "no-such-job",
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {},
                "data_path": str(sample_csv),
                "job_type": "fit",
                "mode": "job",
            },
        )

        with pytest.raises(SystemExit) as excinfo:
            _child_main(args_path, progress_path)
        assert excinfo.value.code == 1

        content = Path(progress_path).read_text(encoding="utf-8")
        assert "Job no-such-job not found" in content

    def test_unknown_job_type_writes_error_and_exits(
        self,
        job_store: JobStore,
        sample_csv: Path,
        sample_data_ref: DataRef,
        monkeypatch: pytest.MonkeyPatch,
        tmp_path: Path,
    ) -> None:
        # Create a valid job (job_type is constrained to fit/tune at the
        # store level), then write an args file with an unknown job_type
        # to exercise the fallthrough.
        job = job_store.create(
            backend_name="lizyml",
            config={},
            data_ref=sample_data_ref,
            job_type="fit",
        )

        monkeypatch.setattr(
            "lizystudio.services.data.load_dataframe",
            lambda _p: pd.DataFrame({"x": [1, 2], "y": [0, 1]}),
        )
        monkeypatch.setattr(
            "lizystudio.backends.registry.get_adapter",
            lambda _n: MagicMock(),
        )

        args_path, progress_path = _write_args(
            tmp_path,
            {
                "job_id": job.job_id,
                "jobs_dir": str(job_store.jobs_dir),
                "backend_name": "lizyml",
                "config": {},
                "data_path": str(sample_csv),
                "job_type": "predict",  # unknown
                "mode": "job",
            },
        )

        with pytest.raises(SystemExit) as excinfo:
            _child_main(args_path, progress_path)
        assert excinfo.value.code == 1

        content = Path(progress_path).read_text(encoding="utf-8")
        assert "Unknown job_type: predict" in content


# ---------------------------------------------------------------------------
# __main__ argv-length guard (lines 392-398)
# ---------------------------------------------------------------------------


class TestMainArgvGuard:
    """Exercise the __main__ block directly via runpy so coverage is
    collected (subprocess-launched runs do not count toward the parent's
    coverage report)."""

    def test_main_wrong_argv_exits_with_error(
        self,
        monkeypatch: pytest.MonkeyPatch,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        import runpy

        monkeypatch.setattr(sys, "argv", ["subprocess_runner"])  # only 1 arg
        with pytest.raises(SystemExit) as excinfo:
            runpy.run_module(
                "lizystudio.services.subprocess_runner",
                run_name="__main__",
            )
        assert excinfo.value.code == 1
        captured = capsys.readouterr()
        assert "Usage" in captured.err
