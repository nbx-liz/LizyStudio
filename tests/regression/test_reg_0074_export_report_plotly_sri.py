"""Regression test: HTML report must serve Plotly with an SRI hash.

Issue #92: Loading Plotly from a CDN with no integrity attribute leaves
the report vulnerable to a tampered or substituted bundle. The CSP
restricts the script origin, but a compromised CDN bypasses that. This
test pins a sha384 SRI on the plotly-2.27.0 script tag so the browser
refuses to execute a modified payload.

If you bump the Plotly version in ``export.py``, recompute the hash via:

    python -c "import urllib.request, hashlib, base64; \\
        d = urllib.request.urlopen('https://cdn.plot.ly/plotly-X.Y.Z.min.js').read(); \\
        print('sha384-' + base64.b64encode(hashlib.sha384(d).digest()).decode())"

and update both ``export.py`` and the expected hash in this test.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.types import DataRef, FitSummary, PlotData
from lizystudio.services.export import export_report
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit

EXPECTED_SRI = "sha384-Hl48Kq2HifOWdXEjMsKo6qxqvRLTYqIGbvlENBmkHAxZKIGCXv43H6W1jA671RzC"
EXPECTED_PLOTLY_VERSION = "plotly-2.27.0.min.js"


@pytest.fixture()
def job_store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


@pytest.fixture()
def completed_job(job_store: JobStore) -> Job:
    data_ref = DataRef(
        source_type="path",
        path="/data/train.csv",
        filename="train.csv",
        fingerprint="abc123",
        shape=(100, 10),
    )
    job = job_store.create(
        backend_name="lizyml",
        config={"task": "binary"},
        data_ref=data_ref,
        job_type="fit",
    )
    job.status = "completed"
    job.model_path = "/tmp/fake_model"
    job.fit_result = FitSummary(
        metrics={"auc": 0.95},
        fold_count=5,
        params=[{"n_estimators": 100}],
    )
    job_store.update(job)
    return job


@pytest.fixture()
def mock_backend() -> MagicMock:
    backend = MagicMock()
    backend.load_model.return_value = MagicMock()
    backend.evaluate_table.return_value = [{"metric": "auc", "IS": 0.95, "OOS": 0.90}]
    backend.model_info.return_value = {"task": "binary", "model_name": "LightGBM"}
    backend.available_plots.return_value = ["learning_curve"]
    backend.plot.return_value = PlotData(plotly_json='{"data": [], "layout": {}}')
    return backend


def test_export_report_pins_plotly_sri_hash(
    completed_job: Job, mock_backend: MagicMock, tmp_path: Path
) -> None:
    """Generated HTML must include integrity="sha384-..." on the Plotly tag.

    Without this, a compromised CDN can ship arbitrary JavaScript that
    runs inside the report's CSP-restricted script-src whitelist.
    """
    out_path = tmp_path / "report.html"
    export_report(
        job=completed_job,
        backend=mock_backend,
        output_path=str(out_path),
    )
    content = out_path.read_text(encoding="utf-8")

    assert EXPECTED_PLOTLY_VERSION in content, (
        "Plotly version reference missing from HTML; if you bumped the "
        "version you must also bump EXPECTED_PLOTLY_VERSION and "
        "EXPECTED_SRI in this test."
    )
    assert f'integrity="{EXPECTED_SRI}"' in content, (
        "Plotly script tag is missing or has the wrong SRI hash. "
        "Either the version was bumped without updating the hash, or "
        "the hash was tampered with."
    )
    # SRI without crossorigin is silently ignored by some browsers.
    assert 'crossorigin="anonymous"' in content


def test_export_report_csp_still_restricts_plotly_origin(
    completed_job: Job, mock_backend: MagicMock, tmp_path: Path
) -> None:
    """SRI does not replace CSP; both must remain in the report.

    SRI guarantees integrity if the script reaches the browser, but CSP
    is what restricts which origins the browser is allowed to fetch
    from in the first place. A regression that removes either while
    "fixing" the other would weaken the report's defense in depth.
    """
    out_path = tmp_path / "report.html"
    export_report(
        job=completed_job,
        backend=mock_backend,
        output_path=str(out_path),
    )
    content = out_path.read_text(encoding="utf-8")

    assert "Content-Security-Policy" in content
    # Match with a trailing space so a future regression that lengthens
    # the origin (e.g. accidentally allowing
    # `script-src https://cdn.plot.ly.attacker.com`) trips this test
    # instead of silently passing on a substring match.
    assert "script-src https://cdn.plot.ly " in content
