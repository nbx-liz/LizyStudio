"""Issue #786: a failed child-gate wait leaves nothing running (teardown).

A real-child test that fails on a gate timeout must not leave the child
process or the worker thread alive into the next test. The harness reaps
both on every exit path; this test drives the failing path on purpose and
asserts the process and thread counts.
"""

from __future__ import annotations

import threading

import pytest

from lizystudio.services import subprocess_runner
from tests.regression.p0119_harness import (
    _GATES,
    Gate,
    live_job_threads,
    reap,
)
from tests.regression.test_reg_0697_child_windows import ChildEnv, cenv

__all__ = ["cenv"]

pytestmark = pytest.mark.integration


def test_a_missed_child_gate_leaves_no_child_process_or_worker_thread(
    cenv: ChildEnv, monkeypatch: pytest.MonkeyPatch
) -> None:
    gate_mark, baseline = len(_GATES), set(threading.enumerate())
    gate = Gate(timeout=0.2)
    monkeypatch.setattr(
        subprocess_runner,
        "_reconcile_subprocess_result",
        gate.wrap(subprocess_runner._reconcile_subprocess_result),
    )
    assert cenv.post("/api/workspace/tune").status_code == 200
    # The real child cannot finish within 0.2 s, so the wait fails like a
    # gate that expired under load.
    with pytest.raises(AssertionError, match="never reached the gate"):
        gate.wait_reached()
    assert len(cenv.children) == 1
    assert cenv.children[0].poll() is None, "the child should still be running"
    assert live_job_threads(baseline), "the worker thread should still be running"

    alive_children, alive_threads = reap(
        gate_mark=gate_mark, baseline=baseline, children=cenv.children
    )

    assert alive_children == 0
    assert alive_threads == 0
    assert all(proc.poll() is not None for proc in cenv.children)
    assert live_job_threads(baseline) == []
