"""Job warnings: what the backend warned about while a job ran (P-0117 D4).

lizyml warns before it trains when LightGBM will allocate a lot of memory
(H-0140): a ``UserWarning`` before a Fit, and before the first qualifying
Tune trial; later qualifying trials of the same ``tune()`` only log
``event='tune.trial.memory_warning'`` at INFO on the
``lizyml.core.resource_warning`` logger. Neither reached the user: the
job log held only Studio's own logger, and in thread mode the warning
went nowhere.

:func:`capture_job_warnings` wraps one job run (``_run_job_core``, in the
thread worker and in the subprocess child alike) and routes, for that
job's thread only:

- every ``UserWarning`` (and subclass) to the job log as
  ``"<Category>: <text>"`` and to the job's warnings;
- every ``lizyml`` log record at WARNING or above to the job log and the
  job's warnings;
- the ``tune.trial.memory_warning`` INFO record to the job log only (its
  first occurrence in the tune is already the stored ``UserWarning``).
  No other INFO record is captured.

Thread safety. ``warnings.catch_warnings`` swaps process-global state and
is not safe with concurrent jobs, so it is not used. Instead one
process-wide dispatcher replaces ``warnings.showwarning`` while any job
is capturing, and one handler sits on the ``lizyml`` logger. Both look the
emitting thread up (``threading.get_ident()`` / ``LogRecord.thread``) in a
lock-guarded map of thread to collector: a warning reaches the job whose
thread emitted it, and a thread that runs no job falls through to the
previous ``showwarning`` unchanged. A warning a job emits from a thread it
started itself is not attributed to the job (lizyml's tune runs its trials
on the calling thread). The hook, the handler and the logger level are
restored when the last capturing job ends.

Filters are not changed: an ``ignore`` (``server.py``'s SHAP filter) is
honoured, and an ignored warning is not captured. Python's ``default``
action would show a warning once per code location per process, but the
lizyml fit path enters ``warnings.catch_warnings`` many times (measured
2026-11-05: the filters version moved from 72 to 732 across one Fit),
which clears every module's registry, so a second identical job warns
again. ``tests/integration/test_p0117_job_warnings.py`` pins that for
Fit and Tune; if it goes red, an ``always`` filter is the remedy, with
its measured firing rate.

The ``lizyml.core.resource_warning`` logger is set to INFO while a job
captures (it inherits WARNING otherwise, and the trial record would not
be created); it emits only this event, and its level is restored after
the last job.

A capture nested on one thread raises ``RuntimeError`` before the job
starts. ``_run_job_core`` is never nested on today's call graph, so this
guards a programming error rather than a runtime path.

The stored text is the message only: no file, line or category, so no
local path from ``warnings.warn``'s location leaks into ``meta.json``,
the API or the WebSocket.

Volume. The log keeps every occurrence. The job's warnings keep each
distinct text once, at most :data:`MAX_JOB_WARNINGS` of them, each cut to
:data:`MAX_WARNING_CHARS`; reaching the cap is logged once. Each newly
stored text is persisted (``meta.json``) and broadcast once.
"""

from __future__ import annotations

import logging
import sys
import threading
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, TextIO

if TYPE_CHECKING:
    from lizystudio.services.jobs import Job, JobStore
    from lizystudio.ws.progress import ProgressBroadcaster

_logger = logging.getLogger(__name__)

#: Distinct warnings a job keeps; the log keeps every occurrence.
MAX_JOB_WARNINGS = 50
#: Characters a stored warning keeps (a longer one ends in ``...``).
MAX_WARNING_CHARS = 2000

LIZYML_LOGGER = "lizyml"
RESOURCE_LOGGER = "lizyml.core.resource_warning"
MEMORY_WARNING_EVENT = "event='tune.trial.memory_warning'"

_ShowWarning = Callable[..., None]


def _bounded(text: str) -> str:
    if len(text) <= MAX_WARNING_CHARS:
        return text
    return text[: MAX_WARNING_CHARS - 3] + "..."


class JobWarningCollector:
    """One job's warnings: logged, deduped, capped, persisted, broadcast."""

    def __init__(
        self,
        *,
        job: Job,
        job_store: JobStore,
        broadcaster: ProgressBroadcaster | None,
        job_logger: logging.Logger,
    ) -> None:
        self._job = job
        self._job_store = job_store
        self._broadcaster = broadcaster
        self._job_logger = job_logger
        # A resumed job keeps the warnings of its earlier run.
        self._seen: set[str] = set(job.warnings)
        self._cap_logged = False

    def record_warning(self, text: str, category_name: str) -> None:
        """A ``warnings.warn`` the job's thread raised."""
        self._job_logger.warning("%s: %s", category_name, text)
        self._store(text)

    def record_log(self, record: logging.LogRecord) -> None:
        """A ``lizyml`` log record the job's thread emitted."""
        text = record.getMessage()
        self._job_logger.log(
            record.levelno, "%s %s: %s", record.name, record.levelname, text
        )
        if record.levelno >= logging.WARNING:
            self._store(text)

    def _store(self, raw: str) -> None:
        text = _bounded(raw)
        if text in self._seen:
            return
        if len(self._job.warnings) >= MAX_JOB_WARNINGS:
            if not self._cap_logged:
                self._cap_logged = True
                self._job_logger.warning(
                    "Job warnings reached %d; further warnings are not stored "
                    "and stay in this log only.",
                    MAX_JOB_WARNINGS,
                )
            return
        self._seen.add(text)
        self._job.warnings = [*self._job.warnings, text]
        try:
            self._job_store.update(self._job)
        except OSError:
            _logger.warning(
                "Failed to persist job warnings for %s", self._job.job_id, exc_info=True
            )
        if self._broadcaster is not None:
            self._broadcaster.send_warning(self._job.job_id, text)


class _LizymlRecordHandler(logging.Handler):
    """Routes a ``lizyml`` record to the collector of its emitting thread."""

    def emit(self, record: logging.LogRecord) -> None:
        collector = _registry.collector_for(record.thread)
        if collector is None:
            return
        captured = record.levelno >= logging.WARNING or (
            record.name == RESOURCE_LOGGER
            and MEMORY_WARNING_EVENT in record.getMessage()
        )
        if not captured:
            return
        try:
            collector.record_log(record)
        except Exception:  # noqa: BLE001 - a capture failure must not fail the job
            _logger.exception("Failed to capture a lizyml log record")


class _CaptureRegistry:
    """Process-wide state shared by every capturing job (lock-guarded)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._collectors: dict[int, JobWarningCollector] = {}
        self._previous_showwarning: _ShowWarning | None = None
        self._handler = _LizymlRecordHandler()
        self._saved_resource_level: int | None = None

    def collector_for(self, thread_id: int | None) -> JobWarningCollector | None:
        if thread_id is None:
            return None
        with self._lock:
            return self._collectors.get(thread_id)

    def previous_showwarning(self) -> _ShowWarning | None:
        with self._lock:
            return self._previous_showwarning

    def enter(self, collector: JobWarningCollector) -> int:
        ident = threading.get_ident()
        with self._lock:
            if ident in self._collectors:
                msg = "this thread is already capturing job warnings"
                raise RuntimeError(msg)
            if warnings.showwarning is not _showwarning:
                self._previous_showwarning = warnings.showwarning
                warnings.showwarning = _showwarning
            if not self._collectors:
                self._attach_logging()
            self._collectors[ident] = collector
        return ident

    def exit(self, ident: int) -> None:
        with self._lock:
            self._collectors.pop(ident, None)
            if self._collectors:
                return
            if (
                warnings.showwarning is _showwarning
                and self._previous_showwarning is not None
            ):
                warnings.showwarning = self._previous_showwarning
            # ``_previous_showwarning`` is kept: if another party saved our
            # hook and restores it after this exit, ``_showwarning`` still
            # has a hook to fall through to.
            self._detach_logging()

    def _attach_logging(self) -> None:
        logging.getLogger(LIZYML_LOGGER).addHandler(self._handler)
        resource = logging.getLogger(RESOURCE_LOGGER)
        if resource.getEffectiveLevel() > logging.INFO:
            self._saved_resource_level = resource.level
            resource.setLevel(logging.INFO)

    def _detach_logging(self) -> None:
        logging.getLogger(LIZYML_LOGGER).removeHandler(self._handler)
        if self._saved_resource_level is not None:
            logging.getLogger(RESOURCE_LOGGER).setLevel(self._saved_resource_level)
            self._saved_resource_level = None


_registry = _CaptureRegistry()


def _showwarning(
    message: Warning | str,
    category: type[Warning],
    filename: str,
    lineno: int,
    file: TextIO | None = None,
    line: str | None = None,
) -> None:
    """``warnings.showwarning`` while a job captures: dispatch by thread."""
    collector = _registry.collector_for(threading.get_ident())
    if collector is not None and issubclass(category, UserWarning):
        try:
            collector.record_warning(str(message), category.__name__)
        except Exception:  # noqa: BLE001 - a capture failure must not fail the job
            _logger.exception("Failed to capture a job warning")
        return
    previous: Any = _registry.previous_showwarning()
    if previous is None or previous is _showwarning:
        # No other hook was ever seen: print as Python's default does.
        stream = file if file is not None else sys.stderr
        stream.write(warnings.formatwarning(message, category, filename, lineno, line))
        return
    previous(message, category, filename, lineno, file, line)


@contextmanager
def capture_job_warnings(collector: JobWarningCollector) -> Iterator[None]:
    """Capture the calling thread's warnings into *collector* (see module doc)."""
    ident = _registry.enter(collector)
    try:
        yield
    finally:
        _registry.exit(ident)


__all__ = [
    "MAX_JOB_WARNINGS",
    "MAX_WARNING_CHARS",
    "MEMORY_WARNING_EVENT",
    "JobWarningCollector",
    "capture_job_warnings",
]
