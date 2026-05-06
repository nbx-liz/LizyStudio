"""Tune persistent-storage passthrough tests (P-0099 v3-20b / R-1.4).

Coverage matrix:

  * **BackendAdapter Protocol contract** — the abstract ``tune``
    signature exposes ``storage`` and ``study_name`` keyword-only
    arguments with ``None`` defaults so existing callers see no
    behavior change.

  * **LizyML adapter passthrough** — the lizyml adapter forwards both
    arguments to ``model.tune`` only when at least one is non-None,
    keeping the call signature backward compatible with hypothetical
    future lizyml releases.

  * **services/training URL builder** — ``run_tune`` constructs the
    per-job ``sqlite:///{job_dir}/optuna.db`` URL plus the
    ``studio-tune-{job_id}`` study identifier and passes them through
    to ``backend.tune``.

These tests run against the production code paths but stub
``model.tune`` (lizyml internals) and ``BackendAdapter.tune``
(services) to keep the assertion focus on the wiring rather than the
ML internals.
"""

from __future__ import annotations

import inspect
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.lizyml import LizyMLAdapter
from lizystudio.backends.types import FitSummary, TuningSummary

pytestmark = pytest.mark.unit


# ---------------------------------------------------------------------------
# Protocol contract
# ---------------------------------------------------------------------------


def test_backend_adapter_tune_protocol_exposes_storage_kwargs() -> None:
    """``BackendAdapter.tune`` must declare ``storage`` and
    ``study_name`` as optional keyword-only arguments with ``None``
    defaults.

    A future Adapter implementation that breaks this contract (e.g.
    drops the kwargs or makes them positional) would silently change
    semantics for ``services/training.run_tune``; this test pins the
    signature.
    """
    sig = inspect.signature(BackendAdapter.tune)
    params = sig.parameters

    assert "storage" in params, "BackendAdapter.tune must accept storage"
    assert "study_name" in params, "BackendAdapter.tune must accept study_name"

    storage_param = params["storage"]
    study_name_param = params["study_name"]

    assert storage_param.kind == inspect.Parameter.KEYWORD_ONLY
    assert study_name_param.kind == inspect.Parameter.KEYWORD_ONLY
    assert storage_param.default is None
    assert study_name_param.default is None


# ---------------------------------------------------------------------------
# LizyML adapter passthrough
# ---------------------------------------------------------------------------


def _make_mock_tune_result() -> MagicMock:
    return MagicMock(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )


def test_lizyml_adapter_omits_storage_kwargs_when_both_none() -> None:
    """When ``storage`` and ``study_name`` are both ``None``, the
    adapter MUST NOT include them in ``model.tune`` kwargs so the
    legacy in-memory study path is preserved bit-for-bit.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _make_mock_tune_result()

    adapter.tune(mock_model)

    mock_model.tune.assert_called_once()
    _, kwargs = mock_model.tune.call_args
    assert "storage" not in kwargs, (
        "Legacy in-memory path must NOT pass storage to lizyml — saw "
        f"{kwargs.get('storage')!r}"
    )
    assert "study_name" not in kwargs


def test_lizyml_adapter_passes_storage_and_study_name_through() -> None:
    """When both arguments are provided, they MUST appear in
    ``model.tune`` kwargs verbatim.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _make_mock_tune_result()

    adapter.tune(
        mock_model,
        storage="sqlite:///tmp/test.db",
        study_name="studio-tune-abc",
    )

    mock_model.tune.assert_called_once()
    _, kwargs = mock_model.tune.call_args
    assert kwargs.get("storage") == "sqlite:///tmp/test.db"
    assert kwargs.get("study_name") == "studio-tune-abc"


def test_lizyml_adapter_passes_storage_when_only_one_set() -> None:
    """If only ``storage`` is provided (a misuse case), the adapter
    still forwards both kwargs so lizyml can validate / reject. The
    adapter does NOT silently drop a half-specified pair — the
    caller's intent should reach the backend's validation layer.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _make_mock_tune_result()

    adapter.tune(mock_model, storage="sqlite:///tmp/x.db")

    _, kwargs = mock_model.tune.call_args
    assert "storage" in kwargs
    assert kwargs["storage"] == "sqlite:///tmp/x.db"
    assert "study_name" in kwargs
    assert kwargs["study_name"] is None


def test_lizyml_adapter_storage_kwargs_propagate_through_re_tune_rounds() -> None:
    """In a multi-round re-tune flow the storage identity MUST stay
    consistent across rounds so Optuna re-attaches to the same study.
    """
    adapter = LizyMLAdapter()
    mock_model = MagicMock()
    mock_model.tune.return_value = _make_mock_tune_result()

    re_tune = {"n_rounds": 3, "n_trials": 5}
    adapter.tune(
        mock_model,
        re_tune=re_tune,
        storage="sqlite:///tmp/rt.db",
        study_name="studio-tune-rt",
    )

    # 3 rounds = 3 model.tune() calls, each carrying the same storage
    # identity.
    assert mock_model.tune.call_count == 3
    for call in mock_model.tune.call_args_list:
        _, kwargs = call
        assert kwargs.get("storage") == "sqlite:///tmp/rt.db", (
            "Optuna study identity must be stable across re-tune rounds"
        )
        assert kwargs.get("study_name") == "studio-tune-rt"


# ---------------------------------------------------------------------------
# services/training URL builders
# ---------------------------------------------------------------------------


def test_build_optuna_storage_url_per_job(tmp_path: Path) -> None:
    """``_build_optuna_storage_url`` produces a per-job sqlite URL
    rooted at ``{job_dir}/optuna.db`` with the ``sqlite:///`` prefix
    that Optuna expects.
    """
    from lizystudio.services.training import _build_optuna_storage_url

    job_dir = tmp_path / "jobs" / "abc"
    job_dir.mkdir(parents=True)

    url = _build_optuna_storage_url(job_dir)

    assert url.startswith("sqlite:///"), (
        f"Optuna SQLite URL must use the three-slash form; got {url!r}"
    )
    # Trailing absolute path resolves under the job dir (not a
    # relative path that could escape on a chdir).
    expected = (job_dir / "optuna.db").resolve()
    assert url == f"sqlite:///{expected}"


def test_build_optuna_study_name_uses_job_id_prefix() -> None:
    """``_build_optuna_study_name`` produces ``studio-tune-{job_id}``
    so a casual SQLite inspection can identify LizyStudio's studies.
    """
    from lizystudio.services.training import _build_optuna_study_name

    name = _build_optuna_study_name("xyz-123")
    assert name == "studio-tune-xyz-123"


def test_run_tune_passes_storage_kwargs_to_backend(tmp_path: Path) -> None:
    """End-to-end: ``run_tune`` constructs the per-job URL +
    study_name and forwards both to ``backend.tune``.

    Stubs the backend (so no real ML work) and asserts the kwargs
    carry the per-job SQLite URL plus the matching ``studio-tune-``
    identifier.
    """
    from lizystudio.backends.types import DataRef
    from lizystudio.services.jobs import JobStore
    from lizystudio.services.training import run_tune

    job_store = JobStore(tmp_path / "jobs")
    job = job_store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="tune",
    )
    assert job is not None

    backend = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.tune.return_value = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )
    backend.fit.return_value = FitSummary(metrics={}, fold_count=1, params=[])
    backend.export_model = MagicMock()
    # _save_tuning_plot calls backend.plot(...).plotly_json — provide a
    # string so Path.write_text accepts it. The plot persistence is a
    # side concern of run_tune; the storage-passthrough invariant under
    # test does not depend on its content.
    backend.plot.return_value = MagicMock(plotly_json="{}")

    config = {
        "task": "binary",
        "data": {"target": "y"},
        "evaluation": {"metrics": ["auc"]},
        "tuning": {"optuna": {"params": {"n_trials": 5}, "space": {}}},
    }

    run_tune(
        job=job,
        job_store=job_store,
        backend=backend,
        config=config,
        dataframe=MagicMock(),
        broadcaster=None,
    )

    backend.tune.assert_called_once()
    _, kwargs = backend.tune.call_args

    expected_url = (
        f"sqlite:///{(job_store.job_dir(job.job_id) / 'optuna.db').resolve()}"
    )
    expected_study = f"studio-tune-{job.job_id}"

    assert kwargs.get("storage") == expected_url, (
        f"run_tune must pass per-job sqlite URL; saw {kwargs.get('storage')!r}"
    )
    assert kwargs.get("study_name") == expected_study, (
        f"run_tune must pass studio-tune-{{job_id}}; saw {kwargs.get('study_name')!r}"
    )


# ---------------------------------------------------------------------------
# Re-tune path keeps the legacy in-memory behavior (out of v3-20b scope).
# ---------------------------------------------------------------------------


def test_run_retune_does_not_pass_storage_kwargs_yet(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Re-tune (H-0062) is intentionally left on the legacy in-memory
    study path until v0.6+ harmonisation. The v3-20b scope only
    covers fresh tune jobs (R-1.4); a future PR (likely v0.6) will
    decide whether to plumb storage into re-tune as well.

    Pin: ``backend.tune`` called from ``run_retune`` MUST NOT carry
    ``storage`` / ``study_name`` so the existing model.pkl-based
    Optuna study continuation keeps working.
    """
    from lizystudio.backends.types import DataRef
    from lizystudio.services.jobs import JobStore
    from lizystudio.services.training_retune import run_retune

    job_store = JobStore(tmp_path / "jobs")
    parent = job_store.create_and_claim_active(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="tune",
    )
    assert parent is not None
    parent.status = "completed"
    job_store.update(parent)
    job_store.release_active(parent.job_id)
    parent_dir = job_store.job_dir(parent.job_id)
    (parent_dir / "model.pkl").write_bytes(b"stub")

    child = job_store.create(
        backend_name="lizyml",
        config=parent.config,
        data_ref=parent.data_ref,
        job_type="tune",
        parent_job_id=parent.job_id,
    )
    assert job_store.claim_active(child.job_id)

    backend = MagicMock()
    backend.load_checkpoint.return_value = MagicMock()
    backend.create_model.return_value = MagicMock()
    backend.tune.return_value = TuningSummary(
        best_params={"lr": 0.1},
        best_score=0.9,
        trials=[],
        metric_name="auc",
        direction="maximize",
    )
    backend.fit.return_value = FitSummary(metrics={}, fold_count=1, params=[])
    backend.export_model = MagicMock()
    backend.plot.return_value = MagicMock(plotly_json="{}")

    # Bypass the pickle preflight + checkpoint copy via the
    # ``monkeypatch`` fixture so pytest auto-restores at teardown
    # and the patches do not leak into other tests
    # (see test_training_service.py:test_run_retune_*).
    monkeypatch.setattr(
        "lizystudio.services.training_retune._copy_checkpoint_to_child",
        MagicMock(),
    )
    monkeypatch.setattr(
        "lizystudio.services.training_retune._run_pickle_preflight",
        MagicMock(),
    )

    run_retune(
        parent_job=parent,
        child_job=child,
        job_store=job_store,
        backend=backend,
        dataframe=MagicMock(),
        n_trials=3,
        expand_boundary=None,
        boundary_threshold=None,
        broadcaster=None,
    )

    backend.tune.assert_called()
    for call in backend.tune.call_args_list:
        _, kwargs = call
        assert "storage" not in kwargs, (
            "Re-tune must keep using the legacy in-memory study; "
            f"saw storage={kwargs.get('storage')!r}"
        )
        assert "study_name" not in kwargs, (
            f"saw study_name={kwargs.get('study_name')!r}"
        )
