"""Prometheus metrics (BLUEPRINT §5.9, H-0065, H-0075).

A-9: metrics are owned by a per-app :class:`MetricsRegistry` living on
``FastAPI.state.metrics``. Each app instantiates its own
``prometheus_client.CollectorRegistry`` so the test suite can build
two apps in the same process without the second one tripping
``Duplicated timeseries in CollectorRegistry``. The registry also
bundles ``record_job_terminal`` as a method so call sites in
``services/*`` and ``api/workspace.py`` reach the right registry via
DI (``Depends(get_metrics)``) rather than a module-level global.

The constants in ``JOBS_DURATION_BUCKETS`` are module-level because
they are static configuration, not per-instance state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram

# H-0066: ML job wall-clock duration buckets. Targets real fit / tune
# workloads (seconds to one hour). prometheus_client's default 5ms–10s
# ladder would collapse everything into the +Inf bucket.
JOBS_DURATION_BUCKETS: tuple[float, ...] = (
    1.0,
    5.0,
    10.0,
    30.0,
    60.0,
    120.0,
    300.0,
    600.0,
    1800.0,
    3600.0,
)


JobType = Literal["fit", "tune"]
TerminalStatus = Literal["completed", "failed", "cancelled"]


@dataclass
class MetricsRegistry:
    """Per-app Prometheus instrument bundle (A-9).

    Owns a fresh :class:`CollectorRegistry` and every Counter /
    Histogram / Gauge the service layer bumps. Construct exactly once
    per :class:`FastAPI` app in :func:`lizystudio.server.create_app` and
    inject through ``Depends(lizystudio.api.deps.get_metrics)``.

    All instruments are mirrors of the pre-A-9 module-level globals;
    names and labels are unchanged so the scrape output is bit-compatible.
    """

    registry: CollectorRegistry = field(default_factory=CollectorRegistry)

    requests_total: Counter = field(init=False)
    request_duration: Histogram = field(init=False)
    jobs_total: Counter = field(init=False)
    active_jobs: Gauge = field(init=False)
    jobs_duration: Histogram = field(init=False)
    progress_dropped_total: Counter = field(init=False)
    progress_terminal_replayed_total: Counter = field(init=False)

    def __post_init__(self) -> None:
        # HTTP request counter. Labels:
        #   method  — HTTP verb
        #   path    — FastAPI route template (e.g. "/api/jobs/{job_id}"),
        #             or "unmatched" for 4xx paths that did not hit any router
        #   status  — numeric HTTP status code as a string
        self.requests_total = Counter(
            "lizystudio_requests_total",
            "HTTP requests handled by LizyStudio",
            labelnames=("method", "path", "status"),
            registry=self.registry,
        )

        # HTTP request duration histogram. Labels kept lean (no status) so
        # latency analysis does not require summing across status buckets.
        self.request_duration = Histogram(
            "lizystudio_request_duration_seconds",
            "HTTP request latency",
            labelnames=("method", "path"),
            registry=self.registry,
        )

        # Terminal-state ML job counter. Bumped from the training service
        # layer once a subprocess / thread reports its final status.
        self.jobs_total = Counter(
            "lizystudio_jobs_total",
            "ML jobs by terminal status",
            labelnames=("job_type", "status"),
            registry=self.registry,
        )

        # Current active-job gauge. JobStore holds at most one active
        # slot per process, so this is effectively a 0-or-1 signal.
        self.active_jobs = Gauge(
            "lizystudio_active_jobs",
            "Currently running ML jobs (0 or 1)",
            registry=self.registry,
        )

        # H-0066: ML job wall-clock duration histogram.
        self.jobs_duration = Histogram(
            "lizystudio_jobs_duration_seconds",
            "ML job wall-clock duration from claim_active to terminal state",
            labelnames=("job_type", "status"),
            buckets=JOBS_DURATION_BUCKETS,
            registry=self.registry,
        )

        # Issue #151: counts progress messages that the WebSocket
        # broadcaster dropped because a subscriber queue was full.
        self.progress_dropped_total = Counter(
            "lizystudio_progress_dropped_total",
            "Progress messages dropped due to a full subscriber queue",
            registry=self.registry,
        )

        # Issue #327 / P-0093: counts terminal messages (completed / error)
        # that were delivered via the per-jobId terminal cache to a
        # subscriber that joined AFTER the message was sent. A non-zero
        # rate signals the subscribe-before-send race actually fires in
        # production; sustained growth suggests either very fast jobs or
        # a slow client connect path.
        self.progress_terminal_replayed_total = Counter(
            "lizystudio_progress_terminal_replayed_total",
            "Terminal messages replayed to late WebSocket subscribers",
            registry=self.registry,
        )

    def record_job_terminal(
        self,
        job_type: JobType,
        status: TerminalStatus,
        duration: float = 0.0,
    ) -> None:
        """Record one terminal transition for a ML job.

        Increments ``lizystudio_jobs_total{job_type, status}`` by 1 and,
        when *duration* is known, observes the elapsed seconds in
        ``lizystudio_jobs_duration_seconds{job_type, status}``.

        *duration* defaults to 0.0 for early-fail paths (e.g. retune
        data missing) where the wall-clock is effectively zero because
        the job never reached the training phase. Counter emission
        stays correct even for those paths.
        """
        self.jobs_total.labels(job_type=job_type, status=status).inc()
        self.jobs_duration.labels(job_type=job_type, status=status).observe(duration)


__all__ = [
    "JOBS_DURATION_BUCKETS",
    "JobType",
    "MetricsRegistry",
    "TerminalStatus",
]
