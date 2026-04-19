"""Tests for the Inference `response_model` typing + OpenAPI drift gate (C-1/C-2).

Covers:

- **INV-API-1**: every `/api/inference/*` handler that returns JSON declares
  a ``response_model``. The streaming download endpoint is exempt because
  FastAPI rejects ``response_model`` on :class:`StreamingResponse`; it is
  verified through ``response_class`` instead.
- OpenAPI contract: the declared `response_model` on every inference route
  produces a concrete ``$ref`` schema — no bare ``{}`` or
  ``additionalProperties: true`` without a known field set.
- Schema freshness (**INV-CI-1**): the committed
  ``frontend/src/api/generated/schema.d.ts`` matches a freshly-generated
  dump of the backend OpenAPI document, so routers and the frontend can
  never silently drift.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.unit

_REPO_ROOT = Path(__file__).resolve().parents[1]


def test_inference_handlers_declare_response_model(client: TestClient) -> None:
    """INV-API-1 — every JSON-returning /api/inference route declares a model.

    FastAPI falls back on the return type annotation when ``response_model``
    is not passed explicitly, which produces vague schemas like
    ``dict[str, Any]``.  Reject those: only explicit Pydantic BaseModel
    subclasses (or ``list[BaseModel]``) count as a real contract.
    """
    import inspect
    import typing

    from pydantic import BaseModel

    from lizystudio.api import inference as inf_router_module

    router = inf_router_module.router

    streaming_whitelist = {"inference_download"}

    def _is_pydantic_model(tp: object) -> bool:
        if isinstance(tp, type) and issubclass(tp, BaseModel):
            return True
        origin = typing.get_origin(tp)
        if origin is list:
            args = typing.get_args(tp)
            return bool(args) and _is_pydantic_model(args[0])
        return False

    offenders: list[str] = []
    for route in router.routes:
        name = getattr(route, "name", "<anon>")
        if name in streaming_whitelist:
            continue
        rm = getattr(route, "response_model", None)
        if rm is None or not _is_pydantic_model(rm):
            offenders.append(f"{name}: response_model={rm!r}")
    assert not offenders, (
        "Every inference handler returning JSON must declare a Pydantic "
        f"response_model. Offenders: {offenders}"
    )
    # Make sure the import is observed by static checkers
    _ = inspect.getsourcefile(inf_router_module)


def test_openapi_inference_routes_have_concrete_schemas(client: TestClient) -> None:
    """OpenAPI contains a concrete $ref for every inference 200 response."""
    spec = client.get("/openapi.json").json()
    paths = spec["paths"]
    offenders: list[str] = []
    for path, methods in paths.items():
        if not path.startswith("/api/inference/") and path != "/api/inference":
            continue
        for method, op in methods.items():
            if method.upper() not in {"GET", "POST"}:
                continue
            op_id = op.get("operationId") or f"{method} {path}"
            if op_id == "inference_download_api_inference__inf_id__download_get":
                # StreamingResponse: validated separately via response_class.
                continue
            resp = op.get("responses", {}).get("200") or op.get("responses", {}).get(
                "default"
            )
            if resp is None:
                offenders.append(f"{op_id}: no 200 response")
                continue
            content = (resp.get("content") or {}).get("application/json")
            if content is None:
                offenders.append(f"{op_id}: no application/json content")
                continue
            schema = content.get("schema") or {}
            # A concrete response_model produces either a $ref or a typed
            # container (array of $ref).  A plain object with no fields is
            # a drift signal.
            has_ref = "$ref" in schema
            is_array_of_ref = (
                schema.get("type") == "array"
                and isinstance(schema.get("items"), dict)
                and "$ref" in schema["items"]
            )
            if not (has_ref or is_array_of_ref):
                offenders.append(f"{op_id}: schema={schema}")
    assert not offenders, (
        f"Inference routes must expose concrete OpenAPI schemas. Offenders: {offenders}"
    )


def test_schema_d_ts_matches_generated_output(
    client: TestClient, tmp_path: Path
) -> None:
    """INV-CI-1 — committed schema.d.ts equals freshly generated output.

    Dumps the live FastAPI OpenAPI document, pipes it into
    ``openapi-typescript``, and compares the result against the
    committed ``frontend/src/api/generated/schema.d.ts``.  Skipped when
    the Node toolchain is unavailable (local Python-only environments).

    When this test fails: run ``cd frontend && pnpm generate:api`` and
    commit the regenerated file.
    """
    committed = _REPO_ROOT / "frontend" / "src" / "api" / "generated" / "schema.d.ts"
    if not committed.exists():
        pytest.fail("frontend/src/api/generated/schema.d.ts is missing")

    frontend_dir = _REPO_ROOT / "frontend"
    # Only trust the pinned, in-tree openapi-typescript binary.  Relying on
    # `npx` or an arbitrarily-resolved PATH binary could pull a different
    # version and produce spurious "drift" failures in CI.
    openapi_bin = frontend_dir / "node_modules" / ".bin" / "openapi-typescript"
    if not openapi_bin.exists():
        pytest.skip("openapi-typescript not installed (run pnpm install)")

    spec_path = tmp_path / "openapi.json"
    spec_path.write_text(json.dumps(client.get("/openapi.json").json()))

    proc = subprocess.run(
        [str(openapi_bin), str(spec_path)],
        cwd=frontend_dir,
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"openapi-typescript failed: {proc.stderr[:400]}"
    generated = proc.stdout.strip()
    committed_text = committed.read_text().strip()
    assert generated == committed_text, (
        "Committed schema.d.ts drifts from backend OpenAPI. "
        "Run `cd frontend && pnpm generate:api` and commit the result."
    )


def test_openapi_inference_run_body_typed(client: TestClient) -> None:
    """Smoke: the run endpoint still advertises a typed request body.

    The refactor must not weaken request-side typing while adding
    response_model. This catches accidental removal of the pre-existing
    ``RunRequest`` model.
    """
    spec = client.get("/openapi.json").json()
    op = spec["paths"]["/api/inference/run"]["post"]
    body = op.get("requestBody")
    assert body is not None, "inference_run should still accept a request body"
    schema_ref = body.get("content", {}).get("application/json", {}).get("schema", {})
    assert "$ref" in schema_ref, (
        "inference_run request body must reference a named schema, "
        f"got: {json.dumps(schema_ref)}"
    )
