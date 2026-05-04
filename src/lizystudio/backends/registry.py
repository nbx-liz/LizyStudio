"""Backend adapter registry (H-0068).

The registry maps a backend name to a zero-arg factory that returns a
:class:`~lizystudio.backends.base.BackendAdapter`.  The factory form
lets us register adapters without eagerly instantiating them (heavy
import chains) and lets third-party adapters plug in via
:func:`register_backend` without modifying the dict literal below.
"""

from __future__ import annotations

from collections.abc import Callable

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.lizyml import LizyMLAdapter

# Name -> factory.  The factory is invoked lazily on each ``get_adapter``
# call; cache at the caller if re-instantiation matters.
_ADAPTERS: dict[str, Callable[[], BackendAdapter]] = {
    "lizyml": lambda: LizyMLAdapter(),
}


def register_backend(name: str, factory: Callable[[], BackendAdapter]) -> None:
    """Register a backend factory under *name*.

    Overwrites any previous registration for the same name so a test
    can safely install and remove fakes.  Third-party packages should
    call this at import time (or on first use).
    """
    _ADAPTERS[name] = factory


def get_adapter(name: str = "lizyml") -> BackendAdapter:
    """Instantiate a backend adapter by name."""
    factory = _ADAPTERS.get(name)
    if factory is None:
        available = ", ".join(sorted(_ADAPTERS))
        msg = f"Unknown backend {name!r}. Available: {available}"
        raise ValueError(msg)
    return factory()
