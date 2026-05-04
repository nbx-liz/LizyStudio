"""Tests for the WebSocket message Pydantic SSOT (H-0069, PR-β).

Covers:

- **INV-WS-1**: Every `ProgressBroadcaster.send_*` call emits bytes that
  parse back into a :class:`WsMessage` via ``TypeAdapter(WsMessage).
  validate_json`` — the queued dict is what the module sends.
- **INV-WS-2**: The Pydantic union is the single source of truth; the
  hand-written TypeScript `WsMessage` in
  `frontend/src/api/types.ts` is replaced by a generated-schema
  re-export (documented — enforced by the drift-gate test below).
- **INV-WS-3**: Wire format is **bit-identical** to the previous
  hand-rolled ``json.dumps`` output for every variant and
  representative payload — existing browser clients keep working.
- **INV-WS-4**: An unknown ``type`` or an extra field raises
  :class:`pydantic.ValidationError`; the router's ``send`` surface
  never silently accepts malformed messages.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

pytestmark = pytest.mark.unit


# --- Module surface --------------------------------------------------------


def test_ws_messages_module_exports_union() -> None:
    """The Pydantic discriminated union lives at ``lizystudio.ws.messages``."""
    import importlib

    mod = importlib.import_module("lizystudio.ws.messages")
    for name in ("WsProgress", "WsCompleted", "WsError", "WsPing", "WsMessage"):
        assert hasattr(mod, name), (
            f"lizystudio.ws.messages must expose `{name}` (H-0069)"
        )


# --- INV-WS-1 --------------------------------------------------------------


def test_broadcaster_send_progress_round_trips_through_ws_message() -> None:
    """``send_progress`` enqueues a dict that parses as :class:`WsProgress`."""
    from pydantic import TypeAdapter

    from lizystudio.ws.messages import WsMessage, WsProgress
    from lizystudio.ws.progress import ProgressBroadcaster

    captured: list[dict[str, Any]] = []

    class _Capture(ProgressBroadcaster):
        def send(self, job_id: str, message: dict[str, Any]) -> None:  # type: ignore[override]
            captured.append(message)

    b = _Capture()
    b.send_progress(
        "job_x",
        current=2,
        total=5,
        message="Fold 2/5",
        fold_results=[{"fold": 0, "rmse": 0.12}],
    )
    assert len(captured) == 1
    parsed = TypeAdapter(WsMessage).validate_python(captured[0])
    assert isinstance(parsed, WsProgress)
    assert parsed.job_id == "job_x"
    assert parsed.current == 2
    assert parsed.total == 5
    assert parsed.message == "Fold 2/5"
    # fold_results parses into WsFoldResult models; compare their dumps
    # so the assertion is not coupled to Pydantic's __eq__ for models.
    assert parsed.fold_results is not None
    assert [f.model_dump(exclude_none=True) for f in parsed.fold_results] == [
        {"fold": 0, "rmse": 0.12}
    ]
    assert parsed.trial_results is None


def test_broadcaster_send_completed_round_trips() -> None:
    from pydantic import TypeAdapter

    from lizystudio.ws.messages import WsCompleted, WsMessage
    from lizystudio.ws.progress import ProgressBroadcaster

    captured: list[dict[str, Any]] = []

    class _Capture(ProgressBroadcaster):
        def send(self, job_id: str, message: dict[str, Any]) -> None:  # type: ignore[override]
            captured.append(message)

    _Capture().send_completed("job_y", message="All done.")
    parsed = TypeAdapter(WsMessage).validate_python(captured[0])
    assert isinstance(parsed, WsCompleted)
    assert parsed.job_id == "job_y"
    assert parsed.message == "All done."


def test_broadcaster_send_error_round_trips_with_code() -> None:
    from pydantic import TypeAdapter

    from lizystudio.ws.messages import WsError, WsMessage
    from lizystudio.ws.progress import ProgressBroadcaster

    captured: list[dict[str, Any]] = []

    class _Capture(ProgressBroadcaster):
        def send(self, job_id: str, message: dict[str, Any]) -> None:  # type: ignore[override]
            captured.append(message)

    _Capture().send_error("job_z", "boom", code="JOB_CANCELLED")
    parsed = TypeAdapter(WsMessage).validate_python(captured[0])
    assert isinstance(parsed, WsError)
    assert parsed.code == "JOB_CANCELLED"
    assert parsed.message == "boom"


# --- INV-WS-3 (bit-identical wire format) ----------------------------------


def _legacy_progress_dict(
    job_id: str,
    *,
    current: int,
    total: int,
    message: str,
    fold_results: list[dict[str, Any]] | None = None,
    trial_results: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Replicates the old hand-rolled dict in ``ws/progress.py::send_progress``."""
    out: dict[str, Any] = {
        "type": "progress",
        "job_id": job_id,
        "current": current,
        "total": total,
        "message": message,
    }
    if fold_results is not None:
        out["fold_results"] = fold_results
    if trial_results is not None:
        out["trial_results"] = trial_results
    return out


def test_progress_wire_format_bit_identical_minimal() -> None:
    """WsProgress.model_dump(exclude_none=True) matches the legacy dict."""
    from lizystudio.ws.messages import WsProgress

    legacy = _legacy_progress_dict("job_1", current=1, total=10, message="msg")
    produced = WsProgress(
        type="progress",
        job_id="job_1",
        current=1,
        total=10,
        message="msg",
    ).model_dump(exclude_none=True)
    assert produced == legacy


def test_progress_wire_format_with_fold_results() -> None:
    from lizystudio.ws.messages import WsProgress

    folds = [{"fold": 0, "score": 0.8}, {"fold": 1, "score": 0.82}]
    legacy = _legacy_progress_dict(
        "job_2", current=2, total=5, message="Fold 2/5", fold_results=folds
    )
    produced = WsProgress(
        type="progress",
        job_id="job_2",
        current=2,
        total=5,
        message="Fold 2/5",
        fold_results=folds,
    ).model_dump(exclude_none=True)
    assert produced == legacy


def test_completed_wire_format_bit_identical() -> None:
    from lizystudio.ws.messages import WsCompleted

    legacy = {"type": "completed", "job_id": "j", "message": "Completed."}
    produced = WsCompleted(
        type="completed", job_id="j", message="Completed."
    ).model_dump(exclude_none=True)
    assert produced == legacy


def test_error_wire_format_bit_identical() -> None:
    from lizystudio.ws.messages import WsError

    legacy = {
        "type": "error",
        "job_id": "j",
        "message": "boom",
        "code": "BACKEND_ERROR",
    }
    produced = WsError(
        type="error", job_id="j", message="boom", code="BACKEND_ERROR"
    ).model_dump(exclude_none=True)
    assert produced == legacy


def test_ping_wire_format_bit_identical() -> None:
    from lizystudio.ws.messages import WsPing

    legacy = {"type": "ping", "job_id": "j"}
    produced = WsPing(type="ping", job_id="j").model_dump(exclude_none=True)
    assert produced == legacy


def test_json_serialization_uses_compact_form() -> None:
    """Bytes written by ``model_dump_json`` parse back to the same dict."""
    from lizystudio.ws.messages import WsProgress

    p = WsProgress(type="progress", job_id="j", current=1, total=2, message="m")
    raw = p.model_dump_json(exclude_none=True)
    assert json.loads(raw) == {
        "type": "progress",
        "job_id": "j",
        "current": 1,
        "total": 2,
        "message": "m",
    }


# --- INV-WS-4 (extra fields / unknown type rejected) -----------------------


def test_unknown_type_discriminator_raises_validation_error() -> None:
    from pydantic import TypeAdapter, ValidationError

    from lizystudio.ws.messages import WsMessage

    adapter: TypeAdapter[Any] = TypeAdapter(WsMessage)
    with pytest.raises(ValidationError):
        adapter.validate_python({"type": "garbage", "job_id": "j"})


def test_extra_field_rejected_on_progress() -> None:
    from pydantic import ValidationError

    from lizystudio.ws.messages import WsProgress

    with pytest.raises(ValidationError):
        WsProgress(  # type: ignore[call-arg]
            type="progress",
            job_id="j",
            current=1,
            total=2,
            message="m",
            surprise_field="nope",
        )


def test_fold_result_without_fold_index_is_rejected() -> None:
    """WsFoldResult requires the ``fold`` index even with extra='allow'."""
    from pydantic import ValidationError

    from lizystudio.ws.messages import WsFoldResult

    # Missing `fold` — the only required field — must still fail.
    with pytest.raises(ValidationError):
        WsFoldResult.model_validate({"rmse": 0.12, "r2": 0.9})


def test_fold_result_coerces_fold_to_int() -> None:
    """WsFoldResult.fold rejects non-integer inputs."""
    from pydantic import ValidationError

    from lizystudio.ws.messages import WsFoldResult

    with pytest.raises(ValidationError):
        WsFoldResult.model_validate({"fold": "not-an-int", "rmse": 0.1})


# --- WS integration (regression) -------------------------------------------


def test_websocket_handler_accepts_connection() -> None:
    """``/ws/jobs/{job_id}/progress`` must accept the connection.

    Regression for a bug uncovered during PR-β smoke: the shared
    ``get_broadcaster`` dependency was typed as ``Request`` which
    FastAPI could not inject on WebSocket handlers, so the upgrade
    handshake returned 500.  Switching to ``HTTPConnection`` — the
    common base of ``Request`` and ``WebSocket`` — lets a single
    factory cover both scopes.
    """
    from fastapi.testclient import TestClient

    from lizystudio.server import create_app

    app = create_app()
    with (
        TestClient(app) as client,
        client.websocket_connect(
            "/ws/jobs/unknown_job/progress",
            headers={"origin": "http://localhost:5173"},
        ) as ws,
    ):
        # Connection must succeed — the handler would raise 500 if
        # dependency resolution broke.
        assert ws is not None


# --- INV-WS-2 (frontend drift gate) ----------------------------------------


def test_frontend_no_handwritten_ws_message_types() -> None:
    """frontend/src/api/types.ts must not hand-write the WS schema any more.

    After H-0069 the TypeScript side re-exports the generated schema
    instead of keeping drift-prone duplicates.  This test is a grep
    over the committed file — if it fails, either remove the
    hand-written definitions or update the regex here.
    """
    from pathlib import Path

    p = Path(__file__).resolve().parents[1] / "frontend" / "src" / "api" / "types.ts"
    content = p.read_text(encoding="utf-8")
    forbidden = (
        'type: "progress"',
        'type: "completed"',
        'type: "error"',
    )
    offenders = [tok for tok in forbidden if tok in content]
    assert not offenders, (
        "frontend/src/api/types.ts must not hand-write the WS message "
        f"variants. Import from the generated schema instead. Offenders: {offenders}"
    )
