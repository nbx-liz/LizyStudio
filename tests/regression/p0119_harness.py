"""Shared harness for the P-0119 job-lifecycle regression tests.

The tests drive the real HTTP routes, launchers and ``_run_job_core`` with a
fake backend whose ``fit`` / ``tune`` stop at event barriers, so every
interleaving is ordered by events with timeouts, never by sleeps. The
recorders count what the acceptance criteria count: status transitions
written to ``meta.json``, terminal WebSocket frames, terminal metrics, slot
releases and worker starts (CLAUDE.md section 7: counts, not "was called").

Nothing here depends on the lifecycle primitive's own API, so the same
tests ran RED against develop (``4b19421`` + the Proposal) before it existed.
"""

from __future__ import annotations

import csv
import subprocess
import threading
import time
from collections import defaultdict
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.types import FitSummary, TuningSummary
from lizystudio.services._job_active_slot import ActiveJobSlot
from lizystudio.services._job_metadata import (
    Job,
    JobMetadataStore,
    read_job_json,
    write_job_json,
)
from lizystudio.services.jobs import JobStore

WAIT = 10.0
# A real child process must spawn, import and run before it reaches a gate;
# under CPU load that takes far longer than an in-process thread (#786).
CHILD_WAIT = 60.0
# One shared deadline per real-child test: every child-scale wait draws from
# it, so a persistently failing test ends in about this long, not per wait.
CHILD_TEST_BUDGET = 100.0
_REAP_WAIT = 15.0
TERMINAL = ("completed", "failed", "cancelled")


class Budget:
    """A shared deadline: each wait takes at most what is left of it."""

    def __init__(self, total: float = CHILD_TEST_BUDGET) -> None:
        self._deadline = time.monotonic() + total

    def left(self, cap: float = CHILD_WAIT) -> float:
        return max(1.0, min(cap, self._deadline - time.monotonic()))


class Gate:
    """A barrier: the actor calls :meth:`hold`; the test waits and releases."""

    def __init__(
        self, *, once: bool = True, timeout: float = WAIT, budget: Budget | None = None
    ) -> None:
        self.timeout = timeout
        self.budget = budget
        _GATES.append(self)
        self.reached = threading.Event()
        self.release = threading.Event()
        self._once = once
        self._lock = threading.Lock()
        self.calls = 0

    def hold(self) -> None:
        with self._lock:
            self.calls += 1
            first = self.calls == 1
        if self._once and not first:
            return
        self.reached.set()
        assert self.release.wait(self._wait()), "the test never released the gate"

    def _wait(self) -> float:
        if self.budget is None:
            return self.timeout
        return min(self.timeout, self.budget.left(self.timeout))

    def wait_reached(self) -> None:
        assert self.reached.wait(self._wait()), "the actor never reached the gate"

    def wrap(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        """*fn* with this gate held before the first call (later calls pass)."""

        def wrapped(*args: Any, **kwargs: Any) -> Any:
            self.hold()
            return fn(*args, **kwargs)

        return wrapped


class FakeTrainer:
    """Stands in for the backend's training methods (thread mode).

    ``tune`` and ``fit`` each count their invocation (one worker start), hold
    their gate when one is set, then call the progress callback
    ``cb_calls`` times; every callback that returns counts one trial. The
    callback is where the worker observes cancel, pause and (after P-0119) a
    revoked run token.
    """

    def __init__(self) -> None:
        self.tune_calls = 0
        self.fit_calls = 0
        self.trials = 0
        self.tune_gate: Gate | None = None
        self.fit_gate: Gate | None = None
        self.between_trials_gate: Gate | None = None
        self.tune_cb_calls = 1
        self.fit_cb_calls = 0
        self._lock = threading.Lock()

    def install(self, monkeypatch: pytest.MonkeyPatch, backend: Any) -> None:
        for name in ("create_model", "load_checkpoint"):
            monkeypatch.setattr(backend, name, lambda *a, **k: object())
        for name in (
            "preflight_checkpoint_dir",
            "verify_checkpoint_compatibility",
            "verify_study_continuable",
        ):
            monkeypatch.setattr(backend, name, lambda *a, **k: None)
        monkeypatch.setattr(backend, "export_model", self._export)
        monkeypatch.setattr(backend, "plot", self._plot)
        monkeypatch.setattr(backend, "tune", self.tune)
        monkeypatch.setattr(backend, "fit", self.fit)

    @staticmethod
    def _export(_model: Any, path: str) -> str:
        Path(path).mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _plot(*_a: Any, **_k: Any) -> Any:
        raise RuntimeError("no plot in the fake trainer")

    def _trial(self, cb: Any, i: int, total: int) -> None:
        cb(current=i, total=total, message="trial")
        with self._lock:
            self.trials += 1

    def tune(self, _model: Any, *, on_progress: Any, **_kw: Any) -> TuningSummary:
        with self._lock:
            self.tune_calls += 1
        if self.tune_gate is not None:
            self.tune_gate.hold()
        for i in range(self.tune_cb_calls):
            if i == 1 and self.between_trials_gate is not None:
                self.between_trials_gate.hold()
            self._trial(on_progress, i, self.tune_cb_calls)
        return TuningSummary(
            best_params={},
            best_score=0.5,
            trials=[],
            metric_name="auc",
            direction="maximize",
        )

    def fit(
        self, _model: Any, *, params: Any = None, on_progress: Any = None
    ) -> FitSummary:
        with self._lock:
            self.fit_calls += 1
        if self.fit_gate is not None:
            self.fit_gate.hold()
        for i in range(self.fit_cb_calls):
            self._trial(on_progress, i, self.fit_cb_calls)
        return FitSummary(metrics={}, fold_count=1, params=[])

    @property
    def worker_starts(self) -> int:
        """Worker runs that reached the backend: a tune, or a fit-only job."""
        return self.tune_calls if self.tune_calls else self.fit_calls


class Recorder:
    """Counts status publications, terminal frames, metrics and slot releases."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._last: dict[str, str] = {}
        self.transitions: dict[str, list[str]] = defaultdict(list)
        # Every status publication (Codex r1-5): one entry per write through
        # the primitive's status writer, duplicates included.
        self.publications: dict[str, list[str]] = defaultdict(list)
        # The status-writer census (P-0119 PR-B): a ``meta.json`` save that
        # changes the stored status outside the primitive's status writer.
        self.census_violations: list[tuple[str, str, str]] = []
        self._publishing = threading.local()
        self.frames: dict[str, list[str]] = defaultdict(list)
        self.slot_releases = 0

    def install(
        self, monkeypatch: pytest.MonkeyPatch, broadcaster: Any, slot: Any = None
    ) -> None:
        """Spy on the writes; slot releases are counted for *slot* only (the
        app under test), so a stray worker of an earlier test cannot add one."""
        original_save = JobMetadataStore.save_meta
        recorder = self

        def save_meta(store: JobMetadataStore, job: Job) -> None:
            recorder._census(store, job)
            original_save(store, job)
            recorder._note_status(job.job_id, job.status)

        monkeypatch.setattr(JobMetadataStore, "save_meta", save_meta)
        original_publish = JobMetadataStore.write_status_locked

        def write_status_locked(
            store: JobMetadataStore, job_id: str, status: str, **kwargs: Any
        ) -> None:
            recorder._publishing.active = True
            try:
                original_publish(store, job_id, status, **kwargs)
            finally:
                recorder._publishing.active = False
            with recorder._lock:
                recorder.publications[job_id].append(status)

        monkeypatch.setattr(
            JobMetadataStore, "write_status_locked", write_status_locked
        )
        original_gauge = ActiveJobSlot._set_gauge

        def set_gauge(target: ActiveJobSlot, value: float) -> None:
            if value == 0 and (slot is None or target is slot):
                with recorder._lock:
                    recorder.slot_releases += 1
            original_gauge(target, value)

        monkeypatch.setattr(ActiveJobSlot, "_set_gauge", set_gauge)
        if broadcaster is not None:
            self._spy_frames(monkeypatch, broadcaster)

    def _census(self, store: JobMetadataStore, job: Job) -> None:
        if getattr(self._publishing, "active", False):
            return
        path = store.path_for(job.job_id, "meta")
        if not path.exists():
            return  # ``create``: the first row of a new job
        stored = read_job_json(path)["status"]
        if stored != job.status:
            with self._lock:
                self.census_violations.append((job.job_id, stored, job.status))

    def _note_status(self, job_id: str, status: str) -> None:
        with self._lock:
            if self._last.get(job_id) != status:
                self._last[job_id] = status
                self.transitions[job_id].append(status)

    def _spy_frames(self, monkeypatch: pytest.MonkeyPatch, broadcaster: Any) -> None:
        def spy(kind: str, original: Callable[..., Any]) -> Callable[..., Any]:
            def wrapped(job_id: str, *args: Any, **kwargs: Any) -> Any:
                code = kwargs.get("code") or (args[1] if len(args) > 1 else "")
                label = f"{kind}:{code or 'default'}" if kind == "error" else kind
                with self._lock:
                    self.frames[job_id].append(label)
                return original(job_id, *args, **kwargs)

            return wrapped

        for kind in ("completed", "error", "paused"):
            name = f"send_{kind}"
            monkeypatch.setattr(
                broadcaster, name, spy(kind, getattr(broadcaster, name))
            )

    def writes_of(self, job_id: str, status: str) -> int:
        """How many times *status* was published for *job_id* (duplicates
        count: an exactly-once assertion fails on a second publication)."""
        with self._lock:
            return self.publications[job_id].count(status)

    def terminal_frames(self, job_id: str) -> list[str]:
        with self._lock:
            return [f for f in self.frames[job_id] if f != "paused"]


def metric(client: TestClient, job_type: str, status: str) -> float:
    registry = client.app.state.metrics  # type: ignore[attr-defined]
    value = registry.jobs_total.labels(job_type=job_type, status=status)._value
    return float(value.get())


def seed_workspace(client: TestClient, tmp_path: Path) -> dict[str, Any]:
    """Load a small CSV and the default binary config; return the config."""
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "age", "target"])
        for i in range(60):
            writer.writerow([i, 20 + i, i % 2])
    r = client.post("/api/workspace/data/path", json={"path": str(csv_path)})
    assert r.status_code == 200, r.text
    r = client.get("/api/workspace/config/defaults?task=binary&target=target")
    assert r.status_code == 200, r.text
    config: dict[str, Any] = r.json()
    r = client.put("/api/workspace/config", json=config)
    assert r.status_code == 200, r.text
    return config


def app_parts(client: TestClient) -> tuple[Any, JobStore, Any]:
    """(workspace, job store, broadcaster) of the running app."""
    state = client.app.state  # type: ignore[attr-defined]
    return state.workspace, state.job_store, state.broadcaster


def join_worker(client: TestClient, timeout: float = WAIT) -> None:
    """Join the latest registered worker thread, with a timeout."""
    ws, _, _ = app_parts(client)
    thread = ws.previous_job_thread()
    if thread is not None:
        thread.join(timeout)
        assert not thread.is_alive(), "the worker thread did not finish"


class Call:
    """An HTTP call made from a background thread, so the test can hold it."""

    def __init__(self, fn: Callable[[], Any]) -> None:
        self.response: Any = None
        self.error: BaseException | None = None
        self._thread = threading.Thread(target=self._run, args=(fn,), daemon=True)
        self._thread.start()

    def _run(self, fn: Callable[[], Any]) -> None:
        try:
            self.response = fn()
        except BaseException as exc:  # noqa: BLE001 — re-raised by result()
            self.error = exc

    def finished_within(self, seconds: float) -> bool:
        """True when the call returned within *seconds* (a bounded join)."""
        self._thread.join(seconds)
        return not self._thread.is_alive()

    def result(self) -> Any:
        self._thread.join(WAIT * 3)
        assert not self._thread.is_alive(), "the background call did not return"
        if self.error is not None:
            raise self.error
        return self.response


def seed_persisted_job(
    store: JobStore,
    *,
    job_type: str,
    status: str,
    config: dict[str, Any] | None = None,
    data_ref: Any = None,
) -> Job:
    """Write a job row straight to ``meta.json`` (persisted state, no run).

    Models a row a previous run left on disk; it bypasses every runtime
    writer on purpose, so it works the same before and after P-0119.
    """
    job = store.create(
        backend_name="lizyml",
        config=config or {},
        data_ref=data_ref,
        job_type=job_type,  # type: ignore[arg-type]
    )
    meta = store.path_for(job.job_id, "meta")
    from lizystudio.services._job_metadata import read_job_json

    payload = read_job_json(meta)
    payload["status"] = status
    write_job_json(meta, payload)
    job.status = status  # type: ignore[assignment]
    return job


def touch_flag(store: JobStore, job_id: str, kind: str) -> None:
    """Create the on-disk CANCEL / PAUSE flag of a persisted job."""
    store.path_for(job_id, kind).write_bytes(b"")  # type: ignore[arg-type]


@contextmanager
def short_reset_wait(monkeypatch: pytest.MonkeyPatch, seconds: float) -> Iterator[None]:
    """Shrink reset's slot-release wait so force-release tests run fast."""
    from lizystudio.api import workspace as ws_api

    monkeypatch.setattr(ws_api, "_RESET_WAIT_TIMEOUT", seconds)
    yield


class Env:
    """One running app with the fake trainer and the recorders installed."""

    def __init__(
        self, client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self.client = client
        self.tmp_path = tmp_path
        self.monkeypatch = monkeypatch
        self.ws, self.store, self.broadcaster = app_parts(client)
        self.trainer = FakeTrainer()
        self.trainer.install(monkeypatch, self.ws.backend)
        self.rec = Recorder()
        self.rec.install(monkeypatch, self.broadcaster, self.store._slot)
        self.config = seed_workspace(client, tmp_path)

    def reseed(self) -> None:
        """Reload the workspace data and config (after a reset cleared them)."""
        self.config = seed_workspace(self.client, self.tmp_path)

    def post(self, url: str, **kwargs: Any) -> Any:
        return self.client.post(url, **kwargs)

    def status(self, job_id: str) -> str:
        job = self.store.get(job_id)
        assert job is not None
        return job.status

    def start_paused_tune(self) -> str:
        """Run a tune through ``POST /tune`` and pause it at its first callback."""
        gate = Gate()
        self.trainer.tune_gate = gate
        r = self.post("/api/workspace/tune")
        assert r.status_code == 200, r.text
        job_id: str = r.json()["job_id"]
        gate.wait_reached()
        r = self.post(f"/api/jobs/{job_id}/pause")
        assert r.status_code == 200, r.text
        gate.release.set()
        join_worker(self.client)
        assert self.status(job_id) == "paused"
        assert self.store.active_job_id == job_id
        self.trainer.tune_gate = None
        return job_id

    def reset(self) -> Any:
        r = self.post("/api/workspace/reset")
        assert r.status_code == 200, r.text
        return r


_GATES: list[Gate] = []
_POOL_THREAD_PREFIXES = ("AnyIO", "asyncio-portal", "ThreadPoolExecutor")


def release_gates(since: int = 0) -> None:
    """Release every gate created after index *since* (teardown, any outcome)."""
    for gate in _GATES[since:]:
        gate.release.set()


def live_job_threads(baseline: set[threading.Thread]) -> list[threading.Thread]:
    """Worker threads started since *baseline*, still alive. Idle pool threads
    of the test client (AnyIO, the asyncio portal) are not workers."""
    return [
        t
        for t in threading.enumerate()
        if t not in baseline
        and t.is_alive()
        and not t.name.startswith(_POOL_THREAD_PREFIXES)
    ]


def reap(
    *,
    gate_mark: int,
    baseline: set[threading.Thread],
    children: Sequence[subprocess.Popen[bytes]] = (),
) -> tuple[int, int]:
    """Teardown for any exit path: release held gates, stop and reap child
    processes, join worker threads (bounded). Returns the counts still alive
    as ``(processes, threads)``."""
    release_gates(gate_mark)
    for proc in children:
        if proc.poll() is None:
            proc.terminate()
    for proc in children:
        try:
            proc.wait(5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(5)
    deadline = time.monotonic() + _REAP_WAIT
    for thread in live_job_threads(baseline):
        thread.join(max(0.1, deadline - time.monotonic()))
    return (
        sum(proc.poll() is None for proc in children),
        len(live_job_threads(baseline)),
    )


@pytest.fixture()
def env(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Env]:
    gate_mark, baseline = len(_GATES), set(threading.enumerate())
    try:
        yield Env(client, tmp_path, monkeypatch)
    finally:
        reap(gate_mark=gate_mark, baseline=baseline)
