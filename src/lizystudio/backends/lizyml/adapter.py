"""LizyML backend adapter — main class.

Composes focused mixins into a single adapter that satisfies the
``BackendAdapter`` protocol. Each mixin module owns a distinct
responsibility; see the individual ``*_mixin.py`` files for details.
"""

from __future__ import annotations

from .checkpoint_mixin import CheckpointMixin
from .config_mixin import ConfigMixin
from .evaluation_mixin import EvaluationMixin
from .lifecycle_mixin import LifecycleMixin
from .pickle_compat import PickleIncompatibleError


class LizyMLAdapter(ConfigMixin, CheckpointMixin, LifecycleMixin, EvaluationMixin):
    """Adapter for the LizyML library."""


# Re-export for callers that imported PickleIncompatibleError directly from
# the adapter module before the H-0062 split.
__all__ = ["LizyMLAdapter", "PickleIncompatibleError"]
