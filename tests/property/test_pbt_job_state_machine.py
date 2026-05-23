"""Property-based test for the JobStore state machine (Issue #539).

Complements the example-based tests in
``tests/regression/test_inv_state_machine.py``. The example-based suite
pins specific transitions; this property test explores the **input
space combinatorially** so a regression that breaks an invariant for a
status combination nobody hand-listed surfaces at CI time anyway.

Invariants checked:

- **INV-no-illegal**: any transition NOT in ``LEGAL_TRANSITIONS`` is
  rejected by ``JobStore.set_status`` with ``AssertionError``.
- **INV-replay-safe**: applying a legal transition twice (idempotent
  same-status set, e.g. ``running -> running`` via the set_status API
  on the same job's current status) is either rejected or a no-op,
  not silently allowed past the guard.
- **INV-terminal-no-resurrection**: once a job reaches any state in
  ``TERMINAL_STATES``, no subsequent ``set_status`` to any state
  (including the same terminal) is accepted as a legal transition.

Per ``feedback_combinatorial_branch_coverage`` (memory):
table-drive tests over the input-axis product; the property test is
the natural extension of that pattern to "every (src, dst) pair the
type system permits".

Per ``feedback_count_budget_assertions`` (memory): state-machine
violations are storm-class — they ought to fail loudly the first
time, not "eventually". hypothesis ``deadline`` is set so a missing
guard surfaces as a fast failure.
"""

from __future__ import annotations

import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import JobStore
from tests.regression.test_inv_state_machine import (
    JOB_STATUSES,
    LEGAL_TRANSITIONS,
    TERMINAL_STATES,
)

pytestmark = pytest.mark.unit


# Hypothesis strategy yielding every (src, dst) pair across the
# declared status set. Includes legal AND illegal pairs; the test
# routes on membership in LEGAL_TRANSITIONS.
STATUS_PAIRS = st.tuples(
    st.sampled_from(sorted(JOB_STATUSES)),
    st.sampled_from(sorted(JOB_STATUSES)),
)


def _make_data_ref() -> DataRef:
    return DataRef(
        source_type="path",
        path="/data/x.csv",
        filename="x.csv",
        fingerprint="f",
        shape=(10, 2),
    )


def _drive_to(store: JobStore, job_id: str, target: str) -> bool:
    """Drive a freshly-created (``pending``) job through the legal
    transition graph to ``target``. Returns False when no legal path
    exists (e.g. ``target == "pending"`` itself, which is unreachable
    from any other state).
    """
    if target == "pending":
        return True
    paths: dict[str, list[str]] = {"pending": []}
    # Plain BFS over LEGAL_TRANSITIONS — small graph so simplicity > speed.
    frontier = ["pending"]
    while frontier:
        next_frontier: list[str] = []
        for src in frontier:
            for s, dst in LEGAL_TRANSITIONS:
                if s != src or dst in paths:
                    continue
                paths[dst] = [*paths[src], dst]
                next_frontier.append(dst)
        frontier = next_frontier
    if target not in paths:
        return False
    for state in paths[target]:
        store.set_status(job_id, state)
    return True


@given(pair=STATUS_PAIRS)
@settings(
    max_examples=200,
    deadline=2_000,  # per-example budget; the BFS + sqlite work caps ≪ 2s
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_pbt_set_status_honors_legal_transitions(
    tmp_path_factory: pytest.TempPathFactory,
    pair: tuple[str, str],
) -> None:
    """For every (src, dst) pair in ``JOB_STATUSES × JOB_STATUSES``:

    - if (src, dst) ∈ LEGAL_TRANSITIONS → ``set_status`` accepts it
    - if (src, dst) ∉ LEGAL_TRANSITIONS → ``set_status`` raises
      ``AssertionError``

    Drives the job from ``pending`` to ``src`` via the legal-transition
    graph before testing the (src → dst) edge. When ``src`` is
    unreachable (only ``pending`` is "unreachable from a non-pending
    state" in the current matrix), the example is silently skipped —
    not a failure, just out-of-domain.
    """
    src, dst = pair

    # tmp_path_factory is function-scoped via hypothesis examples;
    # mint a fresh dir per example so the JobStore's sqlite slot doesn't
    # carry state across hypothesis shrinks.
    jobs_dir = tmp_path_factory.mktemp("jobs")
    store = JobStore(jobs_dir)
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )

    if not _drive_to(store, job.job_id, src):
        # ``src`` is unreachable in the legal graph (e.g. trying to
        # land on ``pending`` after another state). The contract makes
        # no claim about this scenario — skip silently.
        return

    # Sanity: we're actually at `src` before the test edge.
    current = store.get(job.job_id)
    assert current is not None and current.status == src, (
        f"PBT setup failed: expected job at {src!r}, got "
        f"{current.status if current else None!r}"
    )

    is_legal = (src, dst) in LEGAL_TRANSITIONS
    if is_legal:
        store.set_status(job.job_id, dst)
        landed = store.get(job.job_id)
        assert landed is not None and landed.status == dst, (
            f"Legal transition ({src!r} -> {dst!r}) did not persist; "
            f"final status: {landed.status if landed else None!r}"
        )
    else:
        with pytest.raises(AssertionError):
            store.set_status(job.job_id, dst)
        # Status must not have changed on the rejection path.
        unchanged = store.get(job.job_id)
        assert unchanged is not None and unchanged.status == src, (
            f"Illegal transition ({src!r} -> {dst!r}) was rejected but "
            f"status drifted to {unchanged.status if unchanged else None!r}"
        )


@given(terminal=st.sampled_from(sorted(TERMINAL_STATES)))
@settings(
    max_examples=50,
    deadline=2_000,
    suppress_health_check=[HealthCheck.function_scoped_fixture],
)
def test_pbt_terminal_states_admit_no_outgoing_transitions(
    tmp_path_factory: pytest.TempPathFactory,
    terminal: str,
) -> None:
    """INV-terminal-no-resurrection.

    Once a job is in any terminal state, no subsequent ``set_status``
    to ANY state in ``JOB_STATUSES`` is legal. Including the same
    terminal again (idempotent re-write is still a rewrite from the
    state machine's point of view).
    """
    jobs_dir = tmp_path_factory.mktemp("jobs")
    store = JobStore(jobs_dir)
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=_make_data_ref(),
        job_type="tune",
    )
    assert _drive_to(store, job.job_id, terminal), (
        f"Setup error: cannot reach terminal {terminal!r}"
    )

    for dst in sorted(JOB_STATUSES):
        with pytest.raises(AssertionError):
            store.set_status(job.job_id, dst)
        # The terminal state must stay terminal across every rejected
        # write — no half-committed rewrite.
        current = store.get(job.job_id)
        assert current is not None and current.status == terminal, (
            f"After rejecting ({terminal!r} -> {dst!r}) the job status "
            f"drifted to {current.status if current else None!r}"
        )
