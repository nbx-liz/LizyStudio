"""BackendAdapter Protocol — the contract between Service layer and ML backends.

H-0068 splits the previously monolithic ``BackendAdapter`` into five
capability-focused Protocols.  ``BackendAdapter`` itself remains a
runtime-checkable alias that inherits from all of them, so existing
``adapter: BackendAdapter`` type annotations keep working.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import pandas as pd

from lizystudio.backends.types import (
    BackendInfo,
    ConfigSchema,
    FitSummary,
    PlotData,
    PredictionSummary,
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
    ) -> TuningSummary:
        """Run hyperparameter tuning.  See H-0061 / H-0062 for kwargs."""
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
