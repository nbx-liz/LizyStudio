"""Integration regression test for C-9 / H-0081.

Ensures a workspace written before ``format_version`` landed (so
meta.json has no version key) still loads through ``JobStore`` and
``InferenceStore``. The read path routes through
:func:`lizystudio.storage.versions.read_versioned_json`, which must
treat a missing key as v0 and run the identity migration so the
dataclass reconstruction keeps working.

This is the acceptance-criteria (b) proof: existing v0 workspaces
remain loadable after C-9 ships.
"""

from __future__ import annotations

import json
from pathlib import Path


def _write_legacy_meta(path: Path, data: dict[str, object]) -> None:
    """Emulate pre-C-9 meta.json (no ``format_version`` key)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")


def test_job_store_loads_v0_meta_without_format_version(
    tmp_path: Path,
) -> None:
    from lizystudio.services.jobs import JobStore

    # Populate a fake job dir in pre-C-9 layout — no format_version key.
    jobs_dir = tmp_path / "jobs"
    job_id = "legacy_job_abc"
    job_dir = jobs_dir / job_id
    legacy_meta = {
        "job_id": job_id,
        "status": "completed",
        "backend_name": "lizyml",
        "config": {"task": "binary", "model": {"name": "lightgbm"}},
        "data_ref": {
            "source_type": "path",
            "path": "/data/train.csv",
            "filename": "train.csv",
            "fingerprint": "abc",
            "shape": [100, 5],
        },
        "job_type": "fit",
        "created_at": "2026-04-01T00:00:00+00:00",
        "completed_at": "2026-04-01T00:05:00+00:00",
        "model_path": None,
        "error": None,
        "parent_job_id": None,
    }
    _write_legacy_meta(job_dir / "meta.json", legacy_meta)

    store = JobStore(jobs_dir=jobs_dir)
    job = store.get(job_id)
    assert job is not None
    assert job.job_id == job_id
    assert job.status == "completed"
    assert job.backend_name == "lizyml"
    assert job.data_ref.shape == (100, 5)


def test_inference_store_loads_v0_meta_without_format_version(
    tmp_path: Path,
) -> None:
    from lizystudio.services.inference import InferenceStore

    jobs_dir = tmp_path / "jobs"
    job_id = "legacy_job_abc"
    inf_id = "inf_xyz"
    inf_dir = jobs_dir / job_id / "inferences" / inf_id
    legacy_meta = {
        "inf_id": inf_id,
        "job_id": job_id,
        "data_ref": {
            "source_type": "path",
            "path": "/data/test.csv",
            "filename": "test.csv",
            "fingerprint": "def",
            "shape": [50, 5],
        },
        "has_ground_truth": False,
        "created_at": "2026-04-01T00:10:00+00:00",
        "row_count": 50,
        "warnings": [],
    }
    _write_legacy_meta(inf_dir / "meta.json", legacy_meta)

    store = InferenceStore(jobs_dir=jobs_dir)
    record = store.get(job_id, inf_id)
    assert record is not None
    assert record.inf_id == inf_id
    assert record.data_ref.shape == (50, 5)
    assert record.row_count == 50
