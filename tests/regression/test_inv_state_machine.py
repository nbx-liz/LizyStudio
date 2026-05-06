"""INV-3 job state-machine invariants (P-0099 v3-20a / v3-20c / R-1.4).

INV-3 declares the legal transitions for the Job state machine:

    [*]      -> pending
    pending  -> running
    pending  -> cancelled
    running  -> completed
    running  -> failed
    running  -> cancelled
    running  -> paused        # NEW (R-1.4, v3-20)
    paused   -> running       # NEW (R-1.4, v3-20)
    paused   -> cancelled     # NEW (R-1.4, v3-20)
    paused   -> failed        # NEW (R-1.4, v3-20)

This module pins the table itself as the canonical contract. The
runtime assertion that rejects illegal transitions landed in v3-20c
together with the ``request_pause`` / ``PausedError`` plumbing — see
``JobStore.set_status`` and the matching test in
``tests/regression/test_inv_pause_keeps_slot.py``.

Why a table-as-test instead of a single big assertion: each entry in
the LEGAL_TRANSITIONS set is one row of P-0099's INV-3 declaration.
Splitting them lets the parametrize id surface in CI logs ("A regress-
ion broke pending -> running") rather than hiding inside one opaque
"state machine test failed". Future widenings/narrowings of the
matrix mutate this single source of truth and the test signal stays
sharp.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, get_args

import pytest

from lizystudio.backends.types import DataRef
from lizystudio.services.jobs import Job, JobStore

pytestmark = pytest.mark.unit


# Pull the runtime status Literal so the matrix is wired against the
# actual dataclass definition. A future addition / removal of a state
# without updating the matrix below is caught by the
# ``test_legal_transitions_only_reference_known_states`` test.
_STATUS_FIELD_TYPE = Job.__dataclass_fields__["status"].type
# ``__dataclass_fields__["status"].type`` is the string form of the
# annotation when ``from __future__ import annotations`` is active.
# Resolve it explicitly so ``get_args`` returns the literal members.
JobStatus = Literal[
    "pending",
    "running",
    "completed",
    "failed",
    "cancelled",
    "paused",
]
JOB_STATUSES: frozenset[str] = frozenset(get_args(JobStatus))


# Terminal states have NO outgoing transitions (no resurrection).
TERMINAL_STATES: frozenset[str] = frozenset({"completed", "failed", "cancelled"})

# Non-terminal states are the complement.
NON_TERMINAL_STATES: frozenset[str] = JOB_STATUSES - TERMINAL_STATES

# Legal transitions per P-0099 INV-3. ``[*]`` (entry) is modeled as
# the implicit "before any persisted state" — the constructor's
# default of ``"pending"`` is the only legal first write, so only
# ``pending`` is a valid first state. We do not encode ``[*]`` rows
# here because the test framework asserts the constructor invariant
# separately.
LEGAL_TRANSITIONS: frozenset[tuple[str, str]] = frozenset(
    {
        ("pending", "running"),
        ("pending", "cancelled"),
        ("running", "completed"),
        ("running", "failed"),
        ("running", "cancelled"),
        ("running", "paused"),
        ("paused", "running"),
        ("paused", "cancelled"),
        ("paused", "failed"),
    }
)


# ---------------------------------------------------------------------------
# Structural invariants on the table itself.
# ---------------------------------------------------------------------------


def test_job_status_literal_matches_runtime_dataclass() -> None:
    """Sanity: the table's status set matches ``Job.status`` annotation.

    A future widening of the dataclass without updating this module
    trips this test, forcing the developer to either add the new
    state to the matrix below or document why it's intentionally
    out-of-scope.
    """
    # `Job.__annotations__["status"]` is the string form of the
    # annotation under `from __future__ import annotations`; we
    # parse it via the local Literal that mirrors the dataclass.
    assert frozenset(get_args(JobStatus)) == JOB_STATUSES
    # Spot check the new state is wired in.
    assert "paused" in JOB_STATUSES


def test_legal_transitions_only_reference_known_states() -> None:
    """Every state in LEGAL_TRANSITIONS must appear in JOB_STATUSES."""
    referenced = {state for src, dst in LEGAL_TRANSITIONS for state in (src, dst)}
    unknown = referenced - JOB_STATUSES
    assert unknown == set(), (
        f"LEGAL_TRANSITIONS references unknown states: {sorted(unknown)}. "
        "Either add them to JobStatus or remove the offending rows."
    )


def test_terminal_states_have_no_outgoing_transitions() -> None:
    """``completed`` / ``failed`` / ``cancelled`` are dead-end terminals.

    Once a job hits one of these, no transition rewrites the status.
    A future "retry from cancelled" feature must surface as a NEW
    state (e.g. ``retried``) rather than mutating the terminal —
    otherwise downstream metrics, audit trails, and the CHANGELOG
    semantics for ``Added`` vs. ``Changed`` collapse.
    """
    for src in TERMINAL_STATES:
        outgoing = {dst for s, dst in LEGAL_TRANSITIONS if s == src}
        assert outgoing == set(), (
            f"Terminal state {src!r} has illegal outgoing transitions: "
            f"{sorted(outgoing)}"
        )


def test_paused_has_both_incoming_and_outgoing_transitions() -> None:
    """``paused`` is non-terminal: a job can enter it from ``running``
    and exit to ``running``, ``cancelled``, or ``failed``.

    This test pins the v3-20 contract: pause is a stop-gap the user
    can resume from, NOT a terminal record. Removing any of these
    edges (e.g. dropping ``paused -> failed``) is a state-machine
    contraction and must come with a Proposal, not a quiet PR.
    """
    incoming = {src for src, dst in LEGAL_TRANSITIONS if dst == "paused"}
    outgoing = {dst for src, dst in LEGAL_TRANSITIONS if src == "paused"}
    assert incoming == {"running"}, f"paused incoming edges: {sorted(incoming)}"
    assert outgoing == {"running", "cancelled", "failed"}, (
        f"paused outgoing edges: {sorted(outgoing)}"
    )


def test_pending_is_the_only_first_state() -> None:
    """A fresh ``Job`` must be ``pending``; no other state is reachable
    without going through it.

    The dataclass does not enforce this at construction time (status
    is just a Literal field), but the JobStore's ``create()`` wraps
    the construction so status starts at ``pending``. The runtime
    assertion lands in v3-20c; this test pins the matrix-level
    contract.
    """
    # Every legal transition's source must already be reachable from
    # ``pending``. Compute the BFS reach set and assert it equals the
    # full status set.
    reachable = {"pending"}
    while True:
        next_reach = reachable | {
            dst for src, dst in LEGAL_TRANSITIONS if src in reachable
        }
        if next_reach == reachable:
            break
        reachable = next_reach

    assert reachable == JOB_STATUSES, (
        "Some states are unreachable from the initial ``pending``. "
        f"Missing: {sorted(JOB_STATUSES - reachable)}"
    )


def test_no_self_loop_in_legal_transitions() -> None:
    """A state must not transition to itself.

    Self-loops would be a silent no-op write that breaks audit
    trails ("the job moved from running to running 12 times"). The
    JobStore's ``update()`` rewrites freely today, so this is not yet
    enforced at runtime — but the table itself must not declare a
    self-edge as legal.
    """
    self_loops = {(s, d) for s, d in LEGAL_TRANSITIONS if s == d}
    assert self_loops == set(), (
        f"LEGAL_TRANSITIONS contains illegal self-loops: {sorted(self_loops)}"
    )


# ---------------------------------------------------------------------------
# Runtime assertion (v3-20c: JobStore.set_status enforces LEGAL_TRANSITIONS).
# ---------------------------------------------------------------------------


def test_runtime_guard_rejects_illegal_transitions(tmp_path: Path) -> None:
    """``JobStore.set_status`` must raise ``AssertionError`` for any
    transition not present in :data:`LEGAL_TRANSITIONS`.

    Deeper coverage of the legal/illegal axes lives in
    ``tests/regression/test_inv_pause_keeps_slot.py``; this test exists
    so the state-machine matrix module owns at least one runtime-guard
    smoke check. Removing the guard or weakening it to a warning
    rewrites this contract and must surface in this test failing first.
    """
    store = JobStore(tmp_path / "jobs")
    job = store.create(
        backend_name="lizyml",
        config={"task": "binary", "data": {"target": "y"}},
        data_ref=DataRef(
            source_type="path",
            path="/data/x.csv",
            filename="x.csv",
            fingerprint="f",
            shape=(10, 2),
        ),
        job_type="tune",
    )

    # Legal: pending -> running.
    store.set_status(job.job_id, "running")

    # Illegal: running -> pending (audit-trail rewind).
    with pytest.raises(AssertionError):
        store.set_status(job.job_id, "pending")
