"""BackendAdapter Protocol — the contract between Service layer and ML backends."""

from __future__ import annotations

from typing import Any, Protocol

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


class BackendAdapter(Protocol):
    """ML backend interface.

    Adapters convert backend-specific types into the common types defined
    in ``backends.types``.  They must NOT hold HTTP / session / persistence
    knowledge.
    """

    # --- Identification ---

    @property
    def info(self) -> BackendInfo: ...

    # --- Config ---

    def get_config_schema(self) -> ConfigSchema: ...

    def get_ui_schema(self) -> dict[str, Any]:
        """Return UI metadata (parameter hints, option sets, etc.)."""
        ...

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
    ) -> TuningSummary:
        """Run hyperparameter tuning.

        When *re_tune* is provided, the adapter performs a multi-round
        tuning session on the same model instance, continuing the Optuna
        study across rounds and optionally expanding the search space at
        round boundaries.  The ``re_tune`` dict may contain:

        - ``n_rounds``: total number of tuning rounds (>= 1)
        - ``expand_boundary``: whether to expand the search space at
          round boundaries (bool, default True)
        - ``boundary_threshold``: relative distance from search-space
          boundary that triggers expansion (float in [0, 0.5))

        Legacy single-round tuning leaves ``TuningSummary.rounds`` and
        ``TuningSummary.boundary_report`` as ``None``.
        """
        ...

    def predict(
        self,
        model: Any,
        data: pd.DataFrame,
        *,
        return_shap: bool = False,
    ) -> PredictionSummary: ...

    # --- Evaluation ---

    def evaluate_table(self, model: Any) -> list[dict[str, Any]]: ...

    def split_summary(self, model: Any) -> list[dict[str, Any]]: ...

    def importance(self, model: Any, kind: str = "split") -> dict[str, float]: ...

    def importance_kinds(self, model: Any) -> list[str]:
        """Return the list of valid importance kind identifiers."""
        return ["split"]

    def learning_curve_metrics(self, model: Any) -> list[str]:
        """Return the metric names present in the learning curve history.

        The returned names are the exact values accepted by
        ``plot(model, "learning-curve", metrics=[...])``. They come from the
        actual training eval history, not from the user config — the two
        can diverge when the backend routes some metrics to feval callables
        or drops duplicates during training.
        """
        return []

    def confusion_matrix(
        self, model: Any, threshold: float = 0.5
    ) -> dict[str, Any]: ...

    def plot(self, model: Any, plot_type: str, **kwargs: Any) -> PlotData: ...

    def available_plots(self, model: Any) -> list[str]: ...

    # --- Persistence ---

    def export_model(self, model: Any, path: str) -> str:
        """Save model artifacts to *path*. Return the resolved path."""
        ...

    def export_code(self, model: Any, path: str) -> str:
        """Generate standalone Python code from *model* into *path*.

        Return the resolved path.
        """
        ...

    def load_model(self, path: str) -> Any:
        """Restore a model from an export directory."""
        ...

    def model_info(self, model: Any) -> dict[str, Any]:
        """Return model metadata (config, task, features, etc.)."""
        ...
