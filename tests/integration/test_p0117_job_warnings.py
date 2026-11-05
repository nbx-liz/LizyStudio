"""lizyml's H-0140 memory warning reaches the job (P-0117 D4).

The smallest real trigger: ``max_depth=-1`` with ``auto_num_leaves``
derives ``num_leaves=131072`` (lizyml ``_compute_num_leaves``), which is
over lizyml's ``LEAVES_THRESHOLD`` (16384) whatever the data size. With
60 rows, one feature, 2 folds and 3 rounds the run takes well under a
second and the estimate is about 0.2 GiB, so the warning fires without a
large allocation.

Each case runs Studio's own job path with the installed lizyml, in the
thread worker and the subprocess worker, and checks the four places the
warning must reach: ``execution.log``, ``job.warnings`` reloaded from
disk, ``GET /api/jobs/{id}`` and the job's warning broadcast.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from lizystudio.backends.lizyml.adapter import LizyMLAdapter
from lizystudio.backends.types import DataRef
from lizystudio.server import create_app
from lizystudio.services._job_warnings import install_job_warning_hooks
from lizystudio.services.data import load_dataframe
from lizystudio.services.jobs import Job, JobStore
from lizystudio.services.subprocess_runner import run_job_in_subprocess
from lizystudio.services.training import run_fit, run_tune

pytestmark = pytest.mark.integration

_FIXTURES = Path(__file__).resolve().parents[1] / "fixtures"
# A production config the UI wrote; only the data-specific fields change.
BASE_CONFIG = _FIXTURES / "lizyml" / "tune" / "config.json"
N_ROWS = 60
WARNING_PREFIX = "LightGBM will train with num_leaves=131072"
MEMORY_EVENT = "event='tune.trial.memory_warning'"
N_TRIALS = 3

Mode = Literal["thread", "subprocess"]


class RecordingBroadcaster:
    """Records every broadcast, by kind, in call order."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._lock = threading.Lock()

    def _record(self, kind: str, **kwargs: Any) -> None:
        with self._lock:
            self.calls.append((kind, kwargs))

    def send_progress(self, job_id: str, **kwargs: Any) -> None:
        self._record("progress", job_id=job_id)

    def send_completed(self, job_id: str, message: str = "Completed.") -> None:
        self._record("completed", job_id=job_id)

    def send_error(
        self, job_id: str, message: str, code: str = "BACKEND_ERROR"
    ) -> None:
        self._record("error", job_id=job_id, message=message, code=code)

    def send_paused(self, job_id: str, **kwargs: Any) -> None:
        self._record("paused", job_id=job_id)

    def send_warning(self, job_id: str, message: str) -> None:
        self._record("warning", job_id=job_id, message=message)

    def warnings(self) -> list[dict[str, Any]]:
        return [kw for kind, kw in self.calls if kind == "warning"]


def _config(*, max_depth: int | None, tune: bool) -> dict[str, Any]:
    config: dict[str, Any] = json.loads(BASE_CONFIG.read_text())
    config["data"]["target"] = "target"
    config["split"]["n_splits"] = 2
    config["features"]["exclude"] = []
    config["features"]["categorical"] = []
    config["features"]["auto_categorical"] = False
    assert config["model"]["auto_num_leaves"] is True
    if max_depth is not None:
        config["model"]["params"]["max_depth"] = max_depth
    config["model"]["params"]["n_estimators"] = 3
    config["training"]["early_stopping"]["rounds"] = 2
    config["evaluation"]["metrics"] = ["auc"]
    if tune:
        config["tuning"]["optuna"]["params"]["n_trials"] = N_TRIALS
        # learning_rate does not change num_leaves, so every trial qualifies.
        config["tuning"]["optuna"]["space"] = {
            "learning_rate": {"type": "float", "low": 0.01, "high": 0.2, "log": True}
        }
        config["tuning"]["evaluation"]["metrics"] = ["auc"]
    else:
        config.pop("tuning", None)
    return config


def _data(tmp_path: Path) -> Path:
    rng = np.random.default_rng(0)
    frame = pd.DataFrame(
        {"x": rng.normal(size=N_ROWS), "target": rng.integers(0, 2, size=N_ROWS)}
    )
    path = tmp_path / "train.parquet"
    frame.to_parquet(path)
    return path


def _run(
    store: JobStore,
    config: dict[str, Any],
    data: Path,
    *,
    mode: Mode,
    broadcaster: RecordingBroadcaster | None,
) -> Job:
    job_type: Literal["fit", "tune"] = "tune" if "tuning" in config else "fit"
    frame = load_dataframe(str(data))
    job = store.create(
        backend_name="lizyml",
        config=config,
        data_ref=DataRef(
            source_type="path",
            path=str(data),
            filename=data.name,
            fingerprint="p0117-d4",
            shape=frame.shape,
        ),
        job_type=job_type,
    )
    if mode == "subprocess":
        return run_job_in_subprocess(
            job=job,
            job_store=store,
            broadcaster=broadcaster,  # type: ignore[arg-type]
            backend_name="lizyml",
            data_path=str(data),
        )
    runner = run_tune if job_type == "tune" else run_fit
    return runner(
        job=job,
        job_store=store,
        backend=LizyMLAdapter(),
        config=config,
        dataframe=frame,
        broadcaster=broadcaster,  # type: ignore[arg-type]
    )


@pytest.fixture(autouse=True)
def _job_warning_hooks() -> None:
    """Install the hooks as process start does (server lifespan, child).

    pytest runs each test inside ``warnings.catch_warnings(record=True)``,
    whose exit restores ``warnings.showwarning``: the install is per test
    here, once per process in production. The subprocess child installs
    its own (``_child_main``), so the subprocess cases also pin that.
    """
    install_job_warning_hooks()


@pytest.fixture()
def jobs_dir(tmp_path: Path) -> Path:
    return tmp_path / "jobs"


@pytest.fixture()
def client(jobs_dir: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(jobs_dir))
    with TestClient(create_app()) as c:
        yield c


def _assert_no_local_path(text: str, tmp_path: Path) -> None:
    assert "/" + "home" not in text
    assert "site-packages" not in text
    assert ".py" not in text
    assert str(tmp_path) not in text


def _the_warning(warnings: list[str]) -> str:
    matching = [w for w in warnings if w.startswith(WARNING_PREFIX)]
    assert len(matching) == 1, warnings
    return matching[0]


# --- Fit ---------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["thread", "subprocess"])
def test_fit_memory_warning_reaches_log_job_api_and_broadcast(
    mode: Mode, tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    store = JobStore(jobs_dir)
    broadcaster = RecordingBroadcaster()

    done = _run(
        store,
        _config(max_depth=-1, tune=False),
        _data(tmp_path),
        mode=mode,
        broadcaster=broadcaster,
    )

    assert done.status == "completed", done.error
    reloaded = store.get(done.job_id)
    assert reloaded is not None
    text = _the_warning(reloaded.warnings)
    assert "derived by auto_num_leaves from max_depth=-1" in text
    assert reloaded.warnings == [text]
    _assert_no_local_path(text, tmp_path)
    # The path sanitizer leaves the real H-0140 text alone (no over-match).
    assert "<path>" not in text

    log = store.get_log(done.job_id)
    assert log.count(f"UserWarning: {text}") == 1
    # The hook consumed the warning: no default ``file:line: UserWarning``
    # print (which carries an absolute path) reached the log.
    assert "lifecycle_mixin.py" not in log

    body = client.get(f"/api/jobs/{done.job_id}").json()
    assert body["warnings"] == [text]

    sent = broadcaster.warnings()
    assert len(sent) == 1
    assert sent[0] == {"job_id": done.job_id, "message": text}


@pytest.mark.parametrize("tune", [False, True], ids=["fit", "tune"])
def test_a_second_identical_thread_job_in_one_process_carries_the_warning_too(
    tune: bool, tmp_path: Path, jobs_dir: Path
) -> None:
    """Both of two identical jobs in one process carry the warning.

    Python's ``default`` action shows a warning once per code location per
    process; the second job carries it because the lizyml fit path keeps
    clearing the warning registries (see ``services/_job_warnings.py``).
    This goes red if that stops, for the Fit's location
    (``lifecycle_mixin``) and the tune trial's (``lizyml.tuning.tuner``).

    Sequential is the only production case: a server's ``JobStore`` runs at
    most one training job at a time (``services/_job_active_slot.py``), so
    two identical warnings from two concurrent jobs cannot occur, and the
    registry cannot suppress one job's warning behind another's.
    """
    store = JobStore(jobs_dir)
    data = _data(tmp_path)
    config = _config(max_depth=-1, tune=tune)

    first = _run(store, config, data, mode="thread", broadcaster=None)
    second = _run(store, config, data, mode="thread", broadcaster=None)

    stored = []
    for done in (first, second):
        assert done.status == "completed", done.error
        reloaded = store.get(done.job_id)
        assert reloaded is not None
        stored.append(reloaded.warnings)
    assert stored[0] == stored[1]
    assert len(stored[1]) == (2 if tune else 1)
    assert all(w.startswith(WARNING_PREFIX) for w in stored[1])
    if tune:
        assert "the trees of 2 booster(s)" in stored[1][0]


# --- Tune --------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["thread", "subprocess"])
def test_tune_warns_once_and_logs_the_later_qualifying_trials(
    mode: Mode, tmp_path: Path, jobs_dir: Path
) -> None:
    store = JobStore(jobs_dir)
    broadcaster = RecordingBroadcaster()

    done = _run(
        store,
        _config(max_depth=-1, tune=True),
        _data(tmp_path),
        mode=mode,
        broadcaster=broadcaster,
    )

    assert done.status == "completed", done.error
    reloaded = store.get(done.job_id)
    assert reloaded is not None
    # Two distinct texts, each stored once: a trial counts its 2 fold
    # boosters, the auto-fit after the tune its 2 folds plus the refit.
    assert len(reloaded.warnings) == 2, reloaded.warnings
    trial_text, fit_text = reloaded.warnings
    assert "<path>" not in trial_text + fit_text
    assert trial_text.startswith(WARNING_PREFIX)
    assert "the trees of 2 booster(s)" in trial_text
    assert fit_text.startswith(WARNING_PREFIX)
    assert "the trees of 3 booster(s)" in fit_text

    log = store.get_log(done.job_id)
    # The first qualifying trial warns; it is not stored again by later
    # trials, which only log (lizyml's latch), each one in the job log.
    assert log.count(f"UserWarning: {trial_text}") == 1
    assert log.count(f"UserWarning: {fit_text}") == 1
    # Consumed, not also printed with the trial's location.
    assert "tuner.py" not in log
    assert "lifecycle_mixin.py" not in log
    assert log.count(MEMORY_EVENT) == N_TRIALS - 1
    assert log.count(
        f"lizyml.core.resource_warning INFO: {MEMORY_EVENT} {trial_text}"
    ) == (N_TRIALS - 1)
    assert [w["message"] for w in broadcaster.warnings()] == [trial_text, fit_text]


# --- Paths inside a warning's text -------------------------------------------


def test_a_trial_failure_path_reaches_no_surface(
    tmp_path: Path,
    jobs_dir: Path,
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A real Tune whose first trial fails with an absolute path in the
    exception: lizyml logs ``event='trial.failed' ... reason=<str(exc)>``
    at WARNING (``tuning/tuner.py``). The path must reach none of
    ``execution.log``, ``meta.json``, ``GET`` and the broadcast.

    Thread mode: the failure is injected with ``monkeypatch`` on
    ``lightgbm.train``, which the subprocess child would not see.
    """
    import lightgbm

    secret = str(tmp_path / "private" / "cache.bin")
    real_train = lightgbm.train
    calls = {"n": 0}

    def failing_once(*args: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            msg = f"cannot read {secret}"
            raise ValueError(msg)
        return real_train(*args, **kwargs)

    monkeypatch.setattr(lightgbm, "train", failing_once)
    store = JobStore(jobs_dir)
    broadcaster = RecordingBroadcaster()

    done = _run(
        store,
        _config(max_depth=None, tune=True),
        _data(tmp_path),
        mode="thread",
        broadcaster=broadcaster,
    )

    assert done.status == "completed", done.error
    reloaded = store.get(done.job_id)
    assert reloaded is not None
    failed = [w for w in reloaded.warnings if "event='trial.failed'" in w]
    assert failed == [
        "event='trial.failed' trial=0 state=FAIL reason=ValueError: cannot read <path>"
    ], reloaded.warnings
    log = store.get_log(done.job_id)
    assert f"lizyml.tuner WARNING: {failed[0]}" in log
    meta = store.path_for(done.job_id, "meta").read_text()
    body = client.get(f"/api/jobs/{done.job_id}").json()
    # ``meta.json`` and GET hold the job's own data and model paths by
    # design (``data_ref``, ``model_path``), so the tmp prefix is checked
    # on their ``warnings``; the injected path is checked everywhere.
    warning_surfaces = {
        "execution.log": log,
        "meta.json warnings": json.dumps(json.loads(meta)["warnings"]),
        "GET warnings": json.dumps(body["warnings"]),
        "broadcast": json.dumps(broadcaster.warnings()),
    }
    for name, text in warning_surfaces.items():
        assert str(tmp_path) not in text, name
    for name, text in {
        **warning_surfaces,
        "meta.json": meta,
        "GET": json.dumps(body),
    }.items():
        assert secret not in text, name
    assert failed[0] in [w["message"] for w in broadcaster.warnings()]


# --- No warning --------------------------------------------------------------


@pytest.mark.parametrize("mode", ["thread", "subprocess"])
def test_a_normal_fit_has_no_warnings_and_no_capture_noise(
    mode: Mode, tmp_path: Path, jobs_dir: Path, client: TestClient
) -> None:
    store = JobStore(jobs_dir)
    broadcaster = RecordingBroadcaster()

    done = _run(
        store,
        _config(max_depth=None, tune=False),
        _data(tmp_path),
        mode=mode,
        broadcaster=broadcaster,
    )

    assert done.status == "completed", done.error
    reloaded = store.get(done.job_id)
    assert reloaded is not None
    assert reloaded.warnings == []
    log = store.get_log(done.job_id)
    assert "UserWarning" not in log
    assert "lizyml." not in log
    assert client.get(f"/api/jobs/{done.job_id}").json()["warnings"] == []
    assert broadcaster.warnings() == []


# --- Concurrency (thread mode) -----------------------------------------------


def test_concurrent_thread_jobs_keep_their_own_warnings(tmp_path: Path) -> None:
    """Two jobs in two threads at once: the warning stays on its own job.

    Separate stores, because one store's active slot admits one job: a
    server has one store, so this overlap does not happen in production.
    It pins the per-thread routing, with different texts on purpose (two
    concurrent identical warnings are out of scope; see the sequential
    case above).
    """
    data = _data(tmp_path)
    stores = {
        "warn": JobStore(tmp_path / "jobs_warn"),
        "quiet": JobStore(tmp_path / "jobs_quiet"),
    }
    configs = {
        "warn": _config(max_depth=-1, tune=False),
        "quiet": _config(max_depth=None, tune=False),
    }
    broadcasters = {name: RecordingBroadcaster() for name in stores}
    results: dict[str, Job] = {}
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def work(name: str) -> None:
        try:
            barrier.wait(timeout=30)
            results[name] = _run(
                stores[name],
                configs[name],
                data,
                mode="thread",
                broadcaster=broadcasters[name],
            )
        except BaseException as exc:  # noqa: BLE001 - re-raised in the main thread
            errors.append(exc)

    threads = [threading.Thread(target=work, args=(name,)) for name in stores]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=120)
    assert not errors, errors

    warn_job = stores["warn"].get(results["warn"].job_id)
    quiet_job = stores["quiet"].get(results["quiet"].job_id)
    assert warn_job is not None
    assert quiet_job is not None
    assert warn_job.status == quiet_job.status == "completed"
    _the_warning(warn_job.warnings)
    assert quiet_job.warnings == []
    assert len(broadcasters["warn"].warnings()) == 1
    assert broadcasters["quiet"].warnings() == []
    assert "UserWarning" not in stores["quiet"].get_log(quiet_job.job_id)
