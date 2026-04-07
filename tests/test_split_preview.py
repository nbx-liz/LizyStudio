"""Tests for split-preview service function and API endpoint."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lizystudio.services.data import compute_split_preview

pytestmark = pytest.mark.integration

# ---------------------------------------------------------------------------
# Unit tests: compute_split_preview
# ---------------------------------------------------------------------------


class TestComputeSplitPreviewKFold:
    """KFold-family strategies."""

    def test_even_split(self) -> None:
        result = compute_split_preview(100, "kfold", 5)
        assert result.strategy == "kfold"
        assert result.n_splits == 5
        assert len(result.folds) == 5
        for fold in result.folds:
            assert fold.valid_size == 20
            assert fold.train_size == 80

    def test_uneven_split_remainder(self) -> None:
        result = compute_split_preview(103, "kfold", 5)
        assert len(result.folds) == 5
        # First 3 folds get 21 valid rows (103 % 5 == 3)
        for i in range(3):
            assert result.folds[i].valid_size == 21
            assert result.folds[i].train_size == 82
        for i in range(3, 5):
            assert result.folds[i].valid_size == 20
            assert result.folds[i].train_size == 83

    def test_stratified_kfold(self) -> None:
        """Stratified KFold uses same arithmetic as plain KFold."""
        result = compute_split_preview(100, "stratified_kfold", 4)
        assert len(result.folds) == 4
        for fold in result.folds:
            assert fold.valid_size == 25
            assert fold.train_size == 75

    def test_group_kfold(self) -> None:
        result = compute_split_preview(50, "group_kfold", 5)
        assert result.strategy == "group_kfold"
        assert len(result.folds) == 5

    def test_stratified_group_kfold(self) -> None:
        result = compute_split_preview(50, "stratified_group_kfold", 5)
        assert result.strategy == "stratified_group_kfold"
        assert len(result.folds) == 5

    def test_total_rows_preserved(self) -> None:
        """Train + valid should cover all rows for each fold."""
        result = compute_split_preview(97, "kfold", 7)
        for fold in result.folds:
            assert fold.train_size + fold.valid_size == 97


class TestComputeSplitPreviewTimeSeries:
    """TimeSeriesSplit-family strategies."""

    def test_basic_time_series(self) -> None:
        result = compute_split_preview(100, "time_series", 4)
        assert result.strategy == "time_series"
        assert len(result.folds) == 4
        # test_size = 100 // (4+1) = 20
        assert result.folds[0].valid_size == 20
        assert result.folds[0].train_size == 20  # (1*20)
        assert result.folds[1].train_size == 40  # (2*20)
        assert result.folds[2].train_size == 60
        assert result.folds[3].train_size == 80

    def test_time_series_with_gap(self) -> None:
        result = compute_split_preview(100, "time_series", 4, gap=5)
        # train_size reduced by gap
        assert result.folds[0].train_size == 15  # 20 - 5
        assert result.folds[1].train_size == 35  # 40 - 5

    def test_time_series_with_max_train_size(self) -> None:
        result = compute_split_preview(100, "time_series", 4, max_train_size=30)
        assert result.folds[0].train_size == 20  # below cap
        assert result.folds[1].train_size == 30  # capped
        assert result.folds[2].train_size == 30  # capped
        assert result.folds[3].train_size == 30  # capped

    def test_time_series_with_max_test_size(self) -> None:
        result = compute_split_preview(100, "time_series", 4, max_test_size=10)
        for fold in result.folds:
            assert fold.valid_size == 10

    def test_purged_time_series(self) -> None:
        result = compute_split_preview(100, "purged_time_series", 3)
        assert result.strategy == "purged_time_series"
        assert len(result.folds) == 3

    def test_group_time_series(self) -> None:
        result = compute_split_preview(100, "group_time_series", 3)
        assert result.strategy == "group_time_series"
        assert len(result.folds) == 3

    def test_gap_larger_than_train_clamps_to_zero(self) -> None:
        result = compute_split_preview(100, "time_series", 4, gap=25)
        # fold 0: train would be 20 - 25 = -5, clamped to 0
        assert result.folds[0].train_size == 0
        assert result.folds[0].valid_size == 20


class TestComputeSplitPreviewBlockedGroup:
    """blocked_group_kfold returns empty folds (needs actual data)."""

    def test_returns_empty_folds(self) -> None:
        result = compute_split_preview(100, "blocked_group_kfold", 5)
        assert result.strategy == "blocked_group_kfold"
        assert result.n_splits == 5
        assert result.folds == []


class TestComputeSplitPreviewValidation:
    """Input validation."""

    def test_n_splits_less_than_2(self) -> None:
        with pytest.raises(ValueError, match="n_splits must be >= 2"):
            compute_split_preview(100, "kfold", 1)

    def test_n_rows_less_than_n_splits(self) -> None:
        with pytest.raises(ValueError, match="n_rows.*must be >= n_splits"):
            compute_split_preview(3, "kfold", 5)

    def test_unknown_strategy_returns_empty_folds(self) -> None:
        """Unknown strategy produces no folds (graceful degradation)."""
        result = compute_split_preview(100, "unknown_strategy", 5)
        assert result.folds == []


# ---------------------------------------------------------------------------
# Integration tests: GET /api/workspace/data/split-preview
# ---------------------------------------------------------------------------


def _create_csv(tmp_path: Path, n_rows: int = 100) -> str:
    csv_path = tmp_path / "train.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["feature", "target"])
        for i in range(n_rows):
            writer.writerow([i, i % 2])
    return str(csv_path)


def _load_and_configure(
    client: TestClient, csv_path: str, split_config: dict[str, Any] | None = None
) -> None:
    """Load data and set config with the given split settings."""
    client.post("/api/workspace/data/path", json={"path": csv_path})
    config: dict[str, Any] = {
        "config_version": 1,
        "task": "binary",
        "data": {"target": "target"},
        "model": {"name": "lgbm"},
        "split": split_config or {"method": "kfold", "n_splits": 5},
    }
    client.put("/api/workspace/config", json=config)


def test_split_preview_kfold(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path, n_rows=100)
    _load_and_configure(client, csv_path, {"method": "kfold", "n_splits": 5})
    res = client.get("/api/workspace/data/split-preview")
    assert res.status_code == 200
    body = res.json()
    assert body["strategy"] == "kfold"
    assert body["n_splits"] == 5
    assert len(body["folds"]) == 5
    assert body["folds"][0]["train_size"] == 80
    assert body["folds"][0]["valid_size"] == 20


def test_split_preview_time_series(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path, n_rows=60)
    _load_and_configure(
        client, csv_path, {"method": "time_series", "n_splits": 3, "gap": 2}
    )
    res = client.get("/api/workspace/data/split-preview")
    assert res.status_code == 200
    body = res.json()
    assert body["strategy"] == "time_series"
    assert len(body["folds"]) == 3
    # test_size = 60 // 4 = 15
    assert body["folds"][0]["valid_size"] == 15
    # train = 15 - 2(gap) = 13
    assert body["folds"][0]["train_size"] == 13


def test_split_preview_no_data(client: TestClient) -> None:
    res = client.get("/api/workspace/data/split-preview")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_DATA"


def test_split_preview_no_config(client: TestClient, tmp_path: Path) -> None:
    csv_path = _create_csv(tmp_path)
    client.post("/api/workspace/data/path", json={"path": csv_path})
    res = client.get("/api/workspace/data/split-preview")
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "WORKSPACE_NO_CONFIG"


def test_split_preview_blocked_group_returns_empty(
    client: TestClient, tmp_path: Path
) -> None:
    """blocked_group_kfold requires data-dependent columns, so we set config
    via a valid kfold first, then patch the method to blocked_group_kfold."""
    csv_path = _create_csv(tmp_path)
    _load_and_configure(client, csv_path, {"method": "kfold", "n_splits": 3})
    # Patch method to blocked_group_kfold via PATCH endpoint
    client.patch(
        "/api/workspace/config",
        json={
            "ops": [
                {"op": "set", "path": "split.method", "value": "blocked_group_kfold"}
            ]
        },
    )
    res = client.get("/api/workspace/data/split-preview")
    assert res.status_code == 200
    body = res.json()
    assert body["folds"] == []
