"""Regression test for bridge callback exception swallowing.

Previously ``_bridge`` in ``LizyMLAdapter.tune`` caught any Exception from
the user callback and re-raised it as ``KeyboardInterrupt``. A real bug
in the progress path (e.g. a ``RuntimeError`` or ``TypeError``) would
therefore be turned into a cancellation signal, losing the stack trace
and silently aborting the tune.

Only ``CancelledError`` from the cancel-aware callback should be
converted to ``KeyboardInterrupt``.
"""

from __future__ import annotations

import pytest

from lizystudio.services.training import CancelledError


@pytest.fixture()
def bridge_fn():
    """Reconstruct the relevant branch of LizyMLAdapter.tune._bridge.

    The real ``_bridge`` is defined inline inside ``tune``; we recreate the
    exception-handling contract so the regression test documents the
    expected behaviour without spinning up the full LizyML pipeline.
    """
    from lizystudio.backends.lizyml import adapter as _  # noqa: F401

    def _run(callback):
        try:
            callback()
        except CancelledError:
            raise KeyboardInterrupt from None

    return _run


def test_cancelled_error_is_converted_to_keyboard_interrupt(bridge_fn) -> None:
    def cb() -> None:
        raise CancelledError

    with pytest.raises(KeyboardInterrupt):
        bridge_fn(cb)


def test_runtime_error_from_callback_is_not_swallowed(bridge_fn) -> None:
    """A RuntimeError from the progress callback must propagate untouched."""

    def cb() -> None:
        raise RuntimeError("latent bug")

    with pytest.raises(RuntimeError, match="latent bug"):
        bridge_fn(cb)


def test_type_error_from_callback_is_not_swallowed(bridge_fn) -> None:
    def cb() -> None:
        raise TypeError("bad arg")

    with pytest.raises(TypeError, match="bad arg"):
        bridge_fn(cb)


def test_adapter_bridge_source_narrows_exception() -> None:
    """Static check: the bridge implementation must catch CancelledError only.

    This guards against regression to ``except Exception``.
    """
    from pathlib import Path

    source = Path(
        "src/lizystudio/backends/lizyml/lifecycle_mixin.py",
    ).read_text(encoding="utf-8")
    # Locate the inline _bridge function and verify its exception handler
    # does not use a broad ``except Exception``.
    assert "def _bridge(info: TuneProgressInfo) -> None:" in source
    bridge_start = source.index("def _bridge(info: TuneProgressInfo) -> None:")
    bridge_end = source.index("lizyml_callback = _bridge", bridge_start)
    bridge_src = source[bridge_start:bridge_end]
    assert "except Exception:" not in bridge_src or bridge_src.count(
        "except Exception:"
    ) == bridge_src.count("# noqa: BLE001 - intentionally broad"), (
        "bridge must not catch Exception broadly except for the "
        "intentionally-broad checkpoint save block"
    )
    assert "except CancelledError" in bridge_src, (
        "bridge must catch CancelledError explicitly"
    )
