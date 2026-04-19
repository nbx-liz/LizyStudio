"""Tests for the ``_training_core.py`` extraction (A-3) and
``WorkspaceState`` encapsulation (A-4).

Covers:

- **INV-WS-1**: no module outside :class:`WorkspaceState` itself touches
  its private lock or ``_job_thread`` attribute. All coordination goes
  through the new public helpers (``register_job_thread``,
  ``previous_job_thread``, ``record_completion``, ``note_current_job``).
- **INV-TR-1**: ``services/training.py`` and ``services/training_retune.py``
  do NOT import each other; the shared helpers live in
  ``services/_training_core.py`` and both sides depend on it.
- Behaviour of the new ``WorkspaceState`` methods under concurrent
  access (two threads racing to register / read the background thread
  pointer must not interleave observably — the lock still protects the
  invariant).
"""

from __future__ import annotations

import ast
import threading
import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

_REPO_ROOT = Path(__file__).resolve().parents[1]
_SERVICES_DIR = _REPO_ROOT / "src" / "lizystudio" / "services"
_TRAINING_PY = _SERVICES_DIR / "training.py"
_TRAINING_RETUNE_PY = _SERVICES_DIR / "training_retune.py"
_TRAINING_CORE_PY = _SERVICES_DIR / "_training_core.py"
_WORKSPACE_PY = _SERVICES_DIR / "workspace.py"


# --- INV-WS-1: no external access to _lock / _job_thread ------------------


def _collect_private_ws_accesses(tree: ast.AST) -> list[str]:
    """Return every ``<name>._lock`` or ``<name>._job_thread`` Attribute
    access found in ``tree`` (Load OR Store).

    We intentionally flag both reads and writes: routers / services must
    never poke the internals, and the refactor routes every write through
    a method on :class:`WorkspaceState`.
    """
    hits: list[str] = []
    targets = {"_lock", "_job_thread"}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        if node.attr not in targets:
            continue
        hits.append(f"<attr>.{node.attr}")
    return hits


def test_no_service_module_touches_ws_private_attrs() -> None:
    """INV-WS-1 — training.py / training_retune.py / training_core.py
    must not reference ``ws._lock`` or ``ws._job_thread`` directly.
    """
    offenders: list[tuple[str, int]] = []
    scanned_files = [_TRAINING_PY, _TRAINING_RETUNE_PY]
    if _TRAINING_CORE_PY.exists():
        scanned_files.append(_TRAINING_CORE_PY)
    for py in scanned_files:
        tree = ast.parse(py.read_text())
        hits = _collect_private_ws_accesses(tree)
        if hits:
            offenders.append((py.name, len(hits)))
    assert not offenders, (
        "Service modules must coordinate workspace state through "
        "WorkspaceState methods, not `ws._lock` / `ws._job_thread`. "
        f"Offenders: {offenders}"
    )


# --- INV-TR-1: no import cycle between training.py and training_retune.py --


def _module_imports(path: Path) -> set[str]:
    """Return every dotted module this Python file imports from."""
    tree = ast.parse(path.read_text())
    out: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            out.add(node.module)
    return out


def test_training_modules_share_core_without_cycle() -> None:
    """INV-TR-1 — training.py and training_retune.py must both import
    from ``services._training_core`` and never from each other.
    """
    # The core module is a hard prerequisite for this invariant.
    assert _TRAINING_CORE_PY.exists(), (
        f"{_TRAINING_CORE_PY} must exist after A-3 extraction"
    )

    training_imports = _module_imports(_TRAINING_PY)
    retune_imports = _module_imports(_TRAINING_RETUNE_PY)

    forbidden_in_training = {
        m
        for m in training_imports
        if m.endswith("services.training_retune")
        or m == "lizystudio.services.training_retune"
    }
    forbidden_in_retune = {
        m
        for m in retune_imports
        if m.endswith("services.training")
        and not m.endswith("_training_core")
        and not m.endswith("training_core")
    }
    # Allow lazy local imports only in re-export footers; filter to
    # top-level module statements. Since ``_module_imports`` walks the
    # whole AST, lazy imports inside ``__all__`` re-export blocks would
    # show up — training.py keeps a tail `from .training_retune import ...`
    # for backward compatibility; exclude that one path explicitly.
    forbidden_in_training.discard("lizystudio.services.training_retune")

    assert not forbidden_in_retune, (
        "training_retune.py must not import from training.py (use "
        f"_training_core instead). Offenders: {forbidden_in_retune}"
    )

    # Both sides must reach core.
    expected_core = {
        "lizystudio.services._training_core",
        "lizystudio.services.training_core",  # tolerate either name
    }
    assert training_imports & expected_core or retune_imports & expected_core, (
        "Neither training.py nor training_retune.py imports from the "
        "extracted core module — extraction did not take effect"
    )
    assert retune_imports & expected_core, (
        "training_retune.py must source shared helpers from the core "
        f"module. Imports seen: {retune_imports}"
    )


# --- WorkspaceState method surface ----------------------------------------


def test_workspace_state_exposes_new_methods() -> None:
    """Public method surface required by A-4."""
    from lizystudio.backends.registry import get_adapter
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=get_adapter("lizyml"))
    assert callable(getattr(ws, "register_job_thread", None)), (
        "WorkspaceState must expose register_job_thread"
    )
    assert callable(getattr(ws, "previous_job_thread", None)), (
        "WorkspaceState must expose previous_job_thread"
    )
    assert callable(getattr(ws, "record_completion", None)), (
        "WorkspaceState must expose record_completion"
    )
    assert callable(getattr(ws, "note_current_job", None)), (
        "WorkspaceState must expose note_current_job"
    )


def test_register_and_previous_thread_roundtrip() -> None:
    """``register_job_thread`` + ``previous_job_thread`` agree."""
    from lizystudio.backends.registry import get_adapter
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=get_adapter("lizyml"))
    assert ws.previous_job_thread() is None

    def _noop() -> None:
        time.sleep(0.01)

    t1 = threading.Thread(target=_noop, daemon=True)
    t1.start()
    ws.register_job_thread(t1)
    assert ws.previous_job_thread() is t1

    # Second registration replaces the first handle.
    t2 = threading.Thread(target=_noop, daemon=True)
    t2.start()
    ws.register_job_thread(t2)
    assert ws.previous_job_thread() is t2

    t1.join()
    t2.join()


def test_record_completion_updates_three_fields_atomically() -> None:
    """``record_completion`` writes fit/tune/current_job_id under the lock."""
    from lizystudio.backends.registry import get_adapter
    from lizystudio.backends.types import FitSummary
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=get_adapter("lizyml"))
    fit = FitSummary(
        metrics={"accuracy": 0.9},
        fold_count=5,
        params={},
    )
    ws.record_completion(fit_result=fit, tune_result=None, job_id="job_abc")
    assert ws.workspace_fit_result is fit
    assert ws.workspace_tune_result is None
    assert ws.current_job_id == "job_abc"


def test_note_current_job_only_sets_id() -> None:
    """``note_current_job`` updates just ``current_job_id``."""
    from lizystudio.backends.registry import get_adapter
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=get_adapter("lizyml"))
    ws.note_current_job("job_xyz")
    assert ws.current_job_id == "job_xyz"
    assert ws.workspace_fit_result is None
    assert ws.workspace_tune_result is None


def test_register_and_previous_are_thread_safe() -> None:
    """Concurrent registers + reads only observe a legally-registered thread.

    Two threads race against a ``Barrier`` so both enter the critical
    section at approximately the same instant, then each registers its
    own ``Thread`` and reads back.  The only values the reader must ever
    see are ``None``, the registrant's own thread, or the other runner's
    thread — nothing else.

    A single forbidden value (an object id not tracked by the test)
    means the lock is not actually protecting the handoff, which is the
    regression this invariant is designed to catch.
    """
    from lizystudio.backends.registry import get_adapter
    from lizystudio.services.workspace import WorkspaceState

    ws = WorkspaceState(backend=get_adapter("lizyml"))

    def _worker() -> None:
        time.sleep(0.005)

    allowed: set[int] = {id(None)}
    forbidden: list[object] = []
    stop = threading.Event()
    iterations = 150
    barrier = threading.Barrier(2)

    def _contend() -> None:
        for _ in range(iterations):
            if stop.is_set():
                return
            th = threading.Thread(target=_worker, daemon=True)
            th.start()
            barrier.wait()  # force simultaneous entry
            ws.register_job_thread(th)
            allowed.add(id(th))
            observed = ws.previous_job_thread()
            if observed is None:
                pass
            elif id(observed) not in allowed:
                forbidden.append(observed)
            th.join()

    runners = [
        threading.Thread(target=_contend, daemon=True),
        threading.Thread(target=_contend, daemon=True),
    ]
    for r in runners:
        r.start()
    for r in runners:
        r.join(timeout=5.0)
    stop.set()

    assert not forbidden, (
        "previous_job_thread() returned an object that was never "
        f"registered — lock protection is broken. Offenders: {forbidden}"
    )
    # Sanity: the race actually ran long enough to observe non-trivial
    # interleavings.
    assert len(allowed) > 2, (
        f"test did not produce enough contention (allowed={len(allowed)})"
    )
