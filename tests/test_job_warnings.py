"""Job warnings: capture, isolation, persistence and transport (P-0117 D4).

The real H-0140 path is covered by
``tests/integration/test_p0117_job_warnings.py``; these cases pin the
mechanism with controlled inputs: the per-thread dispatch, the dedupe and
the cap, the ``meta.json`` field, the WebSocket message and the subprocess
JSONL hop.
"""

from __future__ import annotations

import contextlib
import json
import logging
import shutil
import threading
import warnings
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services import _job_warnings
from lizystudio.services._job_warnings import (
    MAX_JOB_WARNINGS,
    MAX_WARNING_CHARS,
    PATH_PLACEHOLDER,
    JobWarningCollector,
    capture_job_warnings,
    install_job_warning_hooks,
    sanitize_warning_text,
)
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit

_FIXTURES = Path(__file__).resolve().parent / "fixtures"
MEMORY_TEMPLATE = "event='tune.trial.memory_warning' %s"


@pytest.fixture(autouse=True)
def _job_warning_hooks() -> None:
    """Install the hooks as process start does (server lifespan, child).

    pytest runs each test inside ``warnings.catch_warnings(record=True)``,
    whose exit restores ``warnings.showwarning``: the install is per test
    here, once per process in production.
    """
    install_job_warning_hooks()


def _job(store: JobStore) -> Job:
    return store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="x.parquet",
            filename="x.parquet",
            fingerprint="f",
            shape=(1, 1),
        ),
        job_type="fit",
    )


def _collector(
    store: JobStore, job: Job, broadcaster: Any = None
) -> tuple[JobWarningCollector, list[str]]:
    lines: list[str] = []

    class _ListHandler(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            lines.append(record.getMessage())

    job_logger = logging.getLogger(f"lizystudio.training.{job.job_id}")
    job_logger.setLevel(logging.DEBUG)
    job_logger.addHandler(_ListHandler())
    return (
        JobWarningCollector(
            job=job, job_store=store, broadcaster=broadcaster, job_logger=job_logger
        ),
        lines,
    )


# --- Collector: dedupe, cap, persistence, broadcast ----------------------------


def test_identical_warnings_are_stored_once_and_logged_every_time(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    broadcaster = MagicMock()
    collector, lines = _collector(store, job, broadcaster)

    for _ in range(3):
        collector.record_warning("memory is tight", "UserWarning")

    assert job.warnings == ["memory is tight"]
    assert lines.count("UserWarning: memory is tight") == 3
    broadcaster.send_warning.assert_called_once_with(job.job_id, "memory is tight")
    reloaded = store.get(job.job_id)
    assert reloaded is not None
    assert reloaded.warnings == ["memory is tight"]


def test_stored_warnings_are_capped_and_the_cap_is_logged_once(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    broadcaster = MagicMock()
    collector, lines = _collector(store, job, broadcaster)

    for i in range(MAX_JOB_WARNINGS + 5):
        collector.record_warning(f"w{i}", "UserWarning")

    assert job.warnings == [f"w{i}" for i in range(MAX_JOB_WARNINGS)]
    assert broadcaster.send_warning.call_count == MAX_JOB_WARNINGS
    cap_lines = [line for line in lines if "not stored" in line]
    assert len(cap_lines) == 1
    # Every occurrence is still in the log, beyond the cap too.
    assert sum(1 for line in lines if line.startswith("UserWarning: w")) == (
        MAX_JOB_WARNINGS + 5
    )


def test_a_long_warning_is_truncated_before_it_is_stored(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)

    collector.record_warning("x" * (MAX_WARNING_CHARS * 2), "UserWarning")

    assert len(job.warnings) == 1
    assert len(job.warnings[0]) <= MAX_WARNING_CHARS
    assert job.warnings[0].endswith("...")


def test_a_resumed_job_does_not_store_or_send_its_warning_again(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    job.warnings = ["seen before"]
    broadcaster = MagicMock()
    collector, _ = _collector(store, job, broadcaster)

    collector.record_warning("seen before", "UserWarning")

    assert job.warnings == ["seen before"]
    broadcaster.send_warning.assert_not_called()


def test_a_failed_meta_write_is_logged_and_does_not_raise(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)
    store.update = MagicMock(side_effect=OSError("disk full"))  # type: ignore[method-assign]

    with caplog.at_level(logging.WARNING, logger="lizystudio.services._job_warnings"):
        collector.record_warning("still kept", "UserWarning")

    assert job.warnings == ["still kept"]
    assert any("Failed to persist job warnings" in r.message for r in caplog.records)


# --- Capture: warnings.warn and lizyml log records -----------------------------


def test_user_warning_in_the_job_thread_is_captured_without_its_location(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, lines = _collector(store, job)

    with capture_job_warnings(collector):
        warnings.warn("be careful", UserWarning, stacklevel=1)

    assert job.warnings == ["be careful"]
    assert lines == ["UserWarning: be careful"]


class _SentinelHook:
    """A ``showwarning`` another party installed before Studio's."""

    def __init__(self) -> None:
        self.messages: list[str] = []

    def __call__(
        self,
        message: Warning | str,
        category: type[Warning],
        filename: str,
        lineno: int,
        file: Any = None,
        line: str | None = None,
    ) -> None:
        self.messages.append(str(message))


def _fresh_install(monkeypatch: pytest.MonkeyPatch) -> _SentinelHook:
    """A fresh registry chained to a sentinel hook, as at process start."""
    monkeypatch.setattr(_job_warnings, "_registry", _job_warnings._CaptureRegistry())
    sentinel = _SentinelHook()
    warnings.showwarning = sentinel
    install_job_warning_hooks()
    return sentinel


def test_non_user_warnings_pass_through_to_the_previous_hook(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    sentinel = _fresh_install(monkeypatch)
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)

    with warnings.catch_warnings():
        warnings.simplefilter("always")
        with capture_job_warnings(collector):
            warnings.warn("old api", DeprecationWarning, stacklevel=1)
        warnings.warn("not in a job", UserWarning, stacklevel=1)

    assert job.warnings == []
    assert sentinel.messages == ["old api", "not in a job"]


def test_install_is_idempotent_and_chains_to_the_hook_it_replaced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sentinel = _fresh_install(monkeypatch)
    dispatcher = warnings.showwarning
    lizyml_logger = logging.getLogger("lizyml")
    handlers = list(lizyml_logger.handlers)

    install_job_warning_hooks()
    install_job_warning_hooks()

    assert warnings.showwarning is dispatcher
    assert dispatcher is not sentinel
    assert lizyml_logger.handlers == handlers
    assert (
        sum(
            isinstance(h, _job_warnings._LizymlRecordHandler)
            for h in lizyml_logger.handlers
        )
        == 1
    )
    assert (
        logging.getLogger("lizyml.core.resource_warning").getEffectiveLevel()
        <= logging.INFO
    )
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        warnings.warn("chained once", UserWarning, stacklevel=1)
    # Not recursed into itself, not dropped: the sentinel sees it once.
    assert sentinel.messages == ["chained once"]


def test_capture_never_touches_the_process_hook_or_the_logger_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _fresh_install(monkeypatch)
    store = JobStore(tmp_path / "jobs")
    collector, _ = _collector(store, _job(store))
    hook = warnings.showwarning
    lizyml_logger = logging.getLogger("lizyml")
    handlers = list(lizyml_logger.handlers)
    resource_logger = logging.getLogger("lizyml.core.resource_warning")
    level = resource_logger.level

    with capture_job_warnings(collector):
        assert warnings.showwarning is hook
        assert lizyml_logger.handlers == handlers

    # Installed once: the dispatcher and the handler stay after the job.
    assert warnings.showwarning is hook
    assert lizyml_logger.handlers == handlers
    assert resource_logger.level == level


def test_a_capture_without_installed_hooks_is_logged_once(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """DC1: a process that never installed the hooks says so, once."""
    monkeypatch.setattr(_job_warnings, "_registry", _job_warnings._CaptureRegistry())
    store = JobStore(tmp_path / "jobs")

    with caplog.at_level(logging.WARNING, logger="lizystudio.services._job_warnings"):
        for _ in range(2):
            collector, _ = _collector(store, _job(store))
            with capture_job_warnings(collector):
                pass

    not_installed = [r for r in caplog.records if "not installed" in r.message]
    assert len(not_installed) == 1


# The three orders of a job capture and another thread's real recorder.
# Each step is (actor, action); the threads take turns in this order.
_RECORDER_ORDERS: dict[str, tuple[list[tuple[str, str]], list[str]]] = {
    "recorder-inside-job": (
        [
            ("job", "enter"),
            ("job", "warn:before the window"),
            ("rec", "enter"),
            ("job", "warn:in the window"),
            ("rec", "exit"),
            ("job", "warn:after the window"),
            ("job", "exit"),
        ],
        ["before the window", "after the window"],
    ),
    "recorder-straddles-job-start": (
        [
            ("rec", "enter"),
            ("job", "enter"),
            ("job", "warn:in the window"),
            ("rec", "exit"),
            ("job", "warn:after the window"),
            ("job", "exit"),
        ],
        ["after the window"],
    ),
    "recorder-straddles-job-end": (
        [
            ("job", "enter"),
            ("job", "warn:before the window"),
            ("rec", "enter"),
            ("job", "warn:in the window"),
            ("job", "exit"),
            ("rec", "exit"),
        ],
        ["before the window"],
    ),
}


@pytest.mark.parametrize("order", list(_RECORDER_ORDERS))
def test_a_third_party_recorder_during_a_job_leaves_the_dispatcher_installed(
    order: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Finding 1: a real ``catch_warnings(record=True)`` on another thread,
    overlapping a job's capture, does not uninstall the dispatcher.

    The threads take turns in the given order (a condition variable). A
    warning the job raises while the recorder is active goes to the
    recorder: Python 3.12's warnings state is process-global (the
    documented residual). Every warning the job raises outside that window
    is captured, and after both leave the dispatcher is still installed
    and still chains to the hook it replaced.
    """
    steps, expected = _RECORDER_ORDERS[order]
    sentinel = _fresh_install(monkeypatch)
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)
    turn = threading.Condition()
    state = {"next": 0}
    recorded: list[str] = []
    errors: list[BaseException] = []

    def run(actor: str) -> None:
        stack = contextlib.ExitStack()
        log: list[warnings.WarningMessage] = []
        try:
            for index, (who, action) in enumerate(steps):
                if who != actor:
                    continue
                with turn:
                    assert turn.wait_for(lambda i=index: state["next"] == i, 10)
                if action == "enter" and actor == "job":
                    stack.enter_context(capture_job_warnings(collector))
                elif action == "enter":
                    log = stack.enter_context(warnings.catch_warnings(record=True))
                    warnings.simplefilter("always")
                elif action == "exit":
                    stack.close()
                else:
                    warnings.warn(action.removeprefix("warn:"), UserWarning, 1)
                with turn:
                    state["next"] = index + 1
                    turn.notify_all()
            recorded.extend(str(w.message) for w in log)
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            errors.append(exc)
            with turn:
                state["next"] = len(steps)
                turn.notify_all()
        finally:
            stack.close()

    threads = [threading.Thread(target=run, args=(a,)) for a in ("job", "rec")]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert not errors, errors
    assert warnings.showwarning is _job_warnings._showwarning
    assert job.warnings == expected
    assert recorded == ["in the window"]
    # The original chain still works for a thread that runs no job.
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        warnings.warn("server thread", UserWarning, stacklevel=1)
    assert sentinel.messages == ["server thread"]


class _LastResortSpy(logging.Handler):
    """Stands in for ``logging.lastResort`` (level WARNING, like the real one)."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@contextlib.contextmanager
def _bare_lizyml_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[tuple[_LastResortSpy, logging.Logger]]:
    """No handler on the ``lizyml.x`` chain but ours, and ``lastResort``
    replaced by a spy; handler lists and ``propagate`` restored on exit.

    Entered in the test body: pytest adds its root capture handlers at the
    start of the call phase, after fixtures run.
    """
    spy = _LastResortSpy()
    monkeypatch.setattr(logging, "lastResort", spy)
    chain = [
        logging.getLogger(),
        logging.getLogger("lizyml"),
        logging.getLogger("lizyml.x"),
    ]
    saved = [(lg, list(lg.handlers), lg.propagate) for lg in chain]
    for lg in chain:
        lg.handlers = [h for h in lg.handlers if h is _job_warnings._HANDLER]
        lg.propagate = True
    assert logging.getLogger("lizyml").handlers == [_job_warnings._HANDLER]
    try:
        yield spy, logging.getLogger("lizyml.x")
    finally:
        for lg, handlers, propagate in saved:
            lg.handlers = handlers
            lg.propagate = propagate


class _ListHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


def _log_on_another_thread(logger: logging.Logger, text: str) -> None:
    t = threading.Thread(target=lambda: logger.warning("%s", text))
    t.start()
    t.join(timeout=10)


def test_an_unhandled_lizyml_warning_off_a_job_still_reaches_last_resort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Round 2: our handler on ``lizyml`` makes ``callHandlers`` count one
    handler, which would skip ``lastResort``; the handler reproduces the
    fallback for a thread that runs no job."""
    with _bare_lizyml_chain(monkeypatch) as (spy, emitter):
        _log_on_another_thread(emitter, "nobody else listens")
        emitter.info("below lastResort's level")

    assert spy.messages == ["nobody else listens"]


@pytest.mark.parametrize("where", ["root", "lizyml.x"])
def test_last_resort_is_not_used_when_another_handler_exists(
    where: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    other = _ListHandler()
    with _bare_lizyml_chain(monkeypatch) as (spy, emitter):
        target = logging.getLogger() if where == "root" else emitter
        target.addHandler(other)
        _log_on_another_thread(emitter, "someone listens")

    assert spy.messages == []
    assert other.messages == ["someone listens"]


def test_the_walk_stops_where_propagate_is_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """As ``callHandlers`` does: with ``lizyml`` not propagating, a root
    handler is never reached and does not count, so the fallback runs."""
    root_handler = _ListHandler()
    with _bare_lizyml_chain(monkeypatch) as (spy, emitter):
        logging.getLogger("lizyml").propagate = False
        logging.getLogger().addHandler(root_handler)
        _log_on_another_thread(emitter, "stops at lizyml")

    assert root_handler.messages == []
    assert spy.messages == ["stops at lizyml"]


def test_a_job_thread_record_does_not_reach_last_resort(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A job thread's record keeps today's behaviour: captured, and not
    also printed by the fallback."""
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)

    with (
        _bare_lizyml_chain(monkeypatch) as (spy, emitter),
        capture_job_warnings(collector),
    ):
        emitter.warning("the job's own")

    assert job.warnings == ["the job's own"]
    assert spy.messages == []


def test_a_lizyml_record_from_an_unregistered_thread_passes_through_untouched(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)
    seen: list[tuple[str, Any, int]] = []

    class _Spy(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            seen.append((record.getMessage(), record.args, record.levelno))

    spy = _Spy()
    lizyml_model = logging.getLogger("lizyml.model")
    lizyml_model.addHandler(spy)
    try:
        with capture_job_warnings(collector):
            outside = threading.Thread(
                target=lambda: lizyml_model.warning("from %s", "/srv/api/thread")
            )
            outside.start()
            outside.join(timeout=10)
    finally:
        lizyml_model.removeHandler(spy)

    assert seen == [("from /srv/api/thread", ("/srv/api/thread",), logging.WARNING)]
    assert job.warnings == []


def test_the_server_lifespan_installs_the_dispatcher(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DC4: production reaches the installer (``server.py`` lifespan)."""
    from fastapi.testclient import TestClient

    from lizystudio.server import create_app

    monkeypatch.setattr(_job_warnings, "_registry", _job_warnings._CaptureRegistry())
    warnings.showwarning = _SentinelHook()
    monkeypatch.setenv("LIZYSTUDIO_JOBS_DIR", str(tmp_path / "jobs"))

    with TestClient(create_app()):
        assert warnings.showwarning is _job_warnings._showwarning


def test_capture_leaves_the_warning_filters_unchanged(tmp_path: Path) -> None:
    """No process-wide filter side effect (an ``always`` filter was measured
    as not needed; see the module docstring)."""
    from lizystudio.server import _install_upstream_warning_filters

    store = JobStore(tmp_path / "jobs")
    with warnings.catch_warnings():
        _install_upstream_warning_filters()
        before = list(warnings.filters)
        for _ in range(2):
            collector, _ = _collector(store, _job(store))
            with capture_job_warnings(collector):
                assert warnings.filters == before
        assert warnings.filters == before


def test_an_ignored_shap_warning_is_not_captured(tmp_path: Path) -> None:
    from lizystudio.server import _install_upstream_warning_filters

    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)
    with warnings.catch_warnings():
        _install_upstream_warning_filters()
        with capture_job_warnings(collector):
            warnings.warn(
                "LightGBM binary classifier with TreeExplainer shap values output "
                "has changed to a list of ndarray",
                UserWarning,
                stacklevel=1,
            )
    assert job.warnings == []


def test_lizyml_records_are_captured_by_level_and_event(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, lines = _collector(store, job)
    resource = logging.getLogger("lizyml.core.resource_warning")
    other = logging.getLogger("lizyml.model")

    with capture_job_warnings(collector):
        other.info("event='fit.start' run_id=1")
        resource.info("event='tune.trial.memory_warning' %s", "big leaves")
        other.warning("a lizyml warning")

    assert lines == [
        "lizyml.core.resource_warning INFO: "
        "event='tune.trial.memory_warning' big leaves",
        "lizyml.model WARNING: a lizyml warning",
    ]
    # The latched trial record is log-only; a lizyml WARNING is a job warning.
    assert job.warnings == ["a lizyml warning"]


@pytest.mark.parametrize(
    ("logger_name", "level", "msg", "args"),
    [
        # Another lizyml logger quoting the event text at INFO.
        ("lizyml.model", logging.INFO, MEMORY_TEMPLATE, ("big leaves",)),
        # The resource logger at DEBUG with the exact template.
        (
            "lizyml.core.resource_warning",
            logging.DEBUG,
            MEMORY_TEMPLATE,
            ("big leaves",),
        ),
        # The resource logger at INFO, pre-formatted (not the template).
        (
            "lizyml.core.resource_warning",
            logging.INFO,
            "event='tune.trial.memory_warning' big leaves",
            (),
        ),
        # The resource logger at INFO, quoting the event inside other text.
        (
            "lizyml.core.resource_warning",
            logging.INFO,
            "note: " + MEMORY_TEMPLATE,
            ("big leaves",),
        ),
    ],
    ids=["other-logger-info", "resource-debug", "preformatted", "embedded"],
)
def test_only_the_exact_resource_info_event_is_captured_below_warning(
    tmp_path: Path, logger_name: str, level: int, msg: str, args: tuple[Any, ...]
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, lines = _collector(store, job)
    emitter = logging.getLogger(logger_name)
    saved_level = emitter.level
    emitter.setLevel(logging.DEBUG)
    try:
        with capture_job_warnings(collector):
            emitter.log(level, msg, *args)
    finally:
        emitter.setLevel(saved_level)

    assert lines == []
    assert job.warnings == []


# --- Paths inside message text --------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "clean"),
    [
        ("cannot open /tmp/pytest-1/x.parquet now", "cannot open <path> now"),
        ("reason=ValueError: '/home/u/My Data/x.csv'", "reason=ValueError: '<path>'"),
        ('path="/srv/data/a b.csv"', 'path="<path>"'),
        ("path=/srv/data/x.csv", "path=<path>"),
        ("see (/opt/lib/a.py)", "see (<path>"),
        (r"C:\Users\u\x.csv missing", "<path> missing"),
        ("D:/data/x.csv missing", "<path> missing"),
        ("at file:///home/u/x.py line 3", "at <path> line 3"),
        ("at FILE://host/share/x.py", "at <path>"),
        (r"\\server\share\x.csv gone", "<path> gone"),
        ("/abs/at/start", "<path>"),
        # Right after a colon (round 2): a colon is not a URL by itself.
        ("cannot read:/srv/x", "cannot read:<path>"),
        ("reason=ValueError:/tmp/a/b", "reason=ValueError:<path>"),
        ("path:/a", "path:<path>"),
    ],
)
def test_sanitize_replaces_absolute_paths_with_a_placeholder(
    raw: str, clean: str
) -> None:
    assert PATH_PLACEHOLDER == "<path>"
    assert sanitize_warning_text(raw) == clean


@pytest.mark.parametrize(
    "text",
    [
        "and/or",
        "1/2 of the rows",
        "n/a",
        "application/json",
        "see https://example.com/docs/x for details",
        "http://host/x",
        "a / b",
        "ratio 3/4, max_depth=-1",
        "LightGBM will train with num_leaves=131072 (derived by auto_num_leaves "
        "from max_depth=-1). about 0.2 GiB",
        "",
    ],
)
def test_sanitize_leaves_text_without_an_absolute_path_unchanged(text: str) -> None:
    assert sanitize_warning_text(text) == text


def test_the_collector_sanitizes_before_log_store_and_broadcast(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    broadcaster = MagicMock()
    collector, lines = _collector(store, job, broadcaster)
    secret = str(tmp_path / "data" / "train.parquet")

    with capture_job_warnings(collector):
        warnings.warn(f"cannot read {secret}", UserWarning, stacklevel=1)
        logging.getLogger("lizyml.tuner").warning(
            "event='trial.failed' trial=%d state=%s reason=%s",
            0,
            "FAIL",
            f"ValueError: no such file: '{secret}'",
        )

    expected = [
        "cannot read <path>",
        "event='trial.failed' trial=0 state=FAIL reason=ValueError: "
        "no such file: '<path>'",
    ]
    assert job.warnings == expected
    assert str(tmp_path) not in "\n".join(lines)
    assert [c.args[1] for c in broadcaster.send_warning.call_args_list] == expected
    assert str(tmp_path) not in store.path_for(job.job_id, "meta").read_text()


def test_the_collector_sanitizes_a_path_right_after_a_colon(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    broadcaster = MagicMock()
    collector, lines = _collector(store, job, broadcaster)
    secret = str(tmp_path / "private" / "cache.bin")

    with capture_job_warnings(collector):
        logging.getLogger("lizyml.tuner").warning(
            "event='trial.failed' trial=%d state=%s reason=%s",
            1,
            "FAIL",
            f"OSError: cannot read:{secret}",
        )

    expected = [
        "event='trial.failed' trial=1 state=FAIL reason=OSError: cannot read:<path>"
    ]
    assert job.warnings == expected
    assert str(tmp_path) not in "\n".join(lines)
    assert [c.args[1] for c in broadcaster.send_warning.call_args_list] == expected
    assert str(tmp_path) not in store.path_for(job.job_id, "meta").read_text()


def test_capture_refuses_a_nested_capture_on_one_thread(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    first, _ = _collector(store, _job(store))
    second, _ = _collector(store, _job(store))
    with (
        capture_job_warnings(first),
        pytest.raises(RuntimeError, match="already capturing"),
        capture_job_warnings(second),
    ):
        pass


# --- Thread isolation ----------------------------------------------------------


def test_concurrent_jobs_receive_only_their_own_thread_warnings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both jobs are registered at once when each one warns.

    The events force the interleaving: A and B both enter the capture,
    then each warns and logs, then both exit. A third, unregistered
    thread warns while both are active and reaches neither job; it goes to
    the hook the dispatcher chained to. (Production runs one job at a time
    per store; this pins the per-thread routing. No recorder wraps the
    jobs here: a ``catch_warnings(record=True)`` would take every thread's
    warnings for its duration, the documented residual.)
    """
    sentinel = _fresh_install(monkeypatch)
    store = JobStore(tmp_path / "jobs")
    jobs = {name: _job(store) for name in ("a", "b")}
    collectors = {name: _collector(store, jobs[name])[0] for name in jobs}
    both_in = threading.Barrier(3)
    both_warned = threading.Barrier(3)
    errors: list[BaseException] = []

    def job_thread(name: str) -> None:
        try:
            with capture_job_warnings(collectors[name]):
                both_in.wait(timeout=10)
                warnings.warn(f"from {name}", UserWarning, stacklevel=1)
                logging.getLogger("lizyml.model").warning("log from %s", name)
                both_warned.wait(timeout=10)
        except BaseException as exc:  # noqa: BLE001 - re-raised below
            errors.append(exc)

    threads = [threading.Thread(target=job_thread, args=(n,)) for n in jobs]
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        for t in threads:
            t.start()
        both_in.wait(timeout=10)
        warnings.warn("from the server thread", UserWarning, stacklevel=1)
        both_warned.wait(timeout=10)
        for t in threads:
            t.join(timeout=10)

    assert not errors, errors
    assert jobs["a"].warnings == ["from a", "log from a"]
    assert jobs["b"].warnings == ["from b", "log from b"]
    assert sentinel.messages == ["from the server thread"]


# --- meta.json ------------------------------------------------------------------


def test_old_meta_without_warnings_loads_with_an_empty_list(tmp_path: Path) -> None:
    source = _FIXTURES / "lizyml020" / "jobs" / "job_44a36460"
    assert '"warnings"' not in (source / "meta.json").read_text()
    jobs_dir = tmp_path / "jobs"
    shutil.copytree(source, jobs_dir / source.name)

    job = JobStore(jobs_dir).get(source.name)

    assert job is not None
    assert job.warnings == []


def test_warnings_round_trip_through_meta_without_a_version_bump(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    before = json.loads(store.path_for(job.job_id, "meta").read_text())
    job.warnings = ["one", "two"]
    store.update(job)

    raw = json.loads(store.path_for(job.job_id, "meta").read_text())
    reloaded = store.get(job.job_id)

    assert raw["warnings"] == ["one", "two"]
    assert raw["format_version"] == before["format_version"]
    assert reloaded is not None
    assert reloaded.warnings == ["one", "two"]


@pytest.mark.parametrize("bad", ["not a list", [1, "x"], {"a": 1}])
def test_a_malformed_warnings_value_loads_as_empty_and_is_logged(
    tmp_path: Path, bad: Any, caplog: pytest.LogCaptureFixture
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    path = store.path_for(job.job_id, "meta")
    raw = json.loads(path.read_text())
    raw["warnings"] = bad
    path.write_text(json.dumps(raw))

    with caplog.at_level(logging.WARNING):
        reloaded = store.get(job.job_id)

    assert reloaded is not None
    assert reloaded.warnings == []
    assert any("malformed warnings" in r.message for r in caplog.records)


# --- WebSocket and the subprocess hop ------------------------------------------


def test_ws_warning_round_trips_through_the_union() -> None:
    from pydantic import TypeAdapter

    from lizystudio.ws.messages import WsMessage, WsWarning
    from lizystudio.ws.progress import ProgressBroadcaster

    captured: list[dict[str, Any]] = []

    class _Capture(ProgressBroadcaster):
        def send(self, job_id: str, message: dict[str, Any]) -> None:  # type: ignore[override]
            captured.append(message)

    _Capture().send_warning("job_w", "memory is tight")

    assert captured == [
        {"type": "warning", "job_id": "job_w", "message": "memory is tight"}
    ]
    parsed = TypeAdapter(WsMessage).validate_python(captured[0])
    assert isinstance(parsed, WsWarning)


def test_ws_warning_is_not_cached_for_replay() -> None:
    from lizystudio.ws.progress import ProgressBroadcaster

    b = ProgressBroadcaster()
    b.send_warning("job_w", "memory is tight")
    assert "job_w" not in b._last_terminal  # noqa: SLF001


def test_ws_warning_rejects_extra_fields() -> None:
    from pydantic import ValidationError

    from lizystudio.ws.messages import WsWarning

    with pytest.raises(ValidationError):
        WsWarning.model_validate(
            {"type": "warning", "job_id": "j", "message": "m", "file": "/x.py"}
        )


def test_file_broadcaster_writes_and_parent_forwards_a_warning(
    tmp_path: Path,
) -> None:
    from lizystudio.services.subprocess_runner import (
        _FileBroadcaster,
        _forward_progress,
    )

    path = tmp_path / "progress.jsonl"
    _FileBroadcaster(str(path)).send_warning("job_w", "memory is tight")
    lines = path.read_text().splitlines()
    assert [json.loads(line) for line in lines] == [
        {"type": "warning", "message": "memory is tight"}
    ]

    parent = MagicMock()
    _forward_progress(lines[0], "job_w", parent)
    parent.send_warning.assert_called_once_with("job_w", "memory is tight")


@pytest.mark.parametrize(
    "line", ['{"type": "warning"}', '{"type": "warning", "message": 3}']
)
def test_parent_does_not_forward_a_warning_without_text(
    line: str, caplog: pytest.LogCaptureFixture
) -> None:
    from lizystudio.services.subprocess_runner import _forward_progress

    parent = MagicMock()
    with caplog.at_level(logging.WARNING):
        _forward_progress(line, "job_w", parent)
    parent.send_warning.assert_not_called()
    assert any("warning message without text" in r.message for r in caplog.records)
