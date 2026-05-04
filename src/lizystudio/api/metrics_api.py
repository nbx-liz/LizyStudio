"""Prometheus metrics endpoint (BLUEPRINT §5.9, H-0065, H-0075).

Issue #30 Phase 2. Renders the per-app :class:`MetricsRegistry`
(A-9) as Prometheus text format. Counter / Histogram / Gauge
definitions live on :class:`lizystudio.metrics.MetricsRegistry`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from lizystudio.api.deps import get_metrics
from lizystudio.metrics import MetricsRegistry

router = APIRouter()


@router.get("")
def metrics(
    registry: MetricsRegistry = Depends(get_metrics),
) -> Response:
    """Return all registered Prometheus metrics in text format.

    Authentication-free, mirroring the probe philosophy of `/api/health`.
    """
    return Response(
        content=generate_latest(registry.registry),
        media_type=CONTENT_TYPE_LATEST,
    )
