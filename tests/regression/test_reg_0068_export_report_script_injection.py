"""Regression test for export report script-injection / CSP hardening.

MEDIUM-4 / HIGH-5: the HTML report serialized Plotly payloads via
``json.dumps`` and inlined them inside a <script> block. A plot layout
or trace containing the literal substring ``</script>`` would have
terminated the surrounding script context and allowed arbitrary HTML /
JS to follow. The fix escapes every ``</`` sequence so the JSON value
cannot break out of the <script> block, and adds a meta CSP that
restricts active content to the Plotly CDN origin.
"""

from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef, FitSummary, PlotData
from lizystudio.services.export import export_report
from lizystudio.services.jobs import JobStore

pytestmark = pytest.mark.unit


def _make_job(job_store: JobStore) -> str:
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="fit",
    )
    job.status = "completed"
    job.fit_result = FitSummary(metrics={}, fold_count=5, params=[])
    job.model_path = "/fake/model"
    job_store.update(job)
    return job.job_id


def _backend_with_hostile_plot() -> MagicMock:
    mock = MagicMock()
    mock.load_model.return_value = MagicMock()
    mock.evaluate_table.return_value = []
    mock.model_info.return_value = {"task": "binary", "model_name": "lgbm"}
    mock.available_plots.return_value = ["hostile"]
    # A plot payload whose label attempts to break out of the <script>
    # context with a literal </script> sequence followed by an IMG onerror.
    hostile_json = (
        '{"data": [{"type": "bar", '
        '"x": ["a"], "y": [1], '
        '"name": "pwn</script><img src=x onerror=alert(1)>"}], '
        '"layout": {"title": {"text": "</script>"}}}'
    )
    mock.plot.return_value = PlotData(plotly_json=hostile_json)
    return mock


def test_report_escapes_script_breakout_sequences(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    job_id = _make_job(store)
    job = store.get(job_id)
    assert job is not None

    backend = _backend_with_hostile_plot()
    out_path = export_report(
        job=job, backend=backend, output_path=str(tmp_path / "report.html")
    )
    html = Path(out_path).read_text(encoding="utf-8")

    # The hostile </script> sequence must not appear as a raw tag-closer
    # anywhere inside a <script> block. An escaped <\/script> is fine.
    script_blocks = re.findall(r"<script[^>]*>(.*?)</script>", html, flags=re.DOTALL)
    for block in script_blocks:
        assert "</script" not in block.lower(), (
            "found raw </script> inside a <script> block — injection possible"
        )

    # The escaped form must be present inside the script block.
    assert "<\\/script>" in html


def test_report_has_csp_meta_restricting_scripts(tmp_path: Path) -> None:
    store = JobStore(tmp_path / "jobs")
    job_id = _make_job(store)
    job = store.get(job_id)
    assert job is not None

    backend = _backend_with_hostile_plot()
    out_path = export_report(
        job=job, backend=backend, output_path=str(tmp_path / "report.html")
    )
    html = Path(out_path).read_text(encoding="utf-8")

    assert 'http-equiv="Content-Security-Policy"' in html
    assert "script-src https://cdn.plot.ly" in html
    assert "default-src 'none'" in html
