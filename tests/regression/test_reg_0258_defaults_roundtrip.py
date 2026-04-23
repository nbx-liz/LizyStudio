"""Regression (#258): defaults round-trip must reach ``POST /fit``.

Before the fix, ``GET /api/workspace/config/defaults`` returned a
Pydantic-validated config, but the frontend added ``shuffle: true`` (via
``buildSyncedConfig`` reading ``ui_schema.cv_strategy_fields``) before
PUTting it back. The resulting payload was then rejected by
``POST /fit`` with 422 because ``StratifiedKFoldConfig`` does not accept
``shuffle``.

This regression test pins the invariant at the API layer directly: for
every supported task, the defaults config returned by the backend must
itself be accepted by ``POST /fit`` body. Any future drift (ui schema
claims a field that Pydantic rejects, or defaults start emitting an
unaccepted field) fails this test.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


@pytest.fixture()
def binary_csv(tmp_path: Path) -> Iterator[Path]:
    # /tmp prefix is required because the ``client`` fixture restricts
    # file access to LIZYSTUDIO_FILES_ROOT=/tmp. Use tmp_path.name as a
    # per-test-unique suffix so parallel runs cannot collide.
    path = Path("/tmp") / f"{tmp_path.name}_reg_0258_binary.csv"
    rows = ["id,age,income,gender,target"]
    for i in range(100):
        rows.append(
            f"{i},{20 + (i % 50)},{30000 + i * 100},"
            f"{'M' if i % 2 == 0 else 'F'},{i % 2}"
        )
    path.write_text("\n".join(rows))
    yield path
    path.unlink(missing_ok=True)


@pytest.fixture()
def regression_csv(tmp_path: Path) -> Iterator[Path]:
    path = Path("/tmp") / f"{tmp_path.name}_reg_0258_regression.csv"
    rows = ["id,age,income,gender,target"]
    for i in range(100):
        rows.append(
            f"{i},{20 + (i % 50)},{30000 + i * 100},"
            f"{'M' if i % 2 == 0 else 'F'},{i * 1.5}"
        )
    path.write_text("\n".join(rows))
    yield path
    path.unlink(missing_ok=True)


def _load(client: TestClient, csv: Path) -> None:
    res = client.post("/api/workspace/data/path", json={"path": str(csv)})
    assert res.status_code == 200, res.text


def test_defaults_roundtrip_binary(client: TestClient, binary_csv: Path) -> None:
    _load(client, binary_csv)
    defaults_res = client.get(
        "/api/workspace/config/defaults?task=binary&target=target",
    )
    assert defaults_res.status_code == 200
    defaults = defaults_res.json()

    fit_res = client.post("/api/workspace/fit", json={"config": defaults})
    assert fit_res.status_code == 200, (
        "defaults for task=binary must be accepted by POST /fit "
        f"(got {fit_res.status_code}): {fit_res.text}"
    )


def test_defaults_roundtrip_regression(
    client: TestClient, regression_csv: Path
) -> None:
    _load(client, regression_csv)
    defaults_res = client.get(
        "/api/workspace/config/defaults?task=regression&target=target",
    )
    assert defaults_res.status_code == 200
    defaults = defaults_res.json()

    fit_res = client.post("/api/workspace/fit", json={"config": defaults})
    assert fit_res.status_code == 200, (
        "defaults for task=regression must be accepted by POST /fit "
        f"(got {fit_res.status_code}): {fit_res.text}"
    )


def test_defaults_plus_ui_shuffle_injection_is_rejected_symmetrically(
    client: TestClient, binary_csv: Path
) -> None:
    """Regression probe for the specific #258 shape: frontend injects
    ``shuffle: true`` on top of stratified_kfold defaults.

    After the fix (shuffle removed from UI schema for stratified_kfold),
    the frontend never produces this payload. If a future change
    reintroduces it, this test locks the expected behaviour: both
    validate and fit must reject consistently. Either:

    - both accept (meaning shuffle was legitimately added to the
      Pydantic StratifiedKFoldConfig), or
    - both reject (status 422 on fit, valid=false on validate)

    What must never happen again is validate=200/valid, fit=422.
    """
    _load(client, binary_csv)
    defaults = client.get(
        "/api/workspace/config/defaults?task=binary&target=target",
    ).json()
    injected = {**defaults, "split": {**defaults["split"], "shuffle": True}}

    v = client.post("/api/workspace/config/validate", json=injected).json()
    fit = client.post("/api/workspace/fit", json={"config": injected})

    if v["valid"]:
        assert fit.status_code == 200, (
            "/validate accepted the payload but /fit rejected it; "
            "validate/fit must agree."
        )
    else:
        assert fit.status_code == 422, (
            "/validate rejected the payload but /fit did not return 422; "
            "validate/fit must agree."
        )
