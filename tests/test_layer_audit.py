"""Architecture boundary tests -- enforce layering rules."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

API_DIR = Path("src/lizystudio/api")
SERVICE_DIR = Path("src/lizystudio/services")


def _get_imports(filepath: Path) -> set[str]:
    """Extract all import module names from a Python file."""
    tree = ast.parse(filepath.read_text())
    imports: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                imports.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.add(node.module.split(".")[0])
    return imports


def test_api_layer_does_not_import_lizyml() -> None:
    """Router layer must not directly import ML backend libraries."""
    for py in API_DIR.glob("*.py"):
        imports = _get_imports(py)
        assert "lizyml" not in imports, f"{py.name} imports lizyml directly"


def test_service_layer_does_not_import_lizyml() -> None:
    """Service layer must not directly import ML backend libraries."""
    for py in SERVICE_DIR.glob("*.py"):
        imports = _get_imports(py)
        assert "lizyml" not in imports, f"{py.name} imports lizyml directly"


# --- Phase 20: Router must not call backend adapter methods directly ---

# Patterns that indicate direct backend calls in router code.
# ws.backend.* or backend.* method calls that should go through Service.
_FORBIDDEN_BACKEND_PATTERNS = [
    "backend.load_model(",
    "backend.evaluate_table(",
    "backend.split_summary(",
    "backend.importance(",
    "backend.plot(",
    "backend.available_plots(",
    "backend.predict(",
    "backend.fit(",
    "backend.tune(",
    "backend.get_config_schema(",
    "backend.validate_config(",
    "backend.load_config_from_file(",
    "backend.model_info(",
    "backend.info.name",
]


def test_router_no_direct_backend_calls() -> None:
    """Router files must not call backend adapter methods directly."""
    for py in API_DIR.glob("*.py"):
        if py.name.startswith("_"):
            continue
        content = py.read_text()
        for pattern in _FORBIDDEN_BACKEND_PATTERNS:
            assert pattern not in content, (
                f"{py.name} contains direct backend call: {pattern}"
            )
