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
- **Error format:**
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
| PUT | `/api/workspace/config` | Replace config |
| PATCH | `/api/workspace/config` | Partial config update |
| POST | `/api/workspace/config/validate` | Validate config (dry run) |
| POST | `/api/workspace/config/upload` | Load config from YAML/JSON file |
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
| GET | `/api/jobs/{job_id}` | Job details (meta + result summary) |
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

**Message types:** `progress`, `completed`, `error`, `ping` (30s keepalive). Terminal messages (`completed` / `error`) are cached per jobId for ~5 minutes (P-0093) so a late subscriber still receives them.

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
| `PICKLE_INCOMPATIBLE` | Re-tune / resume rejected because pickle schema or library major version differs (H-0062) | 400 |
| `VALIDATION_ERROR` | Config validation failed | 422 |
| `FILE_INVALID` | File read error | 400 |
| `PATH_NOT_FOUND` | Path does not exist | 400 |
| `BACKEND_ERROR` | ML backend library error | 500 |
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

