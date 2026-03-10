"""Backend adapter registry."""

from __future__ import annotations

from lizystudio.backends.base import BackendAdapter
from lizystudio.backends.lizyml import LizyMLAdapter

_ADAPTERS: dict[str, type[LizyMLAdapter]] = {
    "lizyml": LizyMLAdapter,
}


def get_adapter(name: str = "lizyml") -> BackendAdapter:
    """Instantiate a backend adapter by name."""
    cls = _ADAPTERS.get(name)
    if cls is None:
        available = ", ".join(sorted(_ADAPTERS))
        msg = f"Unknown backend {name!r}. Available: {available}"
        raise ValueError(msg)
    return cls()
