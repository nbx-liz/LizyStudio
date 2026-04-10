# Adapter Implementation Guide

This guide explains how to add a new ML backend to LizyStudio by implementing
the `BackendAdapter` protocol.

## Overview

LizyStudio uses a **protocol-based adapter pattern** to decouple the GUI from
specific ML libraries. Each adapter translates between LizyStudio's common types
and the backend library's native API.

```
Service layer  ──►  BackendAdapter Protocol  ──►  Your ML library
  (common types)       (interface)                 (native types)
```

## The BackendAdapter protocol

The protocol is defined in `src/lizystudio/backends/base.py`. Below is a summary
of the required methods, grouped by category.

### Identification

```python
@property
def info(self) -> BackendInfo:
    """Return backend name and version."""
```

### Config management

```python
def get_config_schema(self) -> ConfigSchema:
    """Return JSON Schema for the config form."""

def get_ui_schema(self) -> dict[str, Any]:
    """Return UI metadata (labels, grouping, parameter hints)."""

def validate_config(self, config: dict) -> list[dict]:
    """Validate config, return list of error dicts (empty = valid)."""

def get_default_config(self, task: str, target: str) -> dict:
    """Return a complete, valid default config for the given task/target."""

def load_config_from_file(self, content: bytes, filename: str) -> dict:
    """Parse a YAML or JSON config file into a dict."""
```

### Model lifecycle

```python
def create_model(self, config: dict, dataframe: pd.DataFrame) -> Any:
    """Create an internal model object from config and data."""

def fit(
    self,
    model: Any,
    *,
    params: dict | None = None,
    on_progress: ProgressCallback | None = None,
) -> FitSummary:
    """Train the model. Call on_progress for real-time updates."""

def tune(
    self,
    model: Any,
    *,
    on_progress: ProgressCallback | None = None,
) -> TuningSummary:
    """Run hyperparameter tuning."""

def predict(
    self,
    model: Any,
    data: pd.DataFrame,
    *,
    return_shap: bool = False,
) -> PredictionSummary:
    """Run inference on new data."""
```

### Evaluation

```python
def evaluate_table(self, model: Any) -> list[dict]:
    """Return metrics as a list of row dicts."""

def split_summary(self, model: Any) -> list[dict]:
    """Return per-fold CV summary."""

def importance(self, model: Any, kind: str = "split") -> dict[str, float]:
    """Return feature importance scores."""

def importance_kinds(self, model: Any) -> list[str]:
    """Return available importance types (e.g. ['split', 'gain', 'shap'])."""

def confusion_matrix(self, model: Any, threshold: float = 0.5) -> dict[str, Any]:
    """Return confusion matrix (classification only)."""

def plot(self, model: Any, plot_type: str, **kwargs: Any) -> PlotData:
    """Return a Plotly-compatible visualization."""

def available_plots(self, model: Any) -> list[str]:
    """Return available plot types."""
```

### Persistence

```python
def export_model(self, model: Any, path: str) -> str:
    """Save model artifacts to the given directory. Return resolved path."""

def export_code(self, model: Any, path: str) -> str:
    """Generate standalone Python code (no LizyStudio dependency)."""

def load_model(self, path: str) -> Any:
    """Restore a model from an export directory."""

def model_info(self, model: Any) -> dict[str, Any]:
    """Return model metadata (feature count, training date, etc.)."""
```

## Common types

All adapters must convert their native types to LizyStudio's common types,
defined in `src/lizystudio/backends/types.py`:

| Type | Purpose |
|------|---------|
| `BackendInfo` | Backend name and version |
| `ConfigSchema` | JSON Schema for config form |
| `FitSummary` | Training results (metrics, duration, etc.) |
| `TuningSummary` | Tuning results (best params, trials, etc.) |
| `PredictionSummary` | Inference results |
| `PlotData` | Plotly JSON figure |
| `ColumnInfo` | Column metadata (name, dtype, stats) |
| `ColumnsResponse` | Column list with target suggestion |

## ProgressCallback

The `ProgressCallback` protocol enables real-time progress reporting via
WebSocket:

```python
def on_progress(
    *,
    current: int,
    total: int,
    message: str,
    **extra: Any,
) -> None: ...
```

- When `total=0`, the operation length is unknown (show indeterminate indicator)
- Call frequently during training for smooth progress bars

## Step-by-step implementation

### 1. Create the adapter module

```
src/lizystudio/backends/
├── my_backend.py          # Main adapter class
├── my_backend_constants.py  # UI schema constants (optional)
└── my_backend_metrics.py    # Metric definitions (optional)
```

### 2. Implement the protocol

```python
# src/lizystudio/backends/my_backend.py
from lizystudio.backends.base import BackendAdapter, BackendInfo
from lizystudio.backends.types import FitSummary, PlotData, ...

class MyBackendAdapter:
    """Adapter for MyMLLibrary."""

    @property
    def info(self) -> BackendInfo:
        return BackendInfo(name="my_backend", version="1.0.0")

    def get_config_schema(self) -> ConfigSchema:
        # Return JSON Schema describing all config parameters
        ...

    def fit(self, model, *, params=None, on_progress=None) -> FitSummary:
        # Train using your library, report progress, return common type
        ...

    # ... implement all other protocol methods
```

### 3. Register the adapter

Add your adapter to the registry in `src/lizystudio/backends/registry.py`:

```python
from lizystudio.backends.my_backend import MyBackendAdapter

ADAPTERS: dict[str, BackendAdapter] = {
    "lizyml": LizyMLAdapter(),
    "my_backend": MyBackendAdapter(),
}
```

### 4. Add the dependency

Add your ML library to `pyproject.toml`:

```toml
dependencies = [
    # ... existing deps
    "my-ml-library>=1.0",
]
```

### 5. Write tests

Create tests in `tests/test_my_backend.py` covering:
- Config schema generation and validation
- Model creation, fit, and predict
- Metrics, plots, and export
- Error handling for invalid inputs

### 6. Submit a proposal

Because adding a backend changes the `BackendAdapter` ecosystem, you need a
Proposal in [HISTORY.md](../HISTORY.md) before merging. See [CONTRIBUTING.md](../CONTRIBUTING.md)
for the change gate requirements.

## Reference implementation

The LizyML adapter (`src/lizystudio/backends/lizyml.py`) is the reference
implementation. Study it for patterns on:

- Converting between native and common types
- Implementing progress callbacks
- Handling edge cases (empty data, missing features, etc.)
- Splitting complex logic into helper modules
