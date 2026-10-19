"""Regression tests for #701 / P-0114: a workspace reset must not be undone by
a worker that was launched before it.

The launcher thread persists a job's terminal status first and only then calls
``ws.record_completion`` (or ``note_current_job`` / ``register_job_thread``).
Before P-0114 nothing stopped those late writes, so a reset that landed in
between was overwritten and the finished job reappeared in the workspace
(measured 10/10 against a local backend; the e2e ``workspace-fit.spec.ts:196``
flake). Each test drives its interleaving with an event barrier or a patched
``Thread.start``, so the order is deterministic rather than timing-dependent.
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from pathlib import Path

import pytest

from lizystudio.api.workspace import workspace_reset
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

_KINDS = ("fit", "tune", "retune")
_MODES = ("thread", "subprocess")
_TERMINAL = ("completed", "failed", "cancelled")

Runner = Callable[[Job], Job]


def _ws() -> WorkspaceState:
    ws = WorkspaceState(backend=get_adapter("lizyml"))
    ws.set_data(dataframe=object(), data_ref=_REF)  # type: ignore[arg-type]
    return ws


def _job(store: JobStore, job_type: str = "fit") -> Job:
    return store.create(
        backend_name="lizyml",
        config={},
        data_ref=_REF,
        job_type=job_type,  # type: ignore[arg-type]
    )


def _finish(store: JobStore, job: Job, status: str = "completed") -> Job:
    """Persist a terminal status the way the real core does, then return."""
    job.status = status  # type: ignore[assignment]
    job.fit_result = _FIT if status == "completed" else None
    store.update(job)
    return job


class _Gate:
    """A fake job runner that stops after persisting the terminal status and
    before returning to the launcher (which then writes the workspace)."""

    def __init__(self, store: JobStore, status: str = "completed") -> None:
        self.store = store
        self.status = status
        self.reached = threading.Event()
        self.release = threading.Event()

    def __call__(self, job: Job) -> Job:
        _finish(self.store, job, self.status)
        self.reached.set()
        assert self.release.wait(_WAIT), "test never released the gate"
        return job


def _route(
    monkeypatch: pytest.MonkeyPatch, kind: str, mode: str, runner: Runner
) -> None:
    """Send the launcher's job execution for *kind* / *mode* to *runner*."""
    if mode == "subprocess":
        monkeypatch.setattr(
            "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
        )
        monkeypatch.setattr(
            "lizystudio.services.subprocess_runner.run_job_in_subprocess",
            lambda *, job, **_: runner(job),
        )
    elif kind == "fit":
        monkeypatch.setattr(training, "run_fit", lambda *, job, **_: runner(job))
    elif kind == "tune":
        monkeypatch.setattr(training, "run_tune", lambda *, job, **_: runner(job))
    else:
        monkeypatch.setattr(
            training_retune, "run_retune", lambda *, child_job, **_: runner(child_job)
        )


def _prepare(
    store: JobStore, ws: WorkspaceState, kind: str
) -> tuple[Job, Callable[[], str]]:
    """Create the job for *kind* and return it with a zero-arg launcher."""
    if kind == "retune":
        parent = _job(store, "tune")
        child = _job(store, "tune")
        assert store.acquire_parent_lock(parent.job_id, child.job_id)

        def _launch_retune() -> str:
            return training_retune.start_retune_async(
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

        return child, _launch_retune
    job = _job(store, kind)
    start = training.start_fit_async if kind == "fit" else training.start_tune_async

    def _launch() -> str:
        return start(
            ws=ws,
            job_store=store,
            broadcaster=None,  # type: ignore[arg-type]
            config={},
            dataframe=None,
            job=job,
        )

    return job, _launch


def _capture_thread(monkeypatch: pytest.MonkeyPatch) -> list[threading.Thread]:
    """Record every thread a launcher starts, whether or not it is registered."""
    started: list[threading.Thread] = []
    real_start = threading.Thread.start

    def _start(self: threading.Thread) -> None:
        started.append(self)
        real_start(self)

    monkeypatch.setattr(threading.Thread, "start", _start)
    return started


def _join(thread: threading.Thread) -> None:
    thread.join(_WAIT)
    assert not thread.is_alive()


def _assert_workspace_clear(ws: WorkspaceState) -> None:
    assert ws.current_job_id is None
    assert ws.workspace_fit_result is None
    assert ws.workspace_tune_result is None


# --- AC3 / AC6: reset after the terminal status is persisted -----------------


@pytest.mark.parametrize("status", _TERMINAL)
@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("kind", _KINDS)
def test_reset_after_terminal_status_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str, mode: str, status: str
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job, launch = _prepare(store, ws, kind)
    gate = _Gate(store, status)
    _route(monkeypatch, kind, mode, gate)
    started = _capture_thread(monkeypatch)

    launch()
    assert gate.reached.wait(_WAIT)
    ws.reset()  # the next test's beforeEach / the user's Reset
    gate.release.set()
    _join(started[-1])

    _assert_workspace_clear(ws)
    stored = store.get(job.job_id)
    assert stored is not None
    assert stored.status == status  # the job record itself is untouched


# --- AC4: reset of a running job through the real API path -------------------


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("kind", ("fit", "tune"))
def test_api_reset_cancelling_a_running_job_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str, mode: str
) -> None:
    """``workspace_reset`` requests cancel, waits for the active slot, then
    resets. In thread mode ``_run_job_core`` releases the slot in its
    ``finally`` before the launcher calls ``record_completion``. In
    subprocess mode the parent releases it only after ``record_completion``,
    but once the child has persisted ``cancelled`` the reset's slot wait
    reclaims the slot itself (``force_release_active_if``), so in both modes
    the reset can run before the launcher's write.
    """
    store = JobStore(tmp_path)
    ws = _ws()
    job = store.create_and_claim_active(
        backend_name="lizyml",
        config={},
        data_ref=_REF,
        job_type=kind,  # type: ignore[arg-type]
    )
    assert job is not None
    running = threading.Event()

    def _cancellable(j: Job) -> Job:
        j.status = "running"
        store.update(j)
        running.set()
        deadline = time.monotonic() + _WAIT
        while not store.is_cancel_requested(j.job_id):
            assert time.monotonic() < deadline, "reset never requested cancel"
            time.sleep(0.005)
        _finish(store, j, "cancelled")
        epoch = ws.current_epoch()
        if mode == "thread":
            store.release_active(j.job_id)  # the core's finally
        # Subprocess mode: the parent's finally releases the slot later; the
        # reset reclaims it from the terminal status on disk instead.
        # Hand control back to the launcher only once the reset has run,
        # which is the order that restored the job before P-0114.
        while ws.current_epoch() == epoch:
            assert time.monotonic() < deadline, "reset never ran"
            time.sleep(0.005)
        return j

    _route(monkeypatch, kind, mode, _cancellable)
    _, launch = _prepare_existing(store, ws, kind, job)
    started = _capture_thread(monkeypatch)

    launch()
    assert running.wait(_WAIT)
    assert workspace_reset(ws=ws, job_store=store) == {"status": "ok"}
    _join(started[-1])

    _assert_workspace_clear(ws)
    stored = store.get(job.job_id)
    assert stored is not None
    assert stored.status == "cancelled"
    assert store.active_job_id is None


def _prepare_existing(
    store: JobStore, ws: WorkspaceState, kind: str, job: Job
) -> tuple[Job, Callable[[], str]]:
    start = training.start_fit_async if kind == "fit" else training.start_tune_async

    def _launch() -> str:
        return start(
            ws=ws,
            job_store=store,
            broadcaster=None,  # type: ignore[arg-type]
            config={},
            dataframe=None,
            job=job,
        )

    return job, _launch


# --- AC1: reset during the launch ---------------------------------------------


@pytest.mark.parametrize("kind", ("fit", "tune"))
def test_reset_during_launch_join_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    """A reset while the launcher waits for the previous worker (the
    ``_join_previous_thread`` window) fences both the new thread's
    registration and its completion write."""
    store = JobStore(tmp_path)
    ws = _ws()
    job, launch = _prepare(store, ws, kind)
    monkeypatch.setattr(training, "_join_previous_thread", lambda w: w.reset())
    _route(monkeypatch, kind, "thread", lambda j: _finish(store, j))
    started = _capture_thread(monkeypatch)

    launch()
    _join(started[-1])

    _assert_workspace_clear(ws)
    assert ws.previous_job_thread() is None


@pytest.mark.parametrize("kind", _KINDS)
def test_reset_between_thread_start_and_registration_is_not_undone(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str
) -> None:
    """The reset lands after ``t.start()`` has started the worker and before
    the launcher's ``register_job_thread``: the registration is dropped, and
    so is the worker's later completion write."""
    store = JobStore(tmp_path)
    ws = _ws()
    job, launch = _prepare(store, ws, kind)
    gate = _Gate(store)
    _route(monkeypatch, kind, "thread", gate)
    started: list[threading.Thread] = []
    real_start = threading.Thread.start

    def _start_then_reset(self: threading.Thread) -> None:
        real_start(self)
        started.append(self)
        ws.reset()

    monkeypatch.setattr(threading.Thread, "start", _start_then_reset)

    launch()
    assert ws.previous_job_thread() is None  # registration was dropped
    gate.release.set()
    _join(started[-1])

    _assert_workspace_clear(ws)
    assert ws.previous_job_thread() is None


def test_retune_worker_start_note_after_reset_is_fenced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The retune worker points the workspace at the child on start
    (``note_current_job`` at the top of ``_run``). A reset after the launcher
    captured its epoch and before the worker runs fences that write, the
    completion, and the thread registration."""
    store = JobStore(tmp_path)
    ws = _ws()
    _, launch = _prepare(store, ws, "retune")
    _route(monkeypatch, "retune", "thread", lambda j: _finish(store, j))
    started: list[threading.Thread] = []
    real_start = threading.Thread.start

    def _reset_then_start(self: threading.Thread) -> None:
        ws.reset()
        started.append(self)
        real_start(self)

    monkeypatch.setattr(threading.Thread, "start", _reset_then_start)

    launch()
    _join(started[-1])

    _assert_workspace_clear(ws)
    assert ws.previous_job_thread() is None


def test_reset_during_retune_launch_fences_the_failure_note(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A reset during the retune join clears the dataframe, so the launcher
    takes its inline-failure path (``_mark_retune_child_failed`` ->
    ``note_current_job``); that write predates the reset and is dropped."""
    store = JobStore(tmp_path)
    ws = _ws()
    child, launch = _prepare(store, ws, "retune")
    monkeypatch.setattr(training_retune, "_join_previous_thread", lambda w: w.reset())

    launch()

    stored = store.get(child.job_id)
    assert stored is not None
    assert stored.status == "failed"  # the child still records its failure
    _assert_workspace_clear(ws)


def test_early_failure_note_after_reset_is_fenced(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``_run_subprocess_job``'s no-data early-failure path calls
    ``note_current_job``; a reset during the launch fences it too."""
    store = JobStore(tmp_path)
    ws = WorkspaceState(backend=get_adapter("lizyml"))  # no data_ref -> early failure
    job, launch = _prepare(store, ws, "fit")
    monkeypatch.setattr(
        "lizystudio.services.openmp_detect.should_use_subprocess", lambda: True
    )
    monkeypatch.setattr(training, "_join_previous_thread", lambda w: w.reset())
    started = _capture_thread(monkeypatch)

    launch()
    _join(started[-1])

    stored = store.get(job.job_id)
    assert stored is not None
    assert stored.status == "failed"  # the job still records its failure
    _assert_workspace_clear(ws)


# --- AC2: /unpause re-enters the launcher with the same job id ----------------


def test_relaunching_the_same_job_after_reset_records_again(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The fence is per launcher invocation, not per job id."""
    store = JobStore(tmp_path)
    ws = _ws()
    job, launch = _prepare(store, ws, "tune")
    gate = _Gate(store)
    _route(monkeypatch, "tune", "thread", gate)
    started = _capture_thread(monkeypatch)

    launch()
    assert gate.reached.wait(_WAIT)
    ws.reset()
    gate.release.set()
    _join(started[-1])
    _assert_workspace_clear(ws)

    # Second invocation, after the reset: it records normally.
    _route(monkeypatch, "tune", "thread", lambda j: _finish(store, j))
    launch()
    _join(started[-1])
    assert ws.current_job_id == job.job_id


# --- AC5: a launch after the reset is not fenced ------------------------------


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("kind", _KINDS)
def test_launch_after_reset_records_normally(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, kind: str, mode: str
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    ws.reset()
    ws.set_data(dataframe=object(), data_ref=_REF)  # type: ignore[arg-type]
    job, launch = _prepare(store, ws, kind)
    _route(monkeypatch, kind, mode, lambda j: _finish(store, j))
    started = _capture_thread(monkeypatch)

    launch()
    _join(started[-1])

    assert ws.current_job_id == job.job_id
    assert ws.workspace_fit_result == _FIT
    assert ws.previous_job_thread() is started[-1]


# --- AC8: a dropped write is logged ------------------------------------------


def test_dropped_write_is_logged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    store = JobStore(tmp_path)
    ws = _ws()
    job, launch = _prepare(store, ws, "fit")
    gate = _Gate(store)
    _route(monkeypatch, "fit", "thread", gate)
    started = _capture_thread(monkeypatch)

    with caplog.at_level("INFO", logger="lizystudio.services.workspace"):
        launch()
        assert gate.reached.wait(_WAIT)
        ws.reset()
        gate.release.set()
        _join(started[-1])

    dropped = [
        r for r in caplog.records if "workspace.stale_write_dropped" in r.getMessage()
    ]
    assert len(dropped) == 1
    message = dropped[0].getMessage()
    assert job.job_id in message
    assert "kind=record_completion" in message
    assert "launched_epoch=0 current_epoch=1" in message
