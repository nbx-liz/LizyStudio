"""Contract: every plot-type string the frontend hard-codes must be a
registered key in ``LizyMLAdapter._PLOT_DISPATCH``.

Issue #373 (and earlier #370) traced to a frontend → backend mismatch
where the UI requested a plot type the backend never advertised. The
gating layer (``available_plots``) silently dropped the request, so
the bug only surfaced as a missing UI section. This contract test
locks the structural guarantee that any plot key wired into a frontend
``fetchInferencePlot(...)`` / ``fetchJobPlot(...)`` call has a
matching dispatch entry, catching the next mismatch at CI time.

The list below is intentionally hand-maintained from a grep across
``frontend/src/api/`` and ``frontend/src/hooks/`` because:

* Plot keys delivered dynamically via ``available_plots`` (e.g.
  ``roc-curve``, ``calibration``) are out of scope — the backend
  itself decides whether to advertise them, so a missing dispatch
  entry would be caught by the existing ``available_plots`` tests.
* Hard-coded frontend keys (those not gated on backend advertisement)
  are the failure mode this test pins.

When adding a new fetcher in the frontend, add the key here. CI will
fail until the backend dispatch grows the matching entry.
"""

from __future__ import annotations

import pytest

from lizystudio.backends.lizyml.adapter import LizyMLAdapter

pytestmark = pytest.mark.unit


# Hard-coded plot keys passed to fetchJobPlot / fetchInferencePlot in
# the frontend. Sources verified 2026-05-04:
#
# * frontend/src/hooks/useJobResultData.ts:122  fetchJobPlot("learning-curve")
# * frontend/src/hooks/useJobResultData.ts:196  fetchJobPlot("importance")
# * frontend/src/hooks/useJobResultData.ts:211  fetchJobPlot("tuning")
# * frontend/src/api/inference.ts:155            fetchInferencePlot("shap-summary")
_FRONTEND_HARDCODED_PLOT_KEYS: frozenset[str] = frozenset(
    {
        "learning-curve",
        "importance",
        "tuning",
        "shap-summary",
    }
)


def test_every_frontend_hardcoded_plot_key_has_dispatch_entry() -> None:
    dispatch = set(LizyMLAdapter._PLOT_DISPATCH)
    missing = _FRONTEND_HARDCODED_PLOT_KEYS - dispatch
    assert not missing, (
        f"Frontend hard-codes plot keys that have no _PLOT_DISPATCH entry: "
        f"{sorted(missing)}. Add them to LizyMLAdapter._PLOT_DISPATCH or "
        f"remove the dead frontend fetcher."
    )
