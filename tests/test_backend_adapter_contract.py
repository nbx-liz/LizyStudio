"""Tests for BackendAdapter contract cleanup (H-0068, PR-α).

Covers:

- **INV-ADAPTER-1**: ``api/`` and ``services/`` never import from
  ``lizystudio.backends.lizyml``. Backend-specific error translation
  must go through the adapter method / common exception type.
- **INV-ADAPTER-2**: ``backends/`` never imports from ``services.*``
  or ``api.*``. The dependency direction is service → adapter, never
  the reverse.
- **INV-ADAPTER-3**: ``CancelledError`` and ``CheckpointIncompatibleError``
  have a single canonical definition in ``backends.exceptions``; the
  historical ``services.training.CancelledError`` re-export is identity-
  equal to the backend one so ``except CancelledError`` catches from
  either module continue to work.
- **INV-ADAPTER-4**: ``register_backend(name, factory)`` accepts an
  arbitrary ``Callable[[], BackendAdapter]`` without mypy errors; the
  default lizyml registration is preserved.
- **INV-ADAPTER-5**: ``LizyMLAdapter`` satisfies every split Protocol
  (``BackendCore``, ``BackendEvaluator``, ``BackendPlotter``,
  ``BackendCodeExporter``, ``BackendUiSchemaProvider``) and the
  aggregate ``BackendAdapter`` alias.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_REPO_ROOT = Path(__file__).resolve().parents[1]
_API_DIR = _REPO_ROOT / "src" / "lizystudio" / "api"
_SERVICES_DIR = _REPO_ROOT / "src" / "lizystudio" / "services"
_BACKENDS_DIR = _REPO_ROOT / "src" / "lizystudio" / "backends"


def _module_imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


# --- INV-ADAPTER-1 ---------------------------------------------------------


def test_api_and_services_do_not_import_backends_lizyml() -> None:
    """INV-ADAPTER-1 — no backend-specific imports in api/ or services/."""
    offenders: list[str] = []
    for folder in (_API_DIR, _SERVICES_DIR):
        for py in folder.glob("*.py"):
            for mod in _module_imports(py):
                if mod.startswith("lizystudio.backends.lizyml"):
                    offenders.append(f"{py.relative_to(_REPO_ROOT)} imports {mod}")
    assert not offenders, (
        "api/ and services/ must not import from backends.lizyml. Use the "
        f"adapter method / common exception instead. Offenders: {offenders}"
    )


# --- INV-ADAPTER-2 ---------------------------------------------------------


def test_backends_layer_does_not_import_service_or_api() -> None:
    """INV-ADAPTER-2 — dependency direction backends → services is forbidden."""
    offenders: list[str] = []
    for py in _BACKENDS_DIR.rglob("*.py"):
        for mod in _module_imports(py):
            if mod.startswith(("lizystudio.services", "lizystudio.api")):
                # `lizystudio.api.errors` is allowed only if absolutely
                # necessary for cross-cutting error translation, but the
                # refactor removes even that.  Flag any hit.
                offenders.append(f"{py.relative_to(_REPO_ROOT)} imports {mod}")
    assert not offenders, (
        f"backends/ must not import from services.* or api.*. Offenders: {offenders}"
    )


# --- INV-ADAPTER-3 ---------------------------------------------------------


def test_cancelled_error_has_single_canonical_definition() -> None:
    """``services.training.CancelledError`` is the same class as the backend one."""
    from lizystudio.backends.exceptions import CancelledError as BackendCancelled
    from lizystudio.services.training import CancelledError as ServiceCancelled

    assert ServiceCancelled is BackendCancelled, (
        "CancelledError must be re-exported from backends.exceptions, "
        "not redeclared. Identity divergence breaks `except CancelledError`."
    )


def test_training_core_re_exports_cancelled_from_backends() -> None:
    """``_training_core.CancelledError`` is also identity-equal."""
    from lizystudio.backends.exceptions import CancelledError as BackendCancelled
    from lizystudio.services._training_core import CancelledError as CoreCancelled

    assert CoreCancelled is BackendCancelled


def test_checkpoint_incompatible_error_lives_in_backends_exceptions() -> None:
    """New common exception type for checkpoint loading failures."""
    from lizystudio.backends.exceptions import CheckpointIncompatibleError

    assert issubclass(CheckpointIncompatibleError, Exception)
    # It must be raisable and catchable with a message argument.
    exc = CheckpointIncompatibleError("test message")
    assert "test message" in str(exc)


# --- INV-ADAPTER-4 ---------------------------------------------------------


def test_register_backend_accepts_arbitrary_factory() -> None:
    """``register_backend(name, factory)`` admits any Callable[[], BackendAdapter]."""
    from lizystudio.backends.base import BackendAdapter
    from lizystudio.backends.registry import (
        get_adapter,
        register_backend,
    )

    class _FakeAdapter:
        """Minimal stand-in; only needs to be a callable returning an instance."""

    # The factory type is documented as `Callable[[], BackendAdapter]` but
    # the registry must not eagerly type-check the returned object — the
    # Protocol satisfies it at the call site.
    register_backend("fake-test-backend", lambda: _FakeAdapter())  # type: ignore[arg-type, return-value]
    try:
        result = get_adapter("fake-test-backend")
        assert isinstance(result, _FakeAdapter)
    finally:
        # Clean up so this test is idempotent across runs.
        from lizystudio.backends.registry import _ADAPTERS

        _ADAPTERS.pop("fake-test-backend", None)

    # Sanity: the default registration still works.
    default = get_adapter("lizyml")
    assert isinstance(default, BackendAdapter) or hasattr(default, "info"), (
        "Default lizyml registration must continue to resolve"
    )


def test_registry_type_allows_non_lizyml_classes() -> None:
    """The registry dict type must not be fixed to ``type[LizyMLAdapter]``.

    This is an AST / typing-level regression guard: the annotation on
    ``_ADAPTERS`` must use the generic protocol or ``Callable`` form so
    a second adapter can be registered without a mypy error.
    """
    registry_py = _BACKENDS_DIR / "registry.py"
    src = registry_py.read_text()
    assert "type[LizyMLAdapter]" not in src, (
        "registry.py still hardcodes type[LizyMLAdapter]; A-6 not applied"
    )
    assert "register_backend" in src, (
        "registry.py must expose a register_backend() public helper"
    )


# --- INV-ADAPTER-5 ---------------------------------------------------------


def test_adapter_protocols_split_into_capabilities() -> None:
    """BackendCore / Evaluator / Plotter / CodeExporter / UiSchemaProvider exist."""
    from lizystudio.backends import base as base_mod

    for name in (
        "BackendCore",
        "BackendEvaluator",
        "BackendPlotter",
        "BackendCodeExporter",
        "BackendUiSchemaProvider",
        "BackendAdapter",
    ):
        assert hasattr(base_mod, name), (
            f"backends/base.py must expose split Protocol `{name}` (A-5)"
        )


def test_lizyml_adapter_satisfies_all_split_protocols() -> None:
    """LizyMLAdapter is assignable to every split Protocol."""
    from lizystudio.backends.base import (
        BackendAdapter,
        BackendCodeExporter,
        BackendCore,
        BackendEvaluator,
        BackendPlotter,
        BackendUiSchemaProvider,
    )
    from lizystudio.backends.lizyml import LizyMLAdapter

    adapter = LizyMLAdapter()
    # @runtime_checkable lets isinstance work at runtime.
    for proto in (
        BackendCore,
        BackendEvaluator,
        BackendPlotter,
        BackendCodeExporter,
        BackendUiSchemaProvider,
        BackendAdapter,
    ):
        assert isinstance(adapter, proto), (
            f"LizyMLAdapter must satisfy {proto.__name__}"
        )


def test_adapter_exposes_verify_checkpoint_compatibility() -> None:
    """New method on BackendCore replaces backend-specific pickle import."""
    from lizystudio.backends.lizyml import LizyMLAdapter

    adapter = LizyMLAdapter()
    assert callable(getattr(adapter, "verify_checkpoint_compatibility", None)), (
        "BackendCore must declare verify_checkpoint_compatibility(job_dir); "
        "LizyMLAdapter must implement it (A-1)"
    )


def test_verify_checkpoint_raises_common_exception_on_mismatch(tmp_path: Path) -> None:
    """verify_checkpoint_compatibility raises CheckpointIncompatibleError,
    not a backend-specific error class."""
    from lizystudio.backends.exceptions import CheckpointIncompatibleError
    from lizystudio.backends.lizyml import LizyMLAdapter

    adapter = LizyMLAdapter()
    # Write a meta.json with an obviously wrong schema so the compat check
    # has a concrete reason to fail.
    meta_path = tmp_path / "model_meta.json"
    meta_path.write_text(
        '{"pickle_schema": 999999, "lizyml_version": "0.0.0"}',
        encoding="utf-8",
    )
    with pytest.raises(CheckpointIncompatibleError):
        adapter.verify_checkpoint_compatibility(tmp_path)


def test_verify_checkpoint_tolerates_missing_meta(tmp_path: Path) -> None:
    """Missing model_meta.json is not an error — legacy checkpoints are valid."""
    from lizystudio.backends.lizyml import LizyMLAdapter

    adapter = LizyMLAdapter()
    # tmp_path has no model_meta.json: must be a no-op.
    adapter.verify_checkpoint_compatibility(tmp_path)
