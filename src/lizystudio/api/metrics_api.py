"""Prometheus metrics endpoint (BLUEPRINT §5.9, H-0065).

Issue #30 Phase 2. Returns the default prometheus_client registry as
text format. Counter / Histogram / Gauge definitions live in
`lizystudio.metrics`.
"""

from __future__ import annotations

from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

router = APIRouter()


@router.get("")
def metrics() -> Response:
    """Return all registered Prometheus metrics in text format.

    Authentication-free, mirroring the probe philosophy of `/api/health`.
    """
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
