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
- the ``tune.trial.memory_warning`` record to the job log only (its first
  occurrence in the tune is already the stored ``UserWarning``). It is
  matched exactly: level INFO, logger ``lizyml.core.resource_warning``,
  and lizyml's unformatted template :data:`MEMORY_WARNING_TEMPLATE`. No
  other record below WARNING is captured.

Hooks, installed once. :func:`install_job_warning_hooks` runs once per
process at start: in the server's lifespan (``server.py``) and in the
subprocess child before it runs the job (``subprocess_runner``). It puts
one dispatcher into ``warnings.showwarning``, chained to the hook that was
there at install time, adds one handler to the ``lizyml`` logger, and
sets the ``lizyml.core.resource_warning`` logger to INFO (it inherits
WARNING otherwise, and the trial record would not be created; it emits
only this event, so the console sees it during a tune only). None of
these is undone. It is idempotent: the dispatcher is checked by identity,
so a second call changes nothing.

A capture then only registers the calling thread's collector in a
lock-guarded map of thread to collector, and removes it on exit; it never
touches ``warnings.showwarning`` or the loggers. The dispatcher and the
handler look the emitting thread up (``threading.get_ident()`` /
``LogRecord.thread``): a warning reaches the job whose thread emitted it,
and a thread that runs no job passes through untouched (to the chained
hook, or to the logger's other handlers, or to ``logging.lastResort`` when
there are none, as if our handler were not installed). A warning a job emits from a
thread it started itself is not attributed to the job (lizyml's tune runs
its trials on the calling thread). A capture in a process that never
installed the hooks logs that once, at WARNING, on this module's logger.

Because the dispatcher is installed once, a third party's
``warnings.catch_warnings`` saves and restores *our* dispatcher, on any
thread and in any order relative to a job. Residual (documented, not
fixed): while another thread's ``catch_warnings(record=True)`` is active
(lizyml's calibration option check, for example), Python 3.12's
``warnings`` state is process-global, so a job warning raised in that
window goes to that recorder and not to the job. And two
``catch_warnings`` contexts on two threads that exit out of order can
restore a stale hook; that is Python's own limit (``catch_warnings`` is
not thread-safe) and applies to any process hook.

Filters are not changed: an ``ignore`` (``server.py``'s SHAP filter) is
honoured, and an ignored warning is not captured. Python's ``default``
action shows a warning once per code location until the filters next
change, and it suppresses a repeat *before* ``showwarning`` is called.
That cannot hide one job's warning behind another's: a server's
``JobStore`` runs at most one training job at a time (the single active
slot, ``services/_job_active_slot.py``), so two jobs never warn
concurrently; and between sequential jobs the lizyml fit path enters
``warnings.catch_warnings`` many times (measured 2026-11-05: the filters
version moved from 72 to 732 across one Fit), which clears every module's
registry, so a second identical job warns again.
``tests/integration/test_p0117_job_warnings.py`` pins that for Fit and
Tune. A scoped ``always`` filter for lizyml (``module=r"^lizyml"``) was
weighed and not added: ``filterwarnings`` inserts at the front, so its
order against the SHAP ``ignore`` (whose location may be lizyml's SHAP
module) and against pytest's or ``-W`` filters would decide behaviour;
it would repeat lizyml warnings on API threads (inference, plots) on
every request; and it is a new conditionally-active filter that needs a
measured firing rate under the Change Gate, against a failure the single
active slot already rules out. If the sequential pin goes red, that
filter is the remedy, with its measurement.

Text. The stored text is the message only: no file, line or category.
Absolute paths inside the message (a trial failure's ``reason`` is
``str(exc)``, which can name a file) are replaced by
:data:`PATH_PLACEHOLDER` by :func:`sanitize_warning_text`, once, at the
collector's entry, so ``execution.log``, ``meta.json``, the API and the
WebSocket all carry the same sanitized text.

Volume. The log keeps every occurrence. The job's warnings keep each
distinct text once, at most :data:`MAX_JOB_WARNINGS` of them, each cut to
:data:`MAX_WARNING_CHARS`; reaching the cap is logged once. Each newly
stored text is persisted (``meta.json``) and broadcast once.

A capture nested on one thread raises ``RuntimeError`` before the job
starts. ``_run_job_core`` is never nested on today's call graph, so this
guards a programming error rather than a runtime path.
"""

from __future__ import annotations

import logging
import re
import sys
import threading
import warnings
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import TYPE_CHECKING, TextIO

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
#: lizyml v0.21.1 ``core/_resource_warning.py``: the later qualifying
#: trials' record, logged as ``_log.info(MEMORY_WARNING_TEMPLATE, text)``.
MEMORY_WARNING_TEMPLATE = "event='tune.trial.memory_warning' %s"

#: What an absolute path inside a warning's text becomes.
PATH_PLACEHOLDER = "<path>"

# Applied in this order; each replaces a whole match with the placeholder.
# A quoted span that starts like an absolute path, up to its closing quote
# (so a path with spaces goes whole); the quotes are kept.
_QUOTED_PATH = re.compile(
    r"""(?P<q>['"])(?:file://|[A-Za-z]:[\\/]|\\\\|/)[^'"\r\n]*(?P=q)""",
    re.IGNORECASE,
)
# A ``file:`` URI.
_FILE_URI = re.compile(r"""file://[^\s'"<>]*""", re.IGNORECASE)
# A Windows drive path (``C:\`` or ``C:/``) and a UNC path (``\\host\share``).
_WINDOWS_PATH = re.compile(r"""(?<![\w])[A-Za-z]:[\\/][^\s'"<>]*""")
_UNC_PATH = re.compile(r"""(?<![\w\\])\\\\[^\s\\'"<>]+\\[^\s'"<>]*""")
# A POSIX absolute path: a ``/`` not preceded by a word character or ``/``
# (so ``and/or`` and ``1/2`` are kept), then at least one path character
# that is not ``/``. A colon before it is allowed (``read:/srv/x``); a URL's
# ``scheme://host/x`` is kept because its first ``/`` is followed by ``/``,
# its second is preceded by ``/``, and ``/x`` is preceded by the host.
# It ends at whitespace or a quote.
_POSIX_PATH = re.compile(r"""(?<![\w/])/[^\s/'"<>]+(?:/[^\s/'"<>]*)*""")

_ShowWarning = Callable[..., None]


def sanitize_warning_text(text: str) -> str:
    """*text* with every absolute path replaced by :data:`PATH_PLACEHOLDER`.

    Covers POSIX absolute paths, Windows drive and UNC paths, and ``file:``
    URIs. Deterministic: the same input always gives the same output. A
    path ends at whitespace or a quote unless it is quoted, so an unquoted
    path with a space keeps its tail after the space (relative, no root).
    """
    text = _QUOTED_PATH.sub(
        lambda m: f"{m.group('q')}{PATH_PLACEHOLDER}{m.group('q')}", text
    )
    for pattern in (_FILE_URI, _WINDOWS_PATH, _UNC_PATH, _POSIX_PATH):
        text = pattern.sub(PATH_PLACEHOLDER, text)
    return text


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
        self._accept(logging.WARNING, category_name, text)

    def record_log(self, record: logging.LogRecord) -> None:
        """A ``lizyml`` log record the job's thread emitted."""
        self._accept(
            record.levelno, f"{record.name} {record.levelname}", record.getMessage()
        )

    def _accept(self, level: int, label: str, raw: str) -> None:
        """The one entry: sanitize, log, and store from WARNING up."""
        text = sanitize_warning_text(raw)
        self._job_logger.log(level, "%s: %s", label, text)
        if level >= logging.WARNING:
            self._store(text)

    def _store(self, clean: str) -> None:
        text = _bounded(clean)
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


def _is_captured(record: logging.LogRecord) -> bool:
    """A record at WARNING or above, or exactly the trial memory event."""
    if record.levelno >= logging.WARNING:
        return True
    return (
        record.levelno == logging.INFO
        and record.name == RESOURCE_LOGGER
        and record.msg == MEMORY_WARNING_TEMPLATE
    )


def _last_resort(record: logging.LogRecord, own: logging.Handler) -> None:
    """Python's no-handler fallback, as if *own* were not installed.

    Walks the emitting logger's chain as ``Logger.callHandlers`` does
    (stopping after a logger with ``propagate`` false) and counts every
    handler but *own*, whatever its level. When it counts none, the record
    goes to ``logging.lastResort`` if that exists and the record's level
    reaches it. ``callHandlers`` itself counted *own*, so it skipped this.
    """
    logger: logging.Logger | None = logging.getLogger(record.name)
    while logger is not None:
        if any(h is not own for h in logger.handlers):
            return
        logger = logger.parent if logger.propagate else None
    fallback = logging.lastResort
    if fallback is not None and record.levelno >= fallback.level:
        fallback.handle(record)


class _LizymlRecordHandler(logging.Handler):
    """Routes a ``lizyml`` record to the collector of its emitting thread.

    A record from a thread that runs no job is left alone: this handler
    neither changes it nor stops it reaching the logger's other handlers.
    Being a handler, though, it is counted by ``Logger.callHandlers``, which
    calls ``logging.lastResort`` only when it counts none; so for such a
    record it reproduces that fallback itself (:func:`_last_resort`).
    """

    def emit(self, record: logging.LogRecord) -> None:
        collector = _registry.collector_for(record.thread)
        if collector is None:
            _last_resort(record, self)
            return
        if not _is_captured(record):
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
        self._chain: _ShowWarning | None = None
        self._installed = False
        self._not_installed_logged = False

    def collector_for(self, thread_id: int | None) -> JobWarningCollector | None:
        if thread_id is None:
            return None
        with self._lock:
            return self._collectors.get(thread_id)

    def chain(self) -> _ShowWarning | None:
        with self._lock:
            return self._chain

    def install(self) -> None:
        with self._lock:
            if warnings.showwarning is not _showwarning:
                self._chain = warnings.showwarning
                warnings.showwarning = _showwarning
            lizyml_logger = logging.getLogger(LIZYML_LOGGER)
            if _HANDLER not in lizyml_logger.handlers:
                lizyml_logger.addHandler(_HANDLER)
            resource = logging.getLogger(RESOURCE_LOGGER)
            if resource.getEffectiveLevel() > logging.INFO:
                resource.setLevel(logging.INFO)
            self._installed = True

    def enter(self, collector: JobWarningCollector) -> int:
        ident = threading.get_ident()
        with self._lock:
            if ident in self._collectors:
                msg = "this thread is already capturing job warnings"
                raise RuntimeError(msg)
            self._collectors[ident] = collector
            log_not_installed = not self._installed and not self._not_installed_logged
            if log_not_installed:
                self._not_installed_logged = True
        if log_not_installed:
            _logger.warning(
                "Job warning hooks are not installed in this process; call "
                "install_job_warning_hooks() at process start. Job warnings "
                "are not captured."
            )
        return ident

    def exit(self, ident: int) -> None:
        with self._lock:
            self._collectors.pop(ident, None)


_registry = _CaptureRegistry()
#: One handler per process; it routes through whichever registry is current.
_HANDLER = _LizymlRecordHandler()


def _showwarning(
    message: Warning | str,
    category: type[Warning],
    filename: str,
    lineno: int,
    file: TextIO | None = None,
    line: str | None = None,
) -> None:
    """The installed ``warnings.showwarning``: dispatch by thread."""
    collector = _registry.collector_for(threading.get_ident())
    if collector is not None and issubclass(category, UserWarning):
        try:
            collector.record_warning(str(message), category.__name__)
        except Exception:  # noqa: BLE001 - a capture failure must not fail the job
            _logger.exception("Failed to capture a job warning")
        return
    chain = _registry.chain()
    if chain is None or chain is _showwarning:
        # No hook to chain to: print as Python's default does.
        stream = file if file is not None else sys.stderr
        stream.write(warnings.formatwarning(message, category, filename, lineno, line))
        return
    chain(message, category, filename, lineno, file, line)


def install_job_warning_hooks() -> None:
    """Install the dispatcher, the ``lizyml`` handler and the resource
    logger's level, once per process (see the module doc). Idempotent.

    Call it at process start, while no other thread is inside
    ``warnings.catch_warnings``: in the server's lifespan and in the
    subprocess child before it runs the job.
    """
    _registry.install()


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
    "MEMORY_WARNING_TEMPLATE",
    "PATH_PLACEHOLDER",
    "JobWarningCollector",
    "capture_job_warnings",
    "install_job_warning_hooks",
    "sanitize_warning_text",
]
