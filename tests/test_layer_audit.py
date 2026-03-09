"""Architecture boundary tests -- enforce layering rules."""

from __future__ import annotations

import ast
from pathlib import Path

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
