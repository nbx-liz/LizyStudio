"""Contract: ``POST /config/validate`` and ``POST /fit`` must agree.

Issue #259 observed that a payload where ``split.stratified_kfold`` had
an extra ``shuffle`` field:

* returned 200 with ``valid: true`` from ``POST /config/validate``
* returned 422 from ``POST /fit``

for the same body. That asymmetry lets the frontend cheerfully proceed
past validation and hit the expensive operation before discovering the
problem. This contract locks both endpoints to the same verdict.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


@pytest.fixture()
def csv_path(tmp_path: Path) -> Iterator[Path]:
    # /tmp prefix is required because the ``client`` fixture restricts
    # file access to LIZYSTUDIO_FILES_ROOT=/tmp. Use pytest's tmp_path
    # basename (already unique per test) under /tmp so parallel runs
    # do not collide. pytest cleans up the parent tmp_path itself.
    path = Path("/tmp") / f"{tmp_path.name}_contract_symmetry.csv"
    rows = ["id,age,income,gender,target"]
    for i in range(100):
        rows.append(
            f"{i},{20 + (i % 50)},{30000 + i * 100},"
            f"{'M' if i % 2 == 0 else 'F'},{i % 2}"
        )
    path.write_text("\n".join(rows))
    yield path
    path.unlink(missing_ok=True)


def _load_data(client: TestClient, csv: Path) -> None:
    res = client.post("/api/workspace/data/path", json={"path": str(csv)})
    assert res.status_code == 200, res.text


def _defaults(client: TestClient) -> dict:
    res = client.get(
        "/api/workspace/config/defaults?task=binary&target=target",
    )
    assert res.status_code == 200
    return res.json()


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda c: c, id="defaults_as_is"),
        pytest.param(
            lambda c: {**c, "split": {**c["split"], "shuffle": True}},
            id="stratified_kfold_plus_shuffle",
        ),
        pytest.param(
            lambda c: {**c, "split": {**c["split"], "bogus_field": 1}},
            id="bogus_extra_field_in_split",
        ),
        pytest.param(
            lambda c: {**c, "task": "not_a_real_task"},
            id="invalid_task",
        ),
    ],
)
def test_validate_and_fit_agree(client: TestClient, csv_path: Path, mutate) -> None:
    """For each config, ``/config/validate`` and ``/fit`` must return the
    same verdict (both accept or both reject).

    ``/validate`` exposes the verdict as ``response.json()["valid"]``.
    ``/fit`` exposes it as ``response.status_code`` (200 success,
    422 validation error).
    """
    _load_data(client, csv_path)
    config = mutate(_defaults(client))

    validate_res = client.post("/api/workspace/config/validate", json=config)
    assert validate_res.status_code == 200, validate_res.text
    validate_says_valid = validate_res.json()["valid"]

    # POST /fit takes the config under ``body.config`` (P-0086)
    fit_res = client.post("/api/workspace/fit", json={"config": config})
    fit_accepts = fit_res.status_code == 200
    fit_rejects = fit_res.status_code == 422

    if validate_says_valid:
        assert fit_accepts, (
            f"/validate said valid=true but /fit returned "
            f"{fit_res.status_code}: {fit_res.text}"
        )
    else:
        assert fit_rejects, (
            f"/validate said valid=false but /fit returned "
            f"{fit_res.status_code} (expected 422): {fit_res.text}"
        )
