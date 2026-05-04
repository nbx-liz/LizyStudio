"""Regression test for the 10k-column preview path (Issue #361 / P-0097).

Loads the wide-DataFrame fixture (`tests/fixtures/lizyml/wide/data.csv`,
1000 rows × 10000 cols) and verifies the new ``max_cols`` query
parameter caps the preview payload to a budget the SPA can render
without blocking the main thread.

The fixture is generated on demand (`tests/fixtures/lizyml/wide/generate.py`)
and is **gitignored** — the test is skipped when the file is missing
so contributors who have not generated it locally still see green
unit suites. CI generates the fixture once at job start.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = [pytest.mark.integration, pytest.mark.slow]

WIDE_CSV = (
    Path(__file__).resolve().parents[1] / "fixtures" / "lizyml" / "wide" / "data.csv"
)


def _require_fixture() -> None:
    if not WIDE_CSV.exists():
        pytest.skip(
            "Wide-DataFrame fixture missing. Run "
            "`uv run python tests/fixtures/lizyml/wide/generate.py` "
            "to generate it locally."
        )


def test_wide_preview_caps_payload_by_max_cols(
    client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``max_cols=200`` returns a tiny preview even on 10k-column data."""
    _require_fixture()

    # The autouse client fixture pins LIZYSTUDIO_FILES_ROOT to /tmp,
    # which excludes the repo's fixtures directory. Re-point it for
    # this test so the path-load is allowed.
    files_root = WIDE_CSV.parent.parent.parent.resolve()  # tests/fixtures/lizyml
    monkeypatch.setenv("LIZYSTUDIO_FILES_ROOT", str(files_root))
    import lizystudio.security as sec

    monkeypatch.setattr(sec, "ALLOWED_FILES_ROOT", files_root)

    r = client.post("/api/workspace/data/path", json={"path": str(WIDE_CSV)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["data_ref"]["shape"] == [1000, 10000]

    # Without max_cols: 10k columns × 50 rows is large.
    full = client.get("/api/workspace/data/preview?rows=5")
    assert full.status_code == 200
    full_body = full.json()
    assert full_body["total_cols"] == 10000
    assert len(full_body["columns"]) == 10000

    # With max_cols=200: 5 rows × 200 cols × ~20B = ~20KB. Well below
    # the 512KB ceiling the SPA expects for snappy rendering.
    capped = client.get("/api/workspace/data/preview?rows=5&max_cols=200")
    assert capped.status_code == 200
    capped_body = capped.json()
    assert capped_body["total_cols"] == 10000, (
        "total_cols must reflect ground truth even when capped"
    )
    assert len(capped_body["columns"]) == 200

    encoded = len(json.dumps(capped_body))
    assert encoded < 512 * 1024, (
        f"capped preview must fit in 512KB, got {encoded} bytes"
    )
