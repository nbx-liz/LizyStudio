"""Prometheus metrics (BLUEPRINT §5.9, H-0065).

Issue #30 Phase 2. Centralizes metric definitions so both the ASGI
middleware (`server.py`) and the service-layer hooks (`services/jobs.py`,
`services/training.py`) can bump counters without each site having to
know prometheus_client internals.

Using the default CollectorRegistry is intentional — it keeps
`generate_latest()` in `api/metrics_api.py` one line and avoids the
need to thread a registry through app.state.
"""

from __future__ import annotations

from typing import Literal

from prometheus_client import Counter, Gauge, Histogram

# HTTP request counter. Labels:
#   method  — HTTP verb
#   path    — FastAPI route template (e.g. "/api/jobs/{job_id}"), or
#             "unmatched" for 4xx paths that did not hit any router
#   status  — numeric HTTP status code as a string
REQUESTS_TOTAL = Counter(
    "lizystudio_requests_total",
    "HTTP requests handled by LizyStudio",
    labelnames=("method", "path", "status"),
)

# HTTP request duration histogram. Labels kept lean (no status) so
# latency analysis does not require summing across status buckets.
REQUEST_DURATION = Histogram(
    "lizystudio_request_duration_seconds",
    "HTTP request latency",
    labelnames=("method", "path"),
)

# Terminal-state ML job counter. Bumped from the training service layer
# once a subprocess / thread reports its final status.
JOBS_TOTAL = Counter(
    "lizystudio_jobs_total",
    "ML jobs by terminal status",
    labelnames=("job_type", "status"),
)

# Current active-job gauge. JobStore holds at most one active slot per
# process, so this is effectively a 0-or-1 signal. Exposed as a gauge
# (not a counter) so external alerting can trigger on "stuck for >N
# minutes" by combining it with request_duration.
ACTIVE_JOBS = Gauge(
    "lizystudio_active_jobs",
    "Currently running ML jobs (0 or 1)",
)

# H-0066: ML job wall-clock duration. Buckets target real fit / tune
# workloads (seconds to one hour). prometheus_client's default 5ms–10s
# ladder would collapse everything into the +Inf bucket for this
# domain.
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

JOBS_DURATION = Histogram(
    "lizystudio_jobs_duration_seconds",
    "ML job wall-clock duration from claim_active to terminal state",
    labelnames=("job_type", "status"),
    buckets=JOBS_DURATION_BUCKETS,
)


JobType = Literal["fit", "tune"]
TerminalStatus = Literal["completed", "failed", "cancelled"]


def record_job_terminal(
    job_type: JobType,
    status: TerminalStatus,
    duration: float = 0.0,
) -> None:
    """Record one terminal transition for a ML job.

    Increments `lizystudio_jobs_total{job_type, status}` by 1 and, when
    *duration* is known, observes the elapsed seconds in
    `lizystudio_jobs_duration_seconds{job_type, status}`.

    *duration* defaults to 0.0 for early-fail paths (e.g. retune data
    missing) where the wall-clock is effectively zero because the job
    never reached the training phase. Counter emission stays correct
    even for those paths.
    """
    JOBS_TOTAL.labels(job_type=job_type, status=status).inc()
    JOBS_DURATION.labels(job_type=job_type, status=status).observe(duration)
