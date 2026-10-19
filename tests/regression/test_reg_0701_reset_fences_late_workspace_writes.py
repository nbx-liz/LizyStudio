"""Regression tests for #701 / P-0114: a workspace reset must not be undone by
a worker that was launched before it.

The launcher thread persists a job's terminal status first and only then calls
``ws.record_completion`` (or ``note_current_job`` / ``register_job_thread``).
Before P-0114 nothing stopped those late writes, so a reset that landed in
between was overwritten and the finished job reappeared in the workspace
(measured 10/10 against a local backend; the e2e ``workspace-fit.spec.ts:196``
flake). Each test drives that interleaving with an event barrier, so the
order is deterministic rather than timing-dependent.
"""

from __future__ import annotations

import threading
from pathlib import Path

import pytest

from lizystudio.backends.registry import get_adapter
from lizystudio.backends.types import DataRef, FitSummary
from lizystudio.services import training, training_retune
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.workspace import WorkspaceState

_REF = DataRef(
    source_type="path",
    path="/tmp/x.csv",
    filename="x.csv",
    fingerprint="f",
    shape=(1, 1),
)
_FIT = FitSummary(metrics={"accuracy": 0.9}, fold_count=5, params=[])
_WAIT = 10.0


def _ws() -> WorkspaceState:
    ws = WorkspaceState(backend=get_adapter("lizyml"))
    ws.set_data(dataframe=None, data_ref=_REF)  # type: ignore[arg-type]
    return ws


def _job(store: JobStore, job_type: str = "fit") -> Job:
    job = store.create(
        backend_name="lizyml", config={}, data_ref=_REF, job_type=job_type
    )  # type: ignore[arg-type]
    return job


class _Gate:
    """A fake job runner that stops after the work and before returning."""

    def __init__(self, store: JobStore, status: str = "completed") -> None:
        self.store = store
        self.status = status
        self.reached = threading.Event()
        self.release = threading.Event()

    def finish(self, job: Job) -> Job:
        # Mimic the real core: persist the terminal status first ...
        job.status = self.status  # type: ignore[assignment]
        job.fit_result = _FIT if self.status == "completed" else None
        self.store.update(job)
        self.reached.set()
        # ... then return to the launcher, which records the workspace.
        assert self.release.wait(_WAIT), "test never released the gate"
        return job


def _wait_thread(ws: WorkspaceState, started: threading.Thread | None) -> None:
    thread = started or ws.previous_job_thread()
    assert thread is not None
    thread.join(_WAIT)
    assert not thread.is_alive()


def _assert_workspace_clear(ws: WorkspaceState) -> None:
    assert ws.current_job_id is None
    assert ws.workspace_fit_result is None
    assert ws.workspace_tune_result is None


def _capture_thread(monkeypatch: pytest.MonkeyPatch) -> list[threading.Thread]:
    """Record every thread a launcher starts, whether or not it is registered."""
    started: list[threading.Thread] = []
    real_start = threading.Thread.start

    def _start(self: threading.Thread) -> None:
        started.append(self)
        real_start(self)

    monkeypatch.setattr(threading.Thread, "start", _start)
    return started


def test_reset_after_completion_is_not_undone_thread_fit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    gate = _Gate(store)
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()  # the next test's beforeEach / the user's Reset
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)
    assert store.get(job.job_id).status == "completed"  # the job itself is untouched


def test_reset_after_completion_is_not_undone_thread_tune(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store, "tune")
    gate = _Gate(store)
    monkeypatch.setattr(training, "run_tune", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    training.start_tune_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_after_completion_is_not_undone_subprocess_fit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    gate = _Gate(store)
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
    )
    monkeypatch.setattr(
        "lizystudio.services.subprocess_runner.run_job_in_subprocess",
        lambda *, job, **_: gate.finish(job),
    )
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_after_completion_is_not_undone_thread_retune(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    ws.set_data(dataframe=object(), data_ref=_REF)  # type: ignore[arg-type]
    parent = _job(store, "tune")
    child = _job(store, "tune")
    assert store.acquire_parent_lock(parent.job_id, child.job_id)
    gate = _Gate(store)
    monkeypatch.setattr(
        training_retune, "run_retune", lambda *, child_job, **_: gate.finish(child_job)
    )
    started = _capture_thread(monkeypatch)

    training_retune.start_retune_async(
        ws=ws,
        job_store=store,
        broadcaster=None,  # type: ignore[arg-type]
        parent_job=parent,
        child_job=child,
        n_trials=1,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_cancelling_a_running_job_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Reset cancels a running job and waits for it; the launcher still calls
    ``record_completion`` for the cancelled job afterwards."""
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    gate = _Gate(store, status="cancelled")
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_early_failure_note_after_reset_is_fenced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``_run_subprocess_job``'s no-data early-failure path calls
    ``note_current_job``; a reset during the launch must fence it too."""
    store = JobStore(tmp_path)
    ws = WorkspaceState(backend=get_adapter("lizyml"))  # no data_ref -> early failure
    job = _job(store)
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
    )
    monkeypatch.setattr(training, "_join_previous_thread", lambda _ws: _ws.reset())
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    _wait_thread(ws, started[-1])

    assert store.get(job.job_id).status == "failed"  # the job still records its failure
    _assert_workspace_clear(ws)


def test_reset_during_launch_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reset while the launcher waits for the previous worker (the
    ``_join_previous_thread`` window) must fence both the new thread's
    registration and its completion write."""
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    monkeypatch.setattr(training, "_join_previous_thread", lambda _ws: _ws.reset())
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: job)
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)
    assert ws.previous_job_thread() is None


def test_relaunching_the_same_job_after_reset_records_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``/unpause`` re-enters ``start_tune_async`` with the same job id: the
    fence is per launcher invocation, not per job."""
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store, "tune")
    gate = _Gate(store)
    monkeypatch.setattr(training, "run_tune", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    training.start_tune_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])
    _assert_workspace_clear(ws)

    # Second invocation, after the reset: it must record normally.
    monkeypatch.setattr(training, "run_tune", lambda *, job, **_: job)
    training.start_tune_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    _wait_thread(ws, started[-1])
    assert ws.current_job_id == job.job_id


def test_launch_after_reset_records_normally(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    ws.reset()
    job = _job(store)
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: _completed(store, job))
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    _wait_thread(ws, started[-1])

    assert ws.current_job_id == job.job_id
    assert ws.workspace_fit_result == _FIT
    assert ws.previous_job_thread() is started[-1]


def test_dropped_write_is_logged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    gate = _Gate(store)
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    with caplog.at_level("INFO", logger="lizystudio.services.workspace"):
        training.start_fit_async(
            ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
        )  # type: ignore[arg-type]
        assert gate.reached.wait(_WAIT)
        ws.reset()
        gate.release.set()
        _wait_thread(ws, started[-1])

    dropped = [
        r for r in caplog.records if "workspace.stale_write_dropped" in r.getMessage()
    ]
    assert len(dropped) == 1
    message = dropped[0].getMessage()
    assert job.job_id in message
    assert "launched_epoch=0 current_epoch=1" in message


def _completed(store: JobStore, job: Job) -> Job:
    job.status = "completed"
    job.fit_result = _FIT
    store.update(job)
    return job


def _start_retune(ws: WorkspaceState, store: JobStore, parent: Job, child: Job) -> None:
    training_retune.start_retune_async(
        ws=ws,
        job_store=store,
        broadcaster=None,  # type: ignore[arg-type]
        parent_job=parent,
        child_job=child,
        n_trials=1,
        expand_boundary=None,
        boundary_threshold=None,
        mode="retune",
    )


def _retune_ws(store: JobStore) -> tuple[WorkspaceState, Job, Job]:
    ws = _ws()
    ws.set_data(dataframe=object(), data_ref=_REF)  # type: ignore[arg-type]
    parent = _job(store, "tune")
    child = _job(store, "tune")
    assert store.acquire_parent_lock(parent.job_id, child.job_id)
    return ws, parent, child


def _subprocess_mode(monkeypatch: pytest.MonkeyPatch, gate: _Gate) -> None:
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
    )
    monkeypatch.setattr(
        "lizystudio.services.subprocess_runner.run_job_in_subprocess",
        lambda *, job, **_: gate.finish(job),
    )


def test_reset_after_completion_is_not_undone_subprocess_tune(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store, "tune")
    gate = _Gate(store)
    _subprocess_mode(monkeypatch, gate)
    started = _capture_thread(monkeypatch)

    training.start_tune_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_after_completion_is_not_undone_subprocess_retune(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws, parent, child = _retune_ws(store)
    gate = _Gate(store)
    _subprocess_mode(monkeypatch, gate)
    started = _capture_thread(monkeypatch)

    _start_retune(ws, store, parent, child)
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_after_failure_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job = _job(store)
    gate = _Gate(store, status="failed")
    monkeypatch.setattr(training, "run_fit", lambda *, job, **_: gate.finish(job))
    started = _capture_thread(monkeypatch)

    training.start_fit_async(
        ws=ws, job_store=store, broadcaster=None, config={}, dataframe=None, job=job
    )  # type: ignore[arg-type]
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)


def test_reset_during_retune_launch_fences_the_failure_note(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reset during the retune join clears the dataframe, so the launcher
    takes its inline-failure path (``_mark_retune_child_failed`` ->
    ``note_current_job``); that write predates the reset and is dropped."""
    store = JobStore(tmp_path)
    ws, parent, child = _retune_ws(store)
    monkeypatch.setattr(
        training_retune, "_join_previous_thread", lambda _ws: _ws.reset()
    )

    _start_retune(ws, store, parent, child)

    assert (
        store.get(child.job_id).status == "failed"
    )  # the child still records its failure
    _assert_workspace_clear(ws)


def test_retune_worker_start_note_after_reset_is_fenced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The retune worker points the workspace at the child on start
    (``note_current_job`` at the top of ``_run``). A reset after the launcher
    captured its epoch but before the worker runs must fence that write,
    the completion, and the thread registration."""
    store = JobStore(tmp_path)
    ws, parent, child = _retune_ws(store)
    monkeypatch.setattr(
        training_retune,
        "run_retune",
        lambda *, child_job, **_: _completed(store, child_job),
    )
    started: list[threading.Thread] = []
    real_start = threading.Thread.start

    def _start_after_reset(self: threading.Thread) -> None:
        ws.reset()
        started.append(self)
        real_start(self)

    monkeypatch.setattr(threading.Thread, "start", _start_after_reset)

    _start_retune(ws, store, parent, child)
    _wait_thread(ws, started[-1])

    _assert_workspace_clear(ws)
    assert ws.previous_job_thread() is None
