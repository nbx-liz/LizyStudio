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


JobType = Literal["fit", "tune"]
TerminalStatus = Literal["completed", "failed", "cancelled"]


def record_job_terminal(job_type: JobType, status: TerminalStatus) -> None:
    """Increment `lizystudio_jobs_total{job_type, status}` by 1.

    Call this from the service layer once the job reaches a terminal
    state. Kept as a helper (rather than exposing the raw counter) so
    the call sites never pass freeform strings — if a future status
    value is added, update this module's Literal instead.
    """
    JOBS_TOTAL.labels(job_type=job_type, status=status).inc()
