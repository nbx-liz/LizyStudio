"""Job warnings: capture, isolation, persistence and transport (P-0117 D4).

The real H-0140 path is covered by
``tests/integration/test_p0117_job_warnings.py``; these cases pin the
mechanism with controlled inputs: the per-thread dispatch, the dedupe and
the cap, the ``meta.json`` field, the WebSocket message and the subprocess
JSONL hop.
"""

from __future__ import annotations

import json
import logging
import shutil
import threading
import warnings
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services._job_warnings import (
    MAX_JOB_WARNINGS,
    MAX_WARNING_CHARS,
    JobWarningCollector,
    capture_job_warnings,
)
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit

_FIXTURES = Path(__file__).resolve().parent / "fixtures"


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


def test_non_user_warnings_pass_through_to_the_previous_hook(
    tmp_path: Path,
) -> None:
    store = JobStore(tmp_path / "jobs")
    job = _job(store)
    collector, _ = _collector(store, job)

    with warnings.catch_warnings(record=True) as seen:
        warnings.simplefilter("always")
        with capture_job_warnings(collector):
            warnings.warn("old api", DeprecationWarning, stacklevel=1)

    assert job.warnings == []
    assert [str(w.message) for w in seen] == ["old api"]


def test_the_hook_and_logger_state_are_restored_after_the_last_job(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A fresh registry: a job thread another test left running would
    # otherwise still be capturing, and the hook rightly stays for it.
    from lizystudio.services import _job_warnings

    monkeypatch.setattr(_job_warnings, "_registry", _job_warnings._CaptureRegistry())
    store = JobStore(tmp_path / "jobs")
    collector, _ = _collector(store, _job(store))
    before_hook = warnings.showwarning
    lizyml_logger = logging.getLogger("lizyml")
    before_handlers = list(lizyml_logger.handlers)
    resource_logger = logging.getLogger("lizyml.core.resource_warning")
    before_level = resource_logger.level

    with capture_job_warnings(collector):
        assert warnings.showwarning is not before_hook
        assert resource_logger.getEffectiveLevel() <= logging.INFO

    assert warnings.showwarning is before_hook
    assert lizyml_logger.handlers == before_handlers
    assert resource_logger.level == before_level


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
    tmp_path: Path,
) -> None:
    """Both jobs are registered at once when each one warns.

    The events force the interleaving: A and B both enter the capture,
    then each warns and logs, then both exit. A third, unregistered
    thread warns while both are active and reaches neither job.
    """
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
    with warnings.catch_warnings(record=True) as outside:
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
    assert [str(w.message) for w in outside] == ["from the server thread"]


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
