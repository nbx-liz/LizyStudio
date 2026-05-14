"""BackendAdapter Protocol — the contract between Service layer and ML backends.

H-0068 splits the previously monolithic ``BackendAdapter`` into five
capability-focused Protocols.  ``BackendAdapter`` itself remains a
runtime-checkable alias that inherits from all of them, so existing
``adapter: BackendAdapter`` type annotations keep working.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol, runtime_checkable

import pandas as pd

from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    FitSummary,
    IncompatibleMetric,
    PlotData,
    PredictionSummary,
    TuningConfig,
    TuningDefaults,
    TuningOverrides,
    TuningSummary,
)


class ProgressCallback(Protocol):
    """Callable invoked by long-running operations to report progress.

    When *total* is ``0``, the operation length is unknown and the
    UI should display an indeterminate indicator (e.g. a pulsing bar).
    """

    def __call__(
        self, *, current: int, total: int, message: str, **extra: Any
    ) -> None: ...


# --------------------------------------------------------------------------- #
#  Split capability Protocols (H-0068)
# --------------------------------------------------------------------------- #


@runtime_checkable
class BackendCore(Protocol):
    """Core ML lifecycle: identification, config, training, inference, persistence.

    A minimal backend only needs to satisfy this Protocol to boot inside
    LizyStudio.  Evaluation / plotting / code export / UI schema are
    separate opt-in capabilities declared below.
    """

    # --- Identification ---

    @property
    def info(self) -> BackendInfo: ...

    # --- Config ---

    def get_config_schema(self) -> ConfigSchema: ...

    def validate_config(self, config: dict[str, Any]) -> list[dict[str, Any]]:
        """Return a list of validation errors (empty == valid)."""
        ...

    def get_incompatible_metrics(
        self,
        task: str,
        target_series: pd.Series,
        metric_names: set[str],
    ) -> list[IncompatibleMetric]:
        """Advisory: configured metrics whose preconditions the target violates.

        Called by ``Service.validate_config`` once it has confirmed a target
        column is loaded — *task* is the configured task (``"regression"`` /
        ``"binary"`` / ``"multiclass"`` / ``""`` if absent), *target_series*
        the loaded column, *metric_names* the set of metric names parsed from
        ``evaluation.metrics``. The backend owns which of those names have
        target preconditions (e.g. lizyml: MAPE undefined on zeros, RMSLE on
        negatives, R² on a constant target) and the ``suggested_fix`` text,
        which may reference backend-specific replacements.

        The Service wraps each entry in a ``severity="warning"`` envelope; it
        does not block Fit. A minimal backend declares no incompatibilities
        (default below).
        """
        return []

    def validate_search_space(self, space: dict[str, Any]) -> list[dict[str, Any]]:
        """Structural validation of an Optuna ``tuning.optuna.space`` dict.

        Called by ``Service.validate_search_space_for_tune`` from the
        ``POST /tune`` run-gate (P-0108, Issue #474). The role is to
        reject search-space entries that the backend cannot evaluate
        even in principle — e.g. lizyml's ``parse_space()`` rejects an
        inverted Range (``low >= high``) or a log distribution with
        non-positive lower bound. Without this gate the bad space slips
        past ``validate_config`` and only blows up deep inside the
        tuning loop as "All tuning trials failed".

        Returns ``[{path, message, severity, suggested_fix}]`` entries
        mirroring the ``validate_config`` envelope (P-0100), with one
        important shape constraint:

        - ``path`` always starts with ``"tuning.optuna.space.<param>"``
          so the frontend can surface the message next to the offending
          row.
        - ``severity`` is ``"error"`` (run-gate is blocking, unlike the
          metric-compat warnings).

        **Out of scope.** Empty-choices categoricals are NOT a backend
        responsibility: the frontend's ``empty-choice-banner`` already
        owns that UX (transient editing state, Tune button disabled).
        The backend MUST filter that case out of the returned list so a
        legitimately-empty WIP categorical does not produce a 400 on the
        run-gate. See PR #473 (Wave 3.1a) post-mortem.

        A minimal backend (or one that does not use Optuna-style search
        spaces) returns ``[]`` (the default below).
        """
        return []

    def get_tuning_defaults(self, task: str) -> TuningDefaults:
        """Return canonical Tune defaults for *task* (P-0109).

        The backend reads its own catalog (e.g. lizyml's
        ``search_space_catalog``, ``metric_direction``, canonical
        ``TASK_DEFAULT_METRICS``) and produces a
        :class:`~lizystudio.backends.types.TuningDefaults` describing
        the search space, evaluation metric list, and optimisation
        direction that the Tune tab should fall back to when the user
        has set no overrides.

        Used by the service layer in two places:

        1. ``GET /workspace/config`` response assembly — together with
           ``compute_effective_tuning(task, overrides)`` to project the
           workspace's persisted ``TuningOverrides`` into an effective
           ``TuningConfig`` the frontend can render directly.
        2. ``POST /workspace/tune`` — same projection, plus the
           resulting effective is snapshot-frozen into
           ``job.config.tuning`` (INV-T6: a job's config remains stable
           even as the catalog later evolves).

        A minimal backend (no Optuna catalog, no per-task metric set)
        returns ``TuningDefaults()`` — the empty defaults the trivial
        impl below provides. The effective Tune config for such a
        backend therefore equals the user's overrides verbatim.

        INV-T3 (P-0109): ``direction`` here is the single source of
        truth. ``services/training.py::_prepare_tune_config`` MUST NOT
        carry a duplicated maximize-metric set; instead it asserts the
        in-flight effective config's direction agrees with this method
        and fails fast on drift.

        INV-T5 (P-0109): each backend adapter is the SSOT for its own
        defaults. Frontend has no adapter-specific branches.
        """
        return TuningDefaults()

    def compute_effective_tuning(
        self, task: str, overrides: TuningOverrides
    ) -> TuningConfig:
        """Merge ``TuningDefaults(task)`` with *overrides* (P-0109).

        Pure function: same ``(task, overrides)`` always produces the
        same effective ``TuningConfig``. Side-effect free, no IO. The
        merge rule is per-field:

        - ``n_trials`` / ``timeout`` / ``direction``: override wins when
          present in ``overrides.model_fields_set``; otherwise fall back
          to the corresponding ``TuningDefaults`` field (or a sane
          backend-specific fallback like ``n_trials = 50`` when both
          override and default are absent).
        - ``space``: per-key dict merge — ``overrides.space[k]`` wins
          outright over ``defaults.space[k]``; keys present only in
          defaults survive; keys present only in overrides (e.g. user
          added a catalog-outside parameter via raw YAML import) also
          survive (INV-T2: catalog evolution never silently drops user
          customisations).
        - ``evaluation_metrics``: list-level — when
          ``overrides.evaluation_metrics`` is non-None, replace the
          list; otherwise use ``defaults.evaluation_metrics``.
        - ``user_set_paths``: derived from
          ``overrides.model_fields_set`` plus per-key entries for
          ``space`` overrides, formatted as dot-paths (``"n_trials"``,
          ``"space.learning_rate"``, etc.).

        The trivial impl below covers a minimal backend with no catalog
        and no metric registry — it constructs the effective config
        from overrides alone with hardcoded fallbacks (``n_trials=50``
        / ``direction="minimize"``). Real adapters override this to
        consult their catalog and registry.
        """
        defaults = self.get_tuning_defaults(task)
        fields_set = overrides.model_fields_set
        user_set: list[str] = []
        for name in ("n_trials", "timeout", "direction", "evaluation_metrics"):
            if name in fields_set:
                user_set.append(name)
        for key in overrides.space:
            user_set.append(f"space.{key}")
        merged_space = {**defaults.space, **overrides.space}
        merged_metrics = (
            overrides.evaluation_metrics
            if overrides.evaluation_metrics is not None
            else defaults.evaluation_metrics
        )
        direction: Literal["maximize", "minimize"]
        if overrides.direction is not None:
            direction = overrides.direction
        elif defaults.direction is not None:
            direction = defaults.direction
        else:
            direction = "minimize"
        return TuningConfig(
            n_trials=overrides.n_trials if overrides.n_trials is not None else 50,
            timeout=overrides.timeout if "timeout" in fields_set else None,
            direction=direction,
            space=merged_space,
            evaluation_metrics=merged_metrics,
            user_set_paths=user_set,
        )

    def get_default_config(self, task: str, target: str) -> dict[str, Any]:
        """Return a complete valid config with all defaults."""
        ...

    def load_config_from_file(self, content: bytes, filename: str) -> dict[str, Any]:
        """Parse YAML / JSON bytes into a config dict."""
        ...

    # --- Model lifecycle ---

    def create_model(self, config: dict[str, Any], dataframe: pd.DataFrame) -> Any:
        """Create an internal model object (opaque to callers)."""
        ...

    def fit(
        self,
        model: Any,
        *,
        params: dict[str, Any] | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> FitSummary: ...

    def tune(
        self,
        model: Any,
        *,
        on_progress: ProgressCallback | None = None,
        re_tune: dict[str, Any] | None = None,
        checkpoint_dir: Any = None,
        resume: bool = False,
        storage: str | None = None,
        study_name: str | None = None,
    ) -> TuningSummary:
        """Run hyperparameter tuning.

        See H-0061 / H-0062 for ``re_tune`` / ``checkpoint_dir`` / ``resume``.

        ``storage`` and ``study_name`` (P-0099 v3-20b / R-1.4) are passed
        through to the backend's tuner so trial state is persisted to a
        durable, on-disk Optuna storage instead of an in-memory study.
        ``None`` (default) preserves the legacy in-memory behavior so
        existing callers and tests remain unchanged.

        Adapters that do not support persistent storage MUST raise
        :class:`NotImplementedError` when *storage* is non-None and
        document the limitation in their adapter README. The lizyml
        adapter accepts any URL form supported by Optuna 0.12.0+
        (e.g. ``"sqlite:///path/to.db"``).
        """
        ...

    def predict(
        self,
        model: Any,
        data: pd.DataFrame,
        *,
        return_shap: bool = False,
    ) -> PredictionSummary: ...

    # --- Checkpoint persistence (H-0062) ---

    def save_checkpoint(self, model: Any, path: Any) -> None:
        """Atomically persist an in-flight *model* into *path* as a pickle."""
        ...

    def load_checkpoint(self, path: Any, *, allowed_root: Any | None = None) -> Any:
        """Load a previously saved checkpoint from *path*.

        When *allowed_root* is supplied the resolved target must live
        within it — adapters should raise :class:`ValueError` otherwise.
        """
        ...

    def verify_checkpoint_compatibility(self, job_dir: Any) -> None:
        """Verify that a checkpoint at *job_dir* can be loaded (H-0068).

        Inspect backend-specific sidecar metadata (e.g. ``model_meta.json``)
        and raise :class:`~lizystudio.backends.exceptions.CheckpointIncompatibleError`
        when schema or runtime versions disagree.

        Missing sidecars are tolerated (legacy checkpoints pre-H-0062
        simply have none).  This method is a no-op in that case.
        """
        ...

    def preflight_checkpoint_dir(self, job_dir: Any) -> None:
        """Fail fast before tune if *job_dir* cannot host a checkpoint (H-0068).

        Adapters implement backend-specific sanity checks — e.g. that
        the dir is writable and the serialization library (cloudpickle,
        joblib, onnx, ...) can round-trip a sentinel object.  Raise
        :class:`~lizystudio.backends.exceptions.CheckpointPreflightError`
        on failure; the service layer translates that into the
        API-facing ``PICKLE_PREFLIGHT_FAILED`` envelope.
        """
        ...

    # --- Persistence ---

    def export_model(self, model: Any, path: str) -> str:
        """Save model artifacts to *path*. Return the resolved path."""
        ...

    def load_model(self, path: str) -> Any:
        """Restore a model from an export directory."""
        ...

    def model_info(self, model: Any) -> dict[str, Any]:
        """Return model metadata (config, task, features, etc.)."""
        ...


@runtime_checkable
class BackendEvaluator(Protocol):
    """Post-training evaluation + interpretation capability."""

    def evaluate_table(self, model: Any) -> list[dict[str, Any]]: ...

    def split_summary(self, model: Any) -> list[dict[str, Any]]: ...

    def importance(self, model: Any, kind: str = "split") -> dict[str, float]: ...

    def importance_kinds(self, model: Any) -> list[str]:
        """Return the list of valid importance kind identifiers."""
        ...

    def learning_curve_metrics(self, model: Any) -> list[str]:
        """Return the metric names present in the learning curve history."""
        ...

    def confusion_matrix(
        self, model: Any, threshold: float = 0.5
    ) -> dict[str, Any]: ...


@runtime_checkable
class BackendPlotter(Protocol):
    """Plotly figure generation capability."""

    def plot(self, model: Any, plot_type: str, **kwargs: Any) -> PlotData: ...

    def available_plots(self, model: Any) -> list[str]: ...


@runtime_checkable
class BackendCodeExporter(Protocol):
    """Stand-alone Python code export capability."""

    def export_code(self, model: Any, path: str) -> str:
        """Generate standalone Python code from *model* into *path*."""
        ...


@runtime_checkable
class BackendUiSchemaProvider(Protocol):
    """UI metadata provider capability (H-0026, H-0055)."""

    def get_ui_schema(self) -> dict[str, Any]:
        """Return UI metadata (parameter hints, option sets, etc.)."""
        ...


# --------------------------------------------------------------------------- #
#  Aggregate contract (backwards-compat alias)
# --------------------------------------------------------------------------- #


@runtime_checkable
class BackendAdapter(
    BackendCore,
    BackendEvaluator,
    BackendPlotter,
    BackendCodeExporter,
    BackendUiSchemaProvider,
    Protocol,
):
    """Full-capability backend.

    Inherits every split Protocol so ``adapter: BackendAdapter`` type
    annotations and ``isinstance(x, BackendAdapter)`` checks keep
    working unchanged.  A second backend that only satisfies
    :class:`BackendCore` can still be registered via
    :func:`lizystudio.backends.registry.register_backend`, but callers
    that ask for the aggregate alias will type-error against it — which
    is the intended design.
    """


__all__ = [
    "BackendAdapter",
    "BackendCodeExporter",
    "BackendCore",
    "BackendEvaluator",
    "BackendPlotter",
    "BackendUiSchemaProvider",
    "ProgressCallback",
]
