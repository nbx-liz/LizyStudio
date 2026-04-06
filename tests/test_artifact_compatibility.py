"""Artifact versioning and backward compatibility tests.

Ensures that meta.json, fit_result.json, and tune_result.json schemas
remain backward-compatible across versions.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from lizystudio.backends.types import DataRef, FitSummary, TuningSummary
from lizystudio.services.jobs import Job, JobStore


@pytest.fixture()
def store(tmp_path: Path) -> JobStore:
    return JobStore(tmp_path / "jobs")


def _make_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/tmp/data.csv",
        filename="data.csv",
        fingerprint="abc123",
        shape=(100, 5),
    )


def _create_completed_job(store: JobStore) -> Job:
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "target": "y"},
        data_ref=_make_data_ref(),
        job_type="fit",
    )
    job.status = "completed"
    job.completed_at = "2026-04-06T00:00:00+00:00"
    job.model_path = str(store.jobs_dir / job.job_id / "model")
    job.fit_result = FitSummary(
        metrics={"accuracy": 0.95, "logloss": 0.15},
        fold_count=5,
        params=[{"lr": 0.01, "depth": 6}],
    )
    store.update(job)
    return job


# --- meta.json schema ---


class TestMetaJsonSchema:
    """Verify meta.json contains all required fields."""

    def test_meta_json_required_fields(self, store: JobStore) -> None:
        """meta.json has all required fields after create."""
        job = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        meta_path = store.jobs_dir / job.job_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        required_fields = [
            "job_id",
            "status",
            "backend_name",
            "config",
            "data_ref",
            "job_type",
            "created_at",
        ]
        for field in required_fields:
            assert field in meta, f"Missing required field: {field}"

    def test_meta_json_optional_fields_present(self, store: JobStore) -> None:
        """meta.json includes nullable optional fields."""
        job = store.create(
            backend_name="lizyml",
            config={},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        meta_path = store.jobs_dir / job.job_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        optional_fields = ["completed_at", "model_path", "error"]
        for field in optional_fields:
            assert field in meta, f"Missing optional field: {field}"

    def test_meta_json_data_ref_structure(self, store: JobStore) -> None:
        """data_ref in meta.json has the expected structure."""
        job = store.create(
            backend_name="lizyml",
            config={},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        meta_path = store.jobs_dir / job.job_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))

        data_ref = meta["data_ref"]
        assert data_ref["source_type"] == "path"
        assert data_ref["filename"] == "data.csv"
        assert data_ref["fingerprint"] == "abc123"
        assert data_ref["shape"] == [100, 5]  # JSON serializes tuple as list


# --- Backward compatibility ---


class TestBackwardCompatibility:
    """Ensure older meta.json formats can still be loaded."""

    def test_missing_optional_fields_load_as_none(self, store: JobStore) -> None:
        """meta.json without model_path/error loads with None defaults."""
        job = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        # Write a minimal meta.json without optional fields
        meta_path = store.jobs_dir / job.job_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        del meta["model_path"]
        del meta["error"]
        del meta["completed_at"]
        meta_path.write_text(json.dumps(meta), encoding="utf-8")

        reloaded = store.get(job.job_id)
        assert reloaded is not None
        assert reloaded.model_path is None
        assert reloaded.error is None
        assert reloaded.completed_at is None

    def test_extra_fields_in_meta_ignored(self, store: JobStore) -> None:
        """meta.json with unknown fields does not cause errors."""
        job = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_make_data_ref(),
            job_type="fit",
        )
        meta_path = store.jobs_dir / job.job_id / "meta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta["future_field"] = "some_value"
        meta["another_new_field"] = 42
        meta_path.write_text(json.dumps(meta), encoding="utf-8")

        # _load_job uses explicit field extraction, so extra fields should be ignored
        reloaded = store.get(job.job_id)
        assert reloaded is not None
        assert reloaded.job_id == job.job_id


# --- Round-trip tests ---


class TestRoundTrip:
    """Verify save -> load round-trip preserves all data."""

    def test_meta_roundtrip(self, store: JobStore) -> None:
        """Job metadata survives a create -> get round-trip."""
        job = _create_completed_job(store)
        reloaded = store.get(job.job_id)

        assert reloaded is not None
        assert reloaded.job_id == job.job_id
        assert reloaded.status == job.status
        assert reloaded.backend_name == job.backend_name
        assert reloaded.config == job.config
        assert reloaded.job_type == job.job_type
        assert reloaded.created_at == job.created_at
        assert reloaded.completed_at == job.completed_at
        assert reloaded.model_path == job.model_path
        assert reloaded.error == job.error

    def test_data_ref_shape_tuple_after_roundtrip(self, store: JobStore) -> None:
        """DataRef.shape is restored as tuple after JSON round-trip."""
        job = _create_completed_job(store)
        reloaded = store.get(job.job_id)

        assert reloaded is not None
        assert isinstance(reloaded.data_ref.shape, tuple)
        assert reloaded.data_ref.shape == (100, 5)

    def test_data_ref_full_roundtrip(self, store: JobStore) -> None:
        """All DataRef fields survive round-trip."""
        job = _create_completed_job(store)
        reloaded = store.get(job.job_id)

        assert reloaded is not None
        assert reloaded.data_ref.source_type == "path"
        assert reloaded.data_ref.path == "/tmp/data.csv"
        assert reloaded.data_ref.filename == "data.csv"
        assert reloaded.data_ref.fingerprint == "abc123"

    def test_fit_result_roundtrip(self, store: JobStore) -> None:
        """FitSummary survives update -> get round-trip."""
        job = _create_completed_job(store)
        reloaded = store.get(job.job_id)

        assert reloaded is not None
        assert reloaded.fit_result is not None
        assert reloaded.fit_result.metrics == {"accuracy": 0.95, "logloss": 0.15}
        assert reloaded.fit_result.fold_count == 5
        assert reloaded.fit_result.params == [{"lr": 0.01, "depth": 6}]

    def test_tune_result_roundtrip(self, store: JobStore) -> None:
        """TuningSummary survives update -> get round-trip."""
        job = store.create(
            backend_name="lizyml",
            config={"task": "binary"},
            data_ref=_make_data_ref(),
            job_type="tune",
        )
        job.status = "completed"
        job.tune_result = TuningSummary(
            best_params={"lr": 0.001, "depth": 8},
            best_score=0.98,
            trials=[
                {"trial": 1, "score": 0.95, "params": {"lr": 0.01}},
                {"trial": 2, "score": 0.98, "params": {"lr": 0.001}},
            ],
            metric_name="accuracy",
            direction="maximize",
        )
        store.update(job)

        reloaded = store.get(job.job_id)
        assert reloaded is not None
        assert reloaded.tune_result is not None
        assert reloaded.tune_result.best_score == 0.98
        assert reloaded.tune_result.best_params == {"lr": 0.001, "depth": 8}
        assert reloaded.tune_result.metric_name == "accuracy"
        assert reloaded.tune_result.direction == "maximize"
        assert len(reloaded.tune_result.trials) == 2

    def test_fit_result_json_schema(self, store: JobStore) -> None:
        """fit_result.json has the expected structure."""
        job = _create_completed_job(store)
        fit_path = store.jobs_dir / job.job_id / "fit_result.json"
        data = json.loads(fit_path.read_text(encoding="utf-8"))

        assert "metrics" in data
        assert "fold_count" in data
        assert "params" in data
        assert isinstance(data["metrics"], dict)
        assert isinstance(data["fold_count"], int)
        assert isinstance(data["params"], list)

    def test_tune_result_json_schema(self, store: JobStore) -> None:
        """tune_result.json has the expected structure."""
        job = store.create(
            backend_name="lizyml",
            config={},
            data_ref=_make_data_ref(),
            job_type="tune",
        )
        job.tune_result = TuningSummary(
            best_params={"lr": 0.01},
            best_score=0.9,
            trials=[],
            metric_name="accuracy",
            direction="maximize",
        )
        store.update(job)

        tune_path = store.jobs_dir / job.job_id / "tune_result.json"
        data = json.loads(tune_path.read_text(encoding="utf-8"))

        assert "best_params" in data
        assert "best_score" in data
        assert "trials" in data
        assert "metric_name" in data
        assert "direction" in data


# --- Upload DataRef round-trip ---


class TestUploadDataRefRoundTrip:
    """Verify upload-type DataRef round-trips correctly."""

    def test_upload_data_ref_roundtrip(self, store: JobStore) -> None:
        """Upload-sourced DataRef preserves source_type after round-trip."""
        upload_ref = DataRef(
            source_type="upload",
            path="/tmp/upload_abc123.csv",
            filename="my_data.csv",
            fingerprint="def456",
            shape=(50, 3),
        )
        job = store.create(
            backend_name="lizyml",
            config={},
            data_ref=upload_ref,
            job_type="fit",
        )
        reloaded = store.get(job.job_id)
        assert reloaded is not None
        assert reloaded.data_ref.source_type == "upload"
        assert reloaded.data_ref.filename == "my_data.csv"
        assert reloaded.data_ref.shape == (50, 3)
