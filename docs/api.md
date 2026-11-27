# API Reference

LizyStudio exposes a REST API on `http://localhost:8501/api`. This document
summarizes all available endpoints. For the full specification, see
[BLUEPRINT.md](../BLUEPRINT.md) §5.

## Interactive docs

When the server is running, visit:
- **Swagger UI:** http://localhost:8501/docs
- **ReDoc:** http://localhost:8501/redoc
- **OpenAPI JSON:** http://localhost:8501/openapi.json

## Common conventions

- **Base path:** `/api`
- **Content-Type:** `application/json` (except file uploads)
- **Success means committed:** a `2xx` from `/api/workspace/**` means the side
  effect happened (P-0110). There is no `saved` flag to check.
- **Error format** of a LizyStudio error (one with a code from
  [Error codes](#error-codes)) depends on the path (P-0110):

  | Path | Media type | Body |
  |------|------------|------|
  | `/api/workspace` and below | `application/problem+json` | RFC 9457 Problem Details |
  | Every other path (`/api/jobs/**`, `/api/inference/**`, `/api/files/**`, ...) | `application/json` | Legacy `{"error": {...}}` envelope |

  Failures that are not LizyStudio errors keep the framework's default body
  on every path: a `405` (`{"detail": "Method Not Allowed"}`) and an
  unhandled `500`. A `GET` of an unknown `/api/workspace/...` route depends
  on whether the server serves the built frontend: with the build present,
  the SPA catch-all answers a LizyStudio `404 NOT_FOUND` (Problem Details);
  without it (for example a backend run before `pnpm build`), FastAPI
  answers its own `404` `{"detail": "Not Found"}`. The catch-all is
  `GET`-only, so with the build present any other method on an unknown
  route answers `405` `{"detail": "Method Not Allowed"}`.

### Problem Details (`/api/workspace/**`)

Every member is always present. `type` is always `"about:blank"`, so `title`
is the HTTP reason phrase of `status`; the problem is identified by `code`
(see [Error codes](#error-codes)). `detail` is the human-readable message,
`details` carries the structured payload (`job_id`, `recovery_hint`, ...), and
`validation_errors` is the list of validation entries on `VALIDATION_ERROR`
and `null` otherwise. The OpenAPI component is `ProblemDetails`.

`422` — blocking config validation (`PUT /config`, `POST /config/upload`,
`POST /fit`, `POST /tune`). On `PUT /config` and `POST /config/upload` the
config was **not** saved. On `POST /fit` and `POST /tune` see the ordering
note below:

```json
{
  "type": "about:blank",
  "title": "Unprocessable Entity",
  "status": 422,
  "detail": "Config validation failed",
  "code": "VALIDATION_ERROR",
  "details": {},
  "validation_errors": [
    {
      "path": "split.n_splits",
      "message": "n_splits=1000 is greater than the number of samples in the loaded dataset (n_rows=50). Reduce Folds to at most 50.",
      "severity": "error",
      "suggested_fix": "Set Folds (split.n_splits) to 50 or fewer."
    }
  ]
}
```

On `PUT /config` and `POST /config/upload`, `validation_errors` carries every
entry, warnings included; only `severity: "error"` entries cause the 422.
`POST /fit` and `POST /tune` list the blocking entries only.

**Ordering on `POST /fit` and `POST /tune`.** An inline `{"config": ...}`
body is validated first; when it has a blocking entry the answer is `422`
and nothing is saved. When it passes, it **is saved** to the workspace
(P-0086, with its `tuning` block moved to the Tune overrides) before the
later gates run, and a later refusal does not undo that save:
`400 WORKSPACE_NO_DATA`, `409 JOB_CONFLICT`, and on `POST /tune` the `422`
of the materialized Tune config and of the search-space run gate (an
inverted Range or a log Range with `low <= 0`). The search-space gate runs
only at Tune time, so the same config is saved without complaint by
`PUT /config`.

A `422` on these four routes can also be the legacy envelope under
`application/json`: a request body that cannot be parsed (FastAPI request
validation). The OpenAPI schema lists both media types for those 422s.

`409` — a config write while a job is running:

```json
{
  "type": "about:blank",
  "title": "Conflict",
  "status": 409,
  "detail": "Config is locked while job job_042 is running",
  "code": "WORKSPACE_LOCKED",
  "details": { "job_id": "job_042" },
  "validation_errors": null
}
```

Other workspace errors (`WORKSPACE_NO_DATA`, `PATH_NOT_FOUND`, `FILE_INVALID`,
...) use the same shape with their own `status` and `code`.

`title` is the reason phrase of the running Python's `http.HTTPStatus`; for
422 it is `"Unprocessable Content"` on Python 3.13 and later. Match on
`status` and `code`, not on `title`.

A request body that cannot be parsed at all (FastAPI's request validation)
still answers `422` with the legacy envelope below, on every path.

### Legacy envelope (every other path)

```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job not found: job_042",
    "details": {}
  }
}
```

## Endpoints

### Backend

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/backends` | List available ML backends |
| GET | `/api/backends/ui-schema` | UI metadata for config forms |

### Workspace — Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspace/status` | Current workspace state |
| POST | `/api/workspace/reset` | Reset workspace |
| GET | `/api/workspace/config/schema` | JSON Schema for config form |
| GET | `/api/workspace/config/defaults` | Default config (query: `task`, `target`) |
| GET | `/api/workspace/config` | Current config |
| PUT | `/api/workspace/config` | Replace config. `200 {config, validation_errors}` when saved (`validation_errors` holds warnings only); `422` Problem Details when a blocking entry refuses it; `409 WORKSPACE_LOCKED` while a job runs |
| PATCH | `/api/workspace/config` | Partial config update |
| POST | `/api/workspace/config/validate` | Validate config (dry run) |
| POST | `/api/workspace/config/upload` | Load config from YAML/JSON file. `200` and `422` as for `PUT /api/workspace/config`; `400` when the file cannot be read or parsed. It has no running-job lock check, so it never answers `409` |
| GET | `/api/workspace/config/download` | Download config as YAML |

### Workspace — Data

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspace/data/upload` | Upload CSV/Parquet file |
| POST | `/api/workspace/data/path` | Load data from local path |
| GET | `/api/workspace/data/preview` | First N rows of loaded data |
| GET | `/api/workspace/data/columns` | Column info with target suggestion |
| GET | `/api/workspace/data/column-stats/{col}` | Per-column statistics |
| GET | `/api/workspace/data/split-preview` | CV split preview |
| GET | `/api/workspace/data/describe` | Basic data statistics |

### Workspace — Fit / Tune

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspace/fit` | Start a fit job → `{ "job_id": "..." }`. Optional body `{ "config": {...} }` overrides workspace config atomically (P-0086) |
| POST | `/api/workspace/tune` | Start a tune job → `{ "job_id": "..." }`. Same optional body semantics as `/fit` |

### Jobs

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/jobs` | List jobs (query: `status`, `sort`) |
| GET | `/api/jobs/{job_id}` | Job details (meta + result summary). `warnings: string[]` lists the distinct backend warnings the job raised (message text only, at most 50; `[]` when none or for a job written before the field, P-0117 D4) |
| GET | `/api/jobs/{job_id}/config` | Job config snapshot |
| GET | `/api/jobs/{job_id}/metrics` | Metrics table |
| GET | `/api/jobs/{job_id}/split-summary` | Per-fold CV summary |
| GET | `/api/jobs/{job_id}/importance` | Feature importance (query: `kind`) |
| GET | `/api/jobs/{job_id}/importance-kinds` | Available importance types |
| GET | `/api/jobs/{job_id}/learning-curve/metrics` | Eval metrics available for the learning-curve plot |
| GET | `/api/jobs/{job_id}/plot/{plot_type}` | Plotly JSON visualization |
| GET | `/api/jobs/{job_id}/plots` | Available plot types |
| POST | `/api/jobs/{job_id}/export` | Export model artifacts |
| GET | `/api/jobs/{job_id}/export-code` | Download standalone code (ZIP) |
| GET | `/api/jobs/{job_id}/log` | Execution log |
| POST | `/api/jobs/{job_id}/cancel` | Cancel running job |
| POST | `/api/jobs/{job_id}/retune` | Re-tune from a completed tune job (H-0062) |
| POST | `/api/jobs/{job_id}/resume` | Resume a failed tune job, continue remaining trials (H-0062) |
| GET | `/api/jobs/{job_id}/lineage` | Parent / child tree for re-tune chains (H-0062) |
| DELETE | `/api/jobs/{job_id}` | Delete job (query: `cascade=true` to remove descendants) |

### Inference

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/inference/upload` | Upload prediction data |
| POST | `/api/inference/run` | Run inference (`job_id`, `data`, `return_shap`) |
| GET | `/api/inference/history` | Inference history (query: `job_id`) |
| GET | `/api/inference/{inf_id}` | Inference summary |
| GET | `/api/inference/{inf_id}/predictions` | Prediction table (query: `rows`, `offset`) |
| GET | `/api/inference/{inf_id}/metrics` | Evaluation metrics (requires ground truth) |
| GET | `/api/inference/{inf_id}/plot/{plot_type}` | Evaluation plots |
| GET | `/api/inference/{inf_id}/download` | Download predictions as CSV |
| GET | `/api/inference/{inf_id}/comparison/{other_inf_id}` | Distribution comparison |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | Directory listing (query: `path`) — CSV/Parquet/TSV only |

### Operations (health / metrics)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Liveness probe (always 200 while the server runs) |
| GET | `/api/health/ready` | Readiness probe — returns ok only when the backend is loaded and the jobs directory is reachable (P-0084) |
| GET | `/api/metrics` | Prometheus exposition for the per-app `MetricsRegistry` (A-9): request counters, ML job durations, progress drops, terminal-replay rate (P-0093), … |

### WebSocket

| Path | Direction | Description |
|------|-----------|-------------|
| `/ws/jobs/{job_id}/progress` | Server → Client | Real-time training progress |

**Message types:** `progress`, `completed`, `error`, `paused`, `warning`, `ping` (30s keepalive). Terminal messages (`completed` / `error`) are cached per jobId for ~5 minutes (P-0093) so a late subscriber still receives them.

`warning` (`{type, job_id, message}`, P-0117 D4) is non-terminal and not cached: it is sent once for each distinct warning the job stores, for example lizyml's H-0140 memory estimate before a Fit or the first qualifying Tune trial. A late subscriber reads the stored set from `GET /api/jobs/{job_id}` `warnings`.

## Error codes

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `WORKSPACE_NO_CONFIG` | Config not set | 400 |
| `WORKSPACE_NO_DATA` | Data not loaded | 400 |
| `WORKSPACE_LOCKED` | Config write attempted while a job is running (P-0089 / #279) | 409 |
| `JOB_NOT_FOUND` | Job does not exist | 404 |
| `JOB_NOT_COMPLETED` | Job still running or failed | 400 |
| `JOB_CONFLICT` | Another job already holds the active slot | 409 |
| `JOB_CANCELLED` | Job was cancelled (terminal status; reported via WS error envelope) | — |
| `PARENT_LOCKED` | A re-tune / resume child is already running for this parent (H-0062) | 409 |
| `PICKLE_INCOMPATIBLE` | Re-tune / resume rejected because pickle schema or library major version differs (H-0062); unpause rejected before the relaunch because the stored study cannot be continued, e.g. one lizyml 0.15 wrote (`details.kind` `study_not_resumable`, P-0116 D4) | 400 |
| `REFIT_REQUIRED` | The stored model was written by an older backend version and lacks what the operation needs; fit again (P-0116 D4). `details.kind` is `shap_per_fold_state_missing` (SHAP importance and plots) or `export_param_names` (export-code of a Tuned job; `details.names` lists the names) | 400 |
| `VALIDATION_ERROR` | Config validation failed | 422 |
| `FILE_INVALID` | File read error | 400 |
| `PATH_NOT_FOUND` | Path does not exist | 400 |
| `BACKEND_ERROR` | ML backend library error | 500 |
| `BACKEND_INPUT_REJECTED` | The backend refused the user's data, e.g. a column name an export-code project cannot hold or a category value a saved model cannot hold (P-0117 D2). `details`: `backend_code` (lizyml's code), `reason`, `recovery_hint`, `context` (an allowlisted subset). Also the WebSocket `error.code` of a Fit or Tune job that fails this way | 400 |
| `MODEL_ARTIFACT_INVALID` | The backend cannot read a stored model, in a shape lizyml names: an unknown `category_identity_version`, a corrupted `identity_columns`, a pickle whose checksum differs from the recorded one, a `format_version` it does not read (P-0117 D2), or an `analysis_context.pkl` that cannot be unpickled (`reason` `unreadable_analysis_context`, P-0121). Any other load failure (an I/O failure, a missing or unparsable file) keeps its earlier answer: 500 `BACKEND_ERROR` on the routes that go through `backend_error_from`, and 500 `EXPORT_ERROR` on `POST /api/jobs/{job_id}/export` (model or report). `details` as for `BACKEND_INPUT_REJECTED`; the message is fixed text and holds no local path | 409 |
| `EXPORT_ERROR` | An unclassified failure of `POST /api/jobs/{job_id}/export` (model or report) (P-0121). The message is fixed text, `Export failed (<ExceptionType>)`, and never carries the exception's own text; `details` is `{}`. The exception and its traceback are logged on the server. Classified refusals keep their own codes | 500 |
| `INTERNAL_ERROR` | Unexpected server error | 500 |

## TypeScript type generation

Frontend types are auto-generated from the OpenAPI schema:

```bash
cd frontend
pnpm generate:api    # generates types from http://localhost:8501/openapi.json
```

Never hand-write API types — always regenerate from the backend.

---

_Last reconciled: 2026-05-01 against develop (post-PR #331). Changes since the previous sync: H-0062 re-tune / resume / lineage endpoints, P-0084 health endpoints, A-9 metrics endpoint, P-0086 fit/tune optional `config` body, P-0089 `WORKSPACE_LOCKED`, P-0093 WS terminal-replay note._

