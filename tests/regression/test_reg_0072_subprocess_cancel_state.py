"""Regression test: subprocess cancel must transition the job to terminal state.

When a running fit/tune is cancelled, the parent process sends SIGTERM
to the child via ``_poll_progress``. The child exits mid-run before
reaching ``_run_job_core.finally``, so it never persists a terminal
``status`` to disk. Previously ``run_job_in_subprocess`` returned the
stale "running" snapshot, leaving waiters (the UI's job poller, the
Playwright cancel test, etc.) spinning forever.

The fix reconciles the state after the subprocess exits: if the
reloaded job is still pending/running, the outcome is derived from
the cancel flag — ``cancelled`` when cancel was requested, otherwise
``failed`` with the subprocess return code in the error message.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


def _make_running_job(store: JobStore) -> str:
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    job.status = "running"
    store.update(job)
    return job.job_id


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _patch_subprocess(monkeypatch: pytest.MonkeyPatch, returncode: int) -> None:
    """Stub out subprocess.Popen so run_job_in_subprocess doesn't fork."""
    import lizystudio.services.subprocess_runner as sr

    class _StubProc:
        def __init__(self) -> None:
            self.returncode = returncode
            self.stderr = MagicMock()
            self.stderr.read = MagicMock(return_value=b"")

        def poll(self):  # type: ignore[no-untyped-def]
            return self.returncode

        def wait(self, timeout=None):  # type: ignore[no-untyped-def]
            return self.returncode

        def terminate(self) -> None:
            pass

        def kill(self) -> None:
            pass

    monkeypatch.setattr(
        sr.subprocess,
        "Popen",
        lambda *args, **kwargs: _StubProc(),
    )
    # Avoid sleep waits during the test.
    monkeypatch.setattr(sr.time, "sleep", lambda _s: None)


def test_cancel_transitions_running_job_to_cancelled(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    from lizystudio.services import subprocess_runner as sr

    job_id = _make_running_job(job_store)
    job = job_store.get(job_id)
    assert job is not None

    job_store.request_cancel(job_id)
    _patch_subprocess(monkeypatch, returncode=-15)  # SIGTERM

    result = sr.run_job_in_subprocess(
        job=job,
        job_store=job_store,
        broadcaster=None,
        backend_name="lizyml",
        data_path="/data/x.csv",
    )

    assert result.status == "cancelled", (
        f"expected cancelled after SIGTERM + cancel flag, got {result.status}"
    )
    assert result.completed_at is not None

    reloaded = job_store.get(job_id)
    assert reloaded is not None
    assert reloaded.status == "cancelled"


def test_unexpected_exit_transitions_running_job_to_failed(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Subprocess crashing without a cancel flag must mark the job failed."""
    from lizystudio.services import subprocess_runner as sr

    job_id = _make_running_job(job_store)
    job = job_store.get(job_id)
    assert job is not None

    _patch_subprocess(monkeypatch, returncode=1)

    result = sr.run_job_in_subprocess(
        job=job,
        job_store=job_store,
        broadcaster=None,
        backend_name="lizyml",
        data_path="/data/x.csv",
    )

    assert result.status == "failed"
    assert result.error is not None and "subprocess exited" in result.error.lower()

    reloaded = job_store.get(job_id)
    assert reloaded is not None
    assert reloaded.status == "failed"


def test_successful_exit_does_not_rewrite_state(
    job_store: JobStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When the subprocess already wrote a terminal state, keep it."""
    from lizystudio.services import subprocess_runner as sr

    job_id = _make_running_job(job_store)
    job = job_store.get(job_id)
    assert job is not None

    # Simulate a successful run by writing the terminal state ourselves.
    job.status = "completed"
    job.model_path = "/tmp/fake"
    job_store.update(job)

    _patch_subprocess(monkeypatch, returncode=0)

    result = sr.run_job_in_subprocess(
        job=job,
        job_store=job_store,
        broadcaster=None,
        backend_name="lizyml",
        data_path="/data/x.csv",
    )

    assert result.status == "completed"
    assert result.error is None
