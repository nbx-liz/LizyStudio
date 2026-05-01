# Architecture

This document provides a user-friendly overview of LizyStudio's architecture.
For the full specification, see [BLUEPRINT.md](../BLUEPRINT.md) §3.

## System overview

```
┌──────────────┐     HTTP / WS      ┌──────────────────────────────┐
│   Browser    │ ◄────────────────► │       FastAPI Server          │
│  React SPA   │   localhost:8501   │                              │
│ (shadcn/ui)  │                    │  api/      ← Router          │
└──────────────┘                    │  services/ ← Session & Logic │
                                    │  backends/ ← Adapter Layer   │
                                    │  ws/       ← WebSocket       │
                                    └──────────┬───────────────────┘
                                               │
                                    ┌──────────▼───────────────────┐
                                    │    BackendAdapter Protocol    │
                                    │   (pluggable ML backends)    │
                                    ├──────────────────────────────┤
                                    │  LizyML Adapter (current)    │
                                    │  Future adapters ...         │
                                    └──────────────────────────────┘
```

LizyStudio is a **single-user, local-first** web application.
The browser runs a React SPA that communicates with a FastAPI server via REST and
WebSocket. The server delegates all ML operations to backend adapters.

## Layer responsibilities

| Layer | Location | Responsibility | Prohibited |
|-------|----------|----------------|------------|
| **Page** | `frontend/src/pages/` | Screen layout, routing | Direct API calls |
| **Component** | `frontend/src/components/` | Reusable UI widgets | Business logic |
| **API Client** | `frontend/src/api/` | HTTP communication, typed requests | State management |
| **Router** | `src/lizystudio/api/` | Request validation, response formatting | Calling ML libraries directly |
| **Service** | `src/lizystudio/services/` | Session state, orchestration | HTTP/WS knowledge, backend-specific types |
| **Adapter** | `src/lizystudio/backends/` | ML backend calls, type conversion | HTTP/session state knowledge |
| **WebSocket** | `src/lizystudio/ws/` | Real-time progress delivery | Business logic |

### Key principle: separation of concerns

The frontend never calls ML libraries directly — everything goes through the REST
API. The service layer never touches backend-specific types — the adapter converts
them to common types (`FitSummary`, `PlotData`, etc.).

## State management

LizyStudio manages two distinct types of state:

### Volatile state (in-memory)

The **Workspace** holds the current session state:
- Selected backend, config, loaded data, and current result
- Resets when the browser tab closes
- Only stores the most recent fit/tune result

### Persistent state (disk)

**Jobs** and **Inference results** are persisted to disk:
- Default location: `.lizystudio/jobs/`
- Survives server restarts
- Each job stores: config, data reference, results, model artifacts

## Data flow

### Fit / Tune workflow

```
User configures form  →  PUT /api/workspace/config
User uploads data     →  POST /api/workspace/data/upload
User clicks Fit       →  POST /api/workspace/fit  (optional body { config } overrides ws.config atomically — P-0086)
                          │
                          ├── Service claims the active-job slot (P-0089)
                          │     └── Subsequent PUT/PATCH /config return 409 WORKSPACE_LOCKED until release
                          ├── Service creates Job (pending) and writes meta.json
                          ├── Adapter.create_model()
                          ├── Adapter.fit() with progress callback
                          │     └── WebSocket: progress updates + terminal completed/error (cached for ~5 min so late subscribers still see it — P-0093)
                          ├── Job status → completed / failed / cancelled, slot released
                          └── Response: { job_id }
```

### Inference workflow

```
User selects model  →  POST /api/inference/run { job_id, data }
                        │
                        ├── Service loads saved model
                        ├── Adapter.predict()
                        ├── Saves predictions + metrics to disk
                        └── Response: { inf_id }
```

## Type safety chain

LizyStudio maintains a type-safe pipeline from backend to frontend:

```
Pydantic models  →  OpenAPI schema  →  openapi-typescript  →  TypeScript types
   (Python)           (auto-gen)         (auto-gen)            (frontend)
```

API types in the frontend are **never hand-written**. Run `pnpm generate:api` to
regenerate them from the backend's OpenAPI spec.

## Config forms

Config forms are **JSON Schema-driven**:

1. The backend adapter exposes `get_config_schema()` → JSON Schema
2. The backend adapter exposes `get_ui_schema()` → UI hints (labels, groups, etc.)
3. The frontend renders form fields dynamically from the schema
4. Validation happens on the backend (Pydantic), not the frontend

This means adding a new config parameter to an ML backend requires **no frontend
code changes** — the form updates automatically.

## Further reading

- [BLUEPRINT.md](../BLUEPRINT.md) — full specification
- [Adapter Guide](adapter-guide.md) — how to implement a new ML backend
- [API Reference](api.md) — REST API endpoints

---

_Last reconciled: 2026-05-01 against develop (post-PR #331). High-level layout unchanged since the previous sync; only the Fit/Tune workflow box was updated to reflect P-0086 (config body) / P-0089 (active-job lock) / P-0093 (terminal-message replay)._

