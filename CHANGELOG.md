# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Bump `lizyml` minimum to `0.11.0` (<0.12.0)** — adopts upstream
  sMAPE / WAPE regression metrics (LizyML H-0071 / #101). The new
  metrics surface automatically through `MetricRegistry` lookup, so
  `tuning.optuna.params.direction` chips and learning curve filters
  list `smape` / `wape` for `task=regression` without further wiring.
  Defensive fallback list in `lizystudio.backends.lizyml_metrics`
  extended to include the two new metrics for parity. Unblocks the
  PR-C2 (#394) `severity=warning` + `suggested_fix` work, which can
  now propose `smape` as a zero-tolerant replacement for `mape` when
  the dataset target contains zeros.

## [0.4.0] - 2026-05-05

The **Wide DataFrame** release. Phase B (PR-B1 — PR-B5) closes the
v0.4.0 business-readiness Exit Criteria around 10,000-column workspace
support: the API ships value-bounded preview/importance payloads and a
diagnostic export, the SPA renders 10k-column Workspaces without
freezing, the upload path fails fast on oversize CSVs instead of
OOM-crashing the worker, and the validate envelope carries actionable
`severity` + `suggested_fix` fields the SPA can render directly.

No breaking changes. The new query parameters (`max_cols`, `top_n`)
default to the pre-v0.4.0 behaviour when omitted. The error dicts
returned by `POST /api/workspace/config/validate` add two fields
without removing the legacy `path` / `message` keys, so older
frontend builds keep working unchanged.

### Added

- **`max_cols` query on `GET /api/workspace/data/preview` (P-0097)** —
  optional cap on returned column count so the SPA does not have to
  ship 10k+ columns to the browser on every preview call.
  ``total_cols`` in the response always reflects the ground-truth
  column count. Backward compatible — omitting the parameter returns
  every column.
- **`top_n` query on `GET /api/jobs/{id}/importance` (P-0097)** —
  value-desc-sorted projection without an extra round-trip. Server
  also enforces a 5MB payload ceiling: when the unbounded response
  would exceed it, the route falls back to a top-N projection sized
  to fit and surfaces the truncation via `X-Truncated-By: top_n=<N>`
  response header.
- **`GET /api/diagnostic/export?job_id=...` (R-3.4 / P-0097)** —
  sanitised JSON snapshot a user can attach to a support request.
  Returns `{schema_version: 1, timestamp, job, system}` with no heavy
  artefacts inlined and no internal JobStore paths leaked. Heavy data
  (fit_result.json, model.pkl) stays on disk.
- **Wide-DataFrame fixture generator** at
  `tests/fixtures/lizyml/wide/generate.py` (10,000 columns × 1,000
  rows). The CSV itself is gitignored; CI generates it once at job
  start. Used by `tests/regression/test_reg_0361_wide_preview.py`.

### Frontend (PR-B2 — Wide DataFrame UI)

- **Column Settings virtualization** — `@tanstack/react-virtual`
  windows the per-column row list once the visible (non-target,
  filter-matched) count crosses 200. The Workspace can now show the
  configuration UI for 10,000-column workspaces without freezing
  scroll on first paint.
- **Searchable Target combobox** (`SearchableSelect`) — replaces the
  shadcn Select used for Target column with a cmdk-backed combobox.
  Substring filter, full keyboard navigation, scales to thousands of
  options. The Task radios and the rest of the Data Panel are
  unchanged.
- **Importance top-N toggle** — Plots panel now exposes a
  Show 30 / 100 / all toggle for the Importance table. Default is the
  server-side top-30 projection (uses the new `top_n` query) so the
  table fits well under the 5MB payload cap; users can opt back into
  the unbounded list per job.
- **Bulk Exclude / Include / Set type** — when the Column Settings
  filter matches one or more columns, a toolbar above the row list
  lets the user apply Exclude / Include / Set Numeric / Set
  Categorical to every filtered column in a single state update,
  collapsing N PUT-coalesce events into one.
- **Feature Weights 1k-column guard** — the Feature Weights toggle is
  disabled (with an inline explanatory message) when the workspace
  has more than 1,000 non-excluded columns. The per-feature weight
  picker is not the right interaction model at that scale; the guard
  surfaces the limit instead of silently breaking the UI.

### Backend (PR-B4 — Plot symmetric audit + Validate API enhancement)

- **Validate API now carries `severity` + `suggested_fix` (R-3.4)** —
  `POST /api/workspace/config/validate` and the inline validation in
  `PUT /api/workspace/config` now return error dicts with two new
  fields: `severity` (`"error" | "warning" | "info"`) and
  `suggested_fix` (string or `null`). Backend Pydantic errors default
  to `severity="error"` and `suggested_fix=null`; the workspace-aware
  `n_splits > n_rows` validator surfaces a concrete fix string
  (e.g. `"Set Folds (split.n_splits) to 100 or fewer."`). The legacy
  `path` and `message` fields are unchanged so older frontend builds
  continue to work.
- **Plot symmetric audit (R-3.3)** — added `docs/plot-matrix.md`, the
  single source of truth for the plot inventory across the LizyML
  adapter, the API, and the frontend. The audit caught `shap-summary`
  missing from `PLOT_LABELS` (rendered as raw kebab-case in the tab
  strip); fixed in this PR with the symmetry rule pinned in the doc.

### Backend (PR-B3 — Large CSV scaling + #383 stress tests)

- **Chunked CSV load with fail-fast memory guard (P-0098)** —
  `load_dataframe(path)` now routes CSVs above
  `CHUNKED_LOAD_THRESHOLD_BYTES = 50 MiB` through
  `pd.read_csv(chunksize=100_000)`. Between chunks it sums the deep
  memory usage and raises `FileInvalidError` as soon as the running
  total exceeds `LIZYSTUDIO_MAX_DF_MEMORY` — without waiting for
  pandas to materialise the rest of the file. Smaller files and all
  parquet files keep the existing single-shot read path. Public
  signature unchanged; only the failure timing is tightened so
  oversized uploads return a 4xx instead of OOM-crashing the worker.

### Test Infrastructure

- 14 new contract / regression tests under
  `tests/contract/test_preview_max_cols.py`,
  `tests/contract/test_importance_top_n.py`,
  `tests/contract/test_diagnostic_export.py`, and
  `tests/regression/test_reg_0361_wide_preview.py`.
- Frontend Vitest coverage for the wide-DataFrame UI: 28 cases on
  `ColumnSettingsSection` (virtualization branch + bulk toolbar),
  9 on `SearchableSelect`, 6 on the importance top-N toggle, 4 on
  the FeatureWeightsEditor 1k-column guard, and 4 bulk-handler cases
  on `useColumnOverrides`.
- 8 new cases on `tests/test_load_dataframe_chunked.py` pinning the
  fail-fast threshold + double-load prevention + parquet-passthrough
  invariants.
- 4 new cases on `tests/regression/test_reg_0027h_upload_concurrency.py`
  covering #383 (h): tempfile distinctness, no-loss tracking under
  contention, internally-consistent winner state, no 5xx surfaces.
- 6 new cases on `tests/bench/test_bench_large_dataset_memory.py`:
  3 latency benches (preview / describe / load_csv on the 100k-row
  fixture, opt-in via `--benchmark-only`) plus 3 invariants that
  enforce the memory guard contract regardless of bench mode.

## [0.3.1] - 2026-05-04

The **Stability & Refactor** release. Six weeks of post-v0.3.0 bug
fixes, internal refactors, and test infrastructure work absorbed into a
single patch release. Highlights: Workspace ConfigForm cross-hook write
race fully resolved (P-0092 single write funnel), inference plot type
hardening (Issue #355 / #373), Tailwind CSS v4 migration (#125), real
lizyml artefact fixtures with a fit→load round-trip CI gate (P-0095),
performance baseline harness (P-0094), on-disk `format_version`
migration chain (H-0081), atomic versioned JSON writes (H-0082), and
the openapi-fetch frontend client migration (H-0080).

No breaking changes for end users. Workspace state from v0.3.0
continues to load via the new migration chain. Note: model `pickle`
artefacts saved by lizyml 0.9.x are intentionally rejected on load
under the new lizyml 0.10.0 major.minor — re-fit existing jobs to
regenerate a 0.10.0 artefact.

### Added

- **Workspace write funnel (P-0092)** — `useConfigSync` is now the
  single PUT serialiser for `/config`. All four upstream writers
  (`ConfigForm` auto-reset, `useTargetSelection`, `useModelPanelData`,
  `handleApplyToFit`) route through the funnel hook with explicit
  state machine transitions. Closes the cross-hook competing-write
  race that had been patched four times since P-0086.
- **On-disk `format_version` (H-0081)** — every persisted JSON
  artefact now carries a `format_version` and is loaded through a
  migration chain. Sets up forward-compat for v0.4+ schema changes.
- **Atomic versioned JSON writer (H-0082)** — `write_versioned_json`
  uses `os.replace` for tear-resistant writes; partial-write states
  no longer corrupt persisted state across SIGKILL or power loss.
- **fit→load round-trip CI gate (P-0095, Issue #346)** — fit→artefact
  → reload integration test promoted to a required CI check, locking
  the metric-extraction shape evolution that produced #344 / #345.
  Backed by hand-captured real lizyml artefacts under
  `tests/fixtures/lizyml/<scenario>/` (4 scenarios).
- **Performance baseline harness (P-0094, Issue #27 (a))** —
  `pytest-benchmark` integrated into the test suite (`tests/bench/`),
  skipped by default (`--benchmark-skip` in addopts), surfaced via
  Nightly opt-in workflow with JSON artefact upload for future
  regression detection.
- **WebSocket terminal-message replay (P-0093, Issue #327)** — late
  subscribers now receive the cached terminal message so reconnecting
  clients converge to the correct final state without polling.
- **Workspace running-lock (Issue #279)** — `PUT/PATCH /config`
  returns 409 while a Fit/Tune job is active, preventing config
  drift mid-run. Carve-out for terminal slot holders preserves
  user undo/retune flow.
- **`/api/workspace/fit` and `/api/workspace/tune` accept optional
  `config` body (P-0086, Issue #251)** — frontend can now send the
  latest merged config in the same request, eliminating the
  PUT-then-FIT race window. Backward compatible: omitting the body
  uses the server-side persisted config as before.
- **Architecture overview docs (`docs/architecture-overview.md`)** —
  Mermaid diagrams (System Context, Container View, Module Layering,
  Job Lifecycle State Machine, 4 sequence diagrams) for new-reader
  onboarding ahead of BLUEPRINT.md.
- **Visual regression goldens for theme** (H-0078) — committed
  `__screenshots__` produced on the Nightly runner; raw Tailwind
  color guard script (B-9 Part 2 / H-0079) blocks regressions.
- **Issue #346 fixture strategy (Phases A-E)** — 4 scenarios of real
  fit_result.json / metadata.json captured, fixture-driven coverage
  added at metric / hook / component layers, contributing-guide
  section on fixtures published.

### Changed

- **`lizyml` bumped to `>=0.10.0,<0.11.0`** — picks up the
  TargetEncoder feature (lizyml H-0070 / Issue [#98](https://github.com/nbx-liz/LizyML/issues/98))
  so non-numeric classification targets (e.g. `species: str` in the
  penguins dataset) now fit successfully. `Model.predict()` returns
  predictions in the **original label dtype** (str → str), so
  `LizyMLAdapter.predict` is updated to split the multiclass 2-D
  `proba` matrix into per-class `proba_<class>` columns and propagates
  the original-label `pred` straight through to the inference
  DataFrame. Existing numeric-target jobs are unchanged.
- **Tailwind CSS v3 → v4 migration (Issue #125, PR #378)** —
  `tailwindcss@^4.2.4` with `@tailwindcss/vite` plugin; `@theme`
  block migrated; build remains on Vite. PostCSS pipeline simplified.
  Initial install requires `pnpm install --force` once for native
  binding.
- **Frontend API client migration to openapi-fetch (H-0080, C-6
  Phases 1-5)** — `apiFetch` retired across `files.ts`, `inference.ts`,
  `workspace.ts`, `jobs.ts`. `client.ts` now exports a typed
  `apiClient`; CI lint rule (`no-apifetch-guard`) blocks regressions.
- **CORS env allowlist + WS origin cache (H-0083, Issue #233/#234)** —
  CORS allowlist read from `LIZYSTUDIO_ALLOWED_ORIGINS`; WebSocket
  origin validation now caches resolved hosts.
- **Per-app `MetricsRegistry` and `ModelCache` (A-9 / H-0075,
  H-0084)** — both moved off module-globals onto
  `app.state` / `JobStore`; eliminates cross-app pollution in tests
  and embedded deployments.
- **Job persistence layout centralised in `JobStore.path_for`
  (A-10, H-0073)** — services no longer hand-construct on-disk paths.
- **`useDataPanel` split (B-5, H-0077)** — `useTargetSelection`
  extracted to remove the cross-hook write contention surface that
  P-0092 then formalised into the funnel.
- **`ModelPanel` split into hook + 3 sub-components (B-3)** — pure
  presentational components; data flow through dedicated hooks.
- **JobSummary / JobDetail / UiSchema typed at API boundary
  (C-4 / C-5a / H-0071 / H-0072)** — single source of truth from
  the FastAPI Pydantic models all the way to React props.
- **CV strategy fields auto-derived from UiSchema (C-5b)** — retires
  `CV_STRATEGY_FIELDS` / `METRICS_BY_TASK` hardcoded fallbacks.
- **WebSocket message Pydantic discriminated union (C-3, H-0069)** —
  WS payloads validated against typed schemas at both ends.
- **Sdist size 5 MB → 1.8 MB** — `[tool.hatch.build.targets.sdist]`
  added with explicit `include`/`exclude`; `frontend/`, `tests/`,
  `.github/`, BLUEPRINT.md / HISTORY.md / PLAN.md no longer
  shipped to PyPI.

### Fixed

- **Inference `shap-summary` 500 → wired through LizyMLAdapter
  dispatch (Issue #373, PR #377)** — uses `lizyml`'s built-in
  `importance_plot(kind="shap")`; previously surfaced as 500 because
  the adapter raised on the unknown plot type.
- **Inference upload-mode tempfile path (Issue #374, PR #375)** —
  `/api/inference/run` now accepts the tempfile path produced by
  the upload flow rather than rejecting it as out-of-tree.
- **Inference unknown plot type → 404 not 500 (Issue #355, PR #356)** —
  unknown plot types now return a normal 404 so the frontend can
  gate gracefully.
- **Probability histogram + distribution panel gating (Issue #370)** —
  no longer triggers a 500 when the distribution data is unavailable.
- **Load Preset replaced by menu-driven popover (Issue #369)** —
  removes the `<Select>` form-binding race that mis-applied presets.
- **DataPanel hydrates from server-persisted state on reload
  (Issue #363)** — refreshing the workspace tab no longer wipes
  the loaded data file.
- **CV strategy latched against stale cache reverts (Issue #358)** —
  user-picked `cv_strategy` is no longer overwritten by mid-flight
  cache invalidation.
- **Inference dropdown derives `#N` from `allJobs` not
  `completedJobs` (Issue #359)** — running jobs now appear in the
  dropdown with the correct ordinal.
- **`oos_std` derivation falls back to `oof_per_fold` (Issue #364)** —
  variance shows for older artefacts that lack `oof_std`.
- **Polling-storm after Tune terminal halted (Issue #339, PR #341)** —
  `useBackgroundNotification` no longer returns a fresh callback
  each render; post-terminal GETs reduced from 30 to 1.
- **Tune objective `Choice` empty + WS progress send-after-close
  (Issues #337, #338)** — empty Choice no longer crashes the Tune
  flow; WS progress writes guarded against post-close races.
- **Metrics: unwrap `raw` subtree when calibrated metrics also
  present (PR #344)** — single-source ROC curve when both raw and
  calibrated metrics exist.
- **`InferenceStore.list` skips corrupt records + pred-column guard
  (Issue #241)** — one bad record no longer breaks the listing API.
- **Workspace silent-late validation failures surfaced
  (Issues #268, #269, #270)** — the user now sees the validation
  error instead of a stuck UI.
- **`BlockedGroupKFold` payload nests `blocks/groups` (Issue #278)** —
  matches the server-side Pydantic model shape.
- **`SearchSpaceRow` button-in-button a11y violation (Issue #274)** —
  `<button>` wrapper replaced with `<div role="button">`.
- **Single-PUT task switch via `buildSyncedConfig` (Issue #272)** —
  task switching no longer fires PUT bursts that race with each other.
- **`FeatureWeightsEditor` excludes target + excluded features
  (P-0091, Issue #277)** — picker no longer shows the target column
  or already-excluded features.
- **UI schema ↔ Pydantic invariant locked (P-0087, Issues #258/#259)** —
  contract tests under `tests/contract/` lock the drift; closes the
  UI Fit 422 class.
- **Subprocess child stdout redirected to `execution.log`
  (Issue #328)** — child process logs now reach disk; previously
  swallowed by the parent.
- **WS late-subscriber replay (P-0093, Issue #327)** — see Added.
- **a11y: `aria-label` on `FeatureWeightsEditor` Switch** —
  screen-reader announces the toggle purpose.

### Deprecated

- **`apiFetch` removal (H-0080 Phase 5)** — no longer exported from
  `frontend/src/api/client.ts`. New code must use `apiClient`.
- **`CV_STRATEGY_FIELDS` / `METRICS_BY_TASK` hardcoded fallbacks** —
  retired in favour of UiSchema-driven SSOT (C-5b).

### Security

- **CORS env allowlist (H-0083)** — origins no longer hardcoded to
  development defaults; production deployments must set
  `LIZYSTUDIO_ALLOWED_ORIGINS`.
- **WebSocket origin validation cache (H-0083)** — guards against
  origin-spoof reconnect storms.
- **Atomic JSON writes (H-0082)** — partial-write states from
  SIGKILL or power loss can no longer corrupt persisted job /
  workspace state.

### Test Infrastructure

- **Real-artefact fixtures (Issue #346 Phase A)** — `tests/fixtures/
  lizyml/{binary_no_cal,binary_cal,multiclass,regression}/` ship
  hand-captured `fit_result.json` / `metadata.json` from a clean
  `lizyml` run. Fixture loaders under `tests/fixtures/_loader.py`.
- **fit→load round-trip CI gate (P-0095, Issue #346 Phase C)** — runs
  on every PR; blocks merge on metric-extraction drift.
- **`pytest-benchmark` baseline harness (P-0094, Issue #27 (a))** —
  Nightly-only by default; JSON artefact upload for trend tracking.
- **Branch protection on develop / main** — 8 required checks
  (backend 3.10 / 3.11, frontend lint / test / build, e2e
  functional, type-drift, no-apifetch-guard) enforced as of
  Issue #346 Phase C kickoff (2026-05-02).

## [0.3.0] - 2026-04-19

The **Operations & Hardening** release. Builds out the production-
readiness surface (health / metrics endpoints, CSP nonce, rate limiting
on the subprocess runner, cancellation & slot-release correctness) and
absorbs the long tail of post-v0.2.0 stabilization work: 13 security /
hardening fixes, 4 a11y passes, and an across-the-board test coverage
lift that ended with flaky-test management infrastructure in CI.

### Added

- **`/api/health` + `/api/health/ready` probes (Issue #30)** — k8s-style
  liveness / readiness endpoints. Liveness always returns 200 as long
  as the process is alive; readiness returns 503 when the JobStore
  directory is not writable.
- **`/api/metrics` Prometheus endpoint (Issue #30)** — exposes
  `jobs_total{type,status}`, `jobs_active`, process CPU / RSS, and
  `jobs_duration_seconds` histogram (buckets tuned for 0.5s – 10 min
  training jobs). Guarded by `LIZYSTUDIO_METRICS_ENABLED=false` to
  opt-out.
- **Workspace `ConfigDiffBadge` (#108)** — persistent visual indicator
  that the current config differs from the completed-job config that
  produced the visible Results, so users stop silently re-running Fit
  against stale assumptions.
- **Jobs page — Re-tune / Resume / Lineage UI (H-0067, #159)** —
  mirrors the Workspace-side Phase B affordances on the Jobs list so
  both pages can drive the full retune workflow. Shared components
  land in `components/retune/`.
- **Mobile Workspace layout (#178)** — sticky bottom-tab navigation
  (Data / Model / Results) below `md` breakpoint; desktop and tablet
  keep the 3-panel `ResizablePanelGroup` unchanged. New
  `useMediaQuery` hook backing the switch.
- **Flaky-test management (#29)** — `pytest-rerunfailures` + `flaky`
  / `quarantine` markers + non-blocking `backend-quarantine` CI job;
  Playwright `retries: 2` on CI only with `trace` / `video` retained
  on failure. Local runs stay retry-free so flakiness remains visible
  during development. Operations guide in BLUEPRINT.md §8.3.
- **Issue templates with tiering** (tech-task template, tier-aware
  fields) for triage consistency across bug / feature / refactor.
- **E2E coverage — file upload + session-restore flows (#91)** —
  `workspace-upload.spec.ts`, `session-restore.spec.ts` pinning the
  reload-mid-flow and `?job_id=` hydration contracts.
- **Nightly CI — Plotly CDN SRI check (#105)** — independent job that
  downloads the pinned Plotly bundle and verifies its SHA-384 SRI hash
  matches `services/export.py`, catching silent CDN content drift.

### Fixed

- **Subprocess cancellation race chain (#150 / #151 / #152 / #153)** —
  four interlocking subprocess-runner correctness fixes:
  - `#150`: drain child stderr concurrently to prevent a pipe-full
    deadlock where the parent's `proc.wait()` blocks forever after
    the child has already exited.
  - `#151`: bound the WebSocket progress queue and preserve terminal
    messages so a slow consumer cannot block the producer, and a
    `finished` / `failed` event is always delivered even under
    backpressure.
  - `#152` / `#153`: propagate cancel to the child subprocess
    (SIGTERM then SIGKILL after a grace window) and ensure the
    parent's `try / finally` still runs on SIGTERM so the active
    slot is always released.
- **Slot-release correctness (`7644057`, `c5f0f84`, `948251e`,
  `2e4e2ef`)** — `release active slot from subprocess paths`,
  `reconcile subprocess job state on cancel and abnormal exit`,
  `atomic create-and-claim to avoid orphan failed jobs`, and
  `emit failed-metric on workspace slot-claim failures` (#154).
  Invariant: the active slot is released on completion OR cancel OR
  abnormal exit OR crash, and `jobs_total{status=failed}` records
  every terminal-failure path.
- **Workspace reset during an active job (H-0063)** — `POST
  /workspace/reset` now synchronously cancels the active job and
  releases its slot, so a reset between E2E tests leaves the
  JobStore in a clean state without the earlier afterEach
  baseline-diff workaround.
- **Cancel/delete race (`23061e2`)** — harden the cancel path against
  transient `FileNotFoundError` during concurrent delete.
- **AUC direction bug (v0.2.0 follow-up: no new occurrences)** — the
  v0.2.0 defense-in-depth layers held; no regressions detected in
  this cycle's test additions.
- **Target-selection validation thrash (#107)** — eliminate transient
  "partial config PUT" race when the user changes the target column;
  consolidate syncKey construction into a shared helper so UI and
  backend see the same snapshot.
- **Empty `?job_id=` query-param (`c65a0c4`)** — normalize to `null`
  so ResultsPanel does not try to render an empty-string job id.
- **Job URL hydration (#101)** — Workspace now hydrates `currentJobId`
  from `?job_id=<id>` on mount and re-hydrates when the URL param
  changes (Jobs-page → Workspace deep link).
- **Inference R² on constant target (#156)** — returns NaN with a
  clear note instead of a divide-by-zero exception.
- **Security — path validation case-insensitivity (#155)** — switch to
  `Path.is_relative_to` so `/TMP/X` no longer escapes a `/tmp/`
  allow-list on case-insensitive filesystems.
- **Security — files API info disclosure (#157)** — stop echoing the
  server-resolved path on rejected file requests.
- **Security — deserialization + report output hardening
  (`56e3349`)** — narrow pickle-loader surface, reject absolute paths
  in report export targets, strip session tokens from rendered
  artifact filenames.
- **CSP nonce in HTML reports (#104)** — replace `'unsafe-inline'`
  with per-report CSP nonces so Plotly-generated reports no longer
  widen the app's content-security policy.
- **Plotly CDN SRI pinning (#92)** — exported reports ship with a
  pinned `sha384-...` SRI hash (verified nightly by the new workflow
  above).
- **A11y — color contrast + scrollable-region focusable (#90, #167,
  #168, #170)** — four separate passes: `bg-green-600 → 700`
  (3.29:1 → 4.5:1), `text-destructive → text-red-700/400` on outline
  buttons (3.76:1 → 4.5:1+), `--lzs-accent` / `--sidebar-primary`
  lightness drops to 50% / 42% for AA on white, keyboard-accessible
  scroll wrappers on each Workspace panel (axe
  `scrollable-region-focusable`), button-name / aria-valid-attr-value
  cleanup.
- **Vitest jsdom → happy-dom migration (#111)** — ~3× faster test
  runs and closer alignment with the actual browser surface used by
  Vite.
- **PR #141 regressions (`879c05e`)** — seven follow-up fixes in the
  target-selection / tier-4 refactor batch surfaced by CR.

### Changed

- **File splits (no behavior change):**
  - `backends/lizyml/adapter.py` → Mixin modules (#117) —
    `adapter_fit.py`, `adapter_tune.py`, `adapter_retune.py`,
    `adapter_inference.py` composed via a slim `LizyMLAdapter` class.
  - `frontend/src/hooks/useDataPanel.ts` → focused hooks (#88) —
    split into `useDataLoad`, `useColumnOverrides`, `useDataPanel`
    that reference the new hooks.
  - `services/retune_subprocess.py` consolidation (#118) — shared
    orchestrator replaces the two nearly-duplicated call paths in
    `training.py` and `training_retune.py`.
- **`tsconfig.json` redesign (#165)** — Vite standard dual-tsconfig
  (root `references`-only / `tsconfig.app.json` / `tsconfig.node.json`
  with `composite: true`), drop deprecated `baseUrl`, extend `include`
  to cover `tests/e2e/**` and config files so CI `tsc` now type-checks
  the full frontend surface. `vite.config.ts` switches to
  `vite-tsconfig-paths` plugin; `vitest.config.ts` keeps the explicit
  alias to avoid a Vitest 4 worker-teardown timeout on Node 18.
- **`ux: promote Re-Tune / Resume / Export Code buttons` (#121)** —
  upgrade from `variant="outline"` to `default` so the primary next
  action on a completed job is visually primary, matching the rest
  of the Jobs page footer.
- **BLUEPRINT.md sync (#158)** — Protocol / Jobs API / Directory /
  CSP / testing sections re-aligned with v0.2.0+ implementation;
  no spec drift outstanding at release time.
- **Config internal key stripping (#115)** — `tuning.optuna` and
  `tune_result` sections scrub internal-only fields on save so API
  consumers and exported YAML never leak implementation details.
- **`fast-deep-equal` replaces `JSON.stringify` deep-equal (#129)** —
  measurable reduction in render thrash on the Model panel.
- **Frontend `engines.node >= 20` (#122)** — aligns with CI and Vite 6
  requirements; adds `frontend/README.md` declaring the contract.
- **Storybook 8 → 10 migration** — plus test-runner and
  `vitest-istanbul` coverage integration.
- **Dependabot groups + auto-merge workflow** — active on main branch
  (Issue #26 / activated post-merge of #82).

### Internal

- **Test infrastructure overhaul** — 13 under-tested frontend modules
  raised above 80% coverage (#130); `*_coverage.py` sidecar test
  files merged into primary test files (#89); WS backpressure / API
  5xx branches now covered (#162 / #163); NullableNumberField +
  useConfigSync coverage added (#160 / #161); cross-parent retune
  race guarded and asserted (#116).
- **`as-implemented` architecture + coupling analysis** (`1288d96`)
  documents every module's dependency surface, producing the
  coupling-refactor roadmap tracked in `docs/coupling-analysis.md`.
- **`chore(gitignore): untrack analysis/`** — removes a directory of
  generated analysis artifacts from the repo.
- **Subprocess runner — tail-read progress file** (`3588819`) instead
  of re-parsing the whole file per tick; bounded memory regardless
  of run length.

### Known issues

- **`session-restore.spec.ts:32`** has a sub-second race between
  job-completion and the backend's post-hook write to
  `ws.current_job_id`. Surfaces intermittently on CI; auto-retried
  under the new flaky-test management (#29) and the UI fallback via
  `?job_id=` URL param is unaffected. Root-cause fix deferred.
- **`visual/theme-regression.spec.ts:51 "dark mode jobs page"`**
  visual golden is sensitive to accumulated Jobs state under
  `/tmp/e2e_jobs/`. Confirmed pre-existing on `develop`; not a
  regression introduced by this release.

### Acceptance gates

- Backend: 1074 pytest passed, mypy clean, ruff clean, coverage ≥ 80%
- Frontend: 1480 vitest passed, build success, biome 0 errors
- E2E: 96 chromium / 91 chromium-tablet / 90 chromium-mobile passing
  (intentional mobile skips for 3-panel-only tests + 1 pre-existing
  session-restore flaky + Jobs-state-dependent visual flakies) —
  retries are now handled by the flaky-test infra.

## [0.2.0] - 2026-04-14

The Re-tune Dashboard release. Adds a full Phase A + Phase B re-tune
workflow on top of the existing Workspace, plus a CRITICAL fix for AUC
direction handling that affected every default tune run.

### Added
- **Re-tune Dashboard Phase A (H-0061)** — multi-round re-tune within a
  single tune job: Round History table, Convergence Signal panel,
  Boundary Detail, Search Space Evolution panel, Apply to Fit shortcut.
- **Re-tune Dashboard Phase B (H-0062)** — incremental checkpoint
  persistence + Job lineage + Re-tune (+N trials) and Resume actions:
  - `LizyMLAdapter.save_checkpoint` / `load_checkpoint` via cloudpickle
    with atomic temp+rename and a `model_meta.json` sidecar capturing
    lizyml / lightgbm / optuna versions and a pickle schema version.
  - Synchronous pickle pre-flight check (`PICKLE_PREFLIGHT_FAILED`) and
    version compatibility check (`PICKLE_INCOMPATIBLE`) before any
    background work runs.
  - `Job.parent_job_id`, `child_job_ids`, lineage tree and cascade delete
    semantics.
  - Per-parent exclusive Re-tune lock with `PARENT_LOCKED` (409) so two
    concurrent re-tunes on the same parent cannot race the checkpoint.
  - New endpoints: `POST /api/jobs/{id}/retune`, `POST /api/jobs/{id}/resume`,
    `GET /api/jobs/{id}/lineage`, `DELETE /api/jobs/{id}?cascade=bool`.
  - Frontend `RetuneActionButton`, `ResumeActionButton`, `JobLineageTree`,
    Lineage panel wired into `ResultsCompletedView`.
  - Multi-generation chains allowed (A → B → C → ...) — grandchild
    re-tune is supported by design (Decision flip 2026-04-14).

### Fixed
- **CRITICAL: AUC was being optimized as low-is-better.** The default
  workspace inject path hardcoded `direction: minimize` and the
  `_prepare_tune_config` auto-resolver was guarded by `"direction" not
  in params`, so any fresh tune with the default AUC metric ran with
  the wrong direction and produced meaningless `best_params`. The fix
  is defense-in-depth across five layers: drop the hardcoded direction,
  switch the resolver to "always reconcile with metric", add a
  defensive frontend useEffect, add backend + E2E regression tests, and
  document the bug + cleanup steps in HISTORY.md. Existing binary+auc
  tune jobs persisted with `direction: minimize` should be deleted
  manually (their `best_params` are inverted).
- **Resume from checkpoint failed with "Cannot resume tuning: no
  previous tune() call".** lizyml only assigns `self._study` at the end
  of `Model.tune()`'s body, so per-trial bridge saves persisted models
  with `_study=None`. Added an explicit final `save_checkpoint` after
  the tune loop completes.
- **Re-tune was 8x slower than fresh tune.** `start_retune_async` did
  not honor `openmp_detect.should_use_subprocess()`, so the daemon
  thread bound OpenMP's pool to itself. Now dispatches through the
  subprocess runner like `start_fit_async` / `start_tune_async`.
- **Re-tune Running view appeared to start from 0.** The bridge's
  `accumulated_trials` was reset on every call. It is now seeded from
  the parent's `_tuning_result.trials` so the chart and table show the
  full history continuously.
- **Stale `objective` / `metric` after switching task.** ConfigForm
  resets `objective` and `metric` on task change when the current value
  is incompatible. Backend mirrors via `_task_params_compat_errors` so
  API-direct callers and old config files are also rejected.
- **Concurrency hardening (deep-review C1/H1/H2/M1/M2):** atomic
  `JobStore.rebind_parent_lock` replaces the release+acquire race;
  subprocess cancel escape via `proc.terminate` + bounded `proc.wait`;
  shared `_mark_retune_child_failed` helper avoids orphan-pending
  children; isinstance guards in `_task_params_compat_errors` /
  `_strip_internal_keys`; partial metric mismatch policy flipped from
  "all invalid" to "any invalid"; narrowed broad `except Exception` on
  the final save; corrupted `model_meta.json` returns 400
  `PICKLE_INCOMPATIBLE` instead of 500.
- **Learning curve metric filter** sourced from real `eval_history`
  instead of `config.model.params.metric`, so calibration / feval-only
  metrics show up correctly. Filter is reset on job switch and
  surfaces fetch errors instead of silently masking them.

### Changed
- **File splits (H-0062 cleanup, no behavior change):**
  - `backends/lizyml.py` (1033 lines) → `backends/lizyml/` package
    (`pickle_compat.py` + `serialization.py` + `config_compat.py` +
    `adapter.py` + `__init__.py`).
  - `services/training.py` (826 lines) → `training.py` (548) +
    `training_retune.py` (345).
  - `api/jobs.py` (766 lines) → `jobs.py` (467) + `api/retune.py` (328).
  - All splits keep the public import surface unchanged via re-exports.
- **`_prepare_tune_config` always reconciles `direction`** with the
  optimization metric instead of only filling in when missing. The
  previous "preserve user override" contract is dropped — metric is
  the single source of truth.
- E2E test fixtures no longer hardcode `direction: minimize`; auto
  resolution is exercised end-to-end and asserted.

### Acceptance gates
- Backend: 949 pytest passed, mypy clean, ruff clean, coverage 97%
- Frontend: 1270 vitest passed, build success, biome 0 errors
- E2E: 33 cases recognised in `retune-flow.spec.ts` (including 5 new
  scenarios for cancel, parent lock, pickle incompatibility, and
  lineage UI)

## [0.1.2] - 2026-04-10

### Fixed
- Align parameter defaults between backend and frontend
- Fix Jobs page plot rendering issues
- Add `inner_valid` filtering for cross-validation results

### Changed
- Harden CI version safety with multi-layer protection

## [0.1.1] - 2026-04-08

### Added
- Literal types to Pydantic response models for stricter API contracts
- pytest unit/integration markers for selective test execution
- Page-level ErrorBoundary for graceful frontend error handling
- Vitest coverage thresholds raised to 80/70/75/80

### Fixed
- Inference target detection and export browse button
- ModelPanel coverage gaps

### Changed
- Split 7 large frontend components into smaller modules
- Split `lizyml_ui_schema` into dedicated `constants` and `metrics` modules
- Align BLUEPRINT and HISTORY with implementation (H-0055–H-0060)

## [0.1.0] - 2026-04-07

### Added
- **Workspace** — single-page iterative workflow: data setup → model config → fit → results
- **Jobs** — lifecycle management, result browsing, model export for fit/tune runs
- **Inference** — apply trained models to new data with optional SHAP explanations
- JSON-Schema-driven config forms (Pydantic → JSON Schema → dynamic UI)
- BackendAdapter architecture for pluggable ML backends
- LizyML adapter (LightGBM + scikit-learn via LizyML)
- Real-time training progress via WebSocket
- Job persistence to disk (survives server restarts)
- CV fold preview, column statistics, value distribution bars
- BlockedGroupKFold 2-axis editor
- Tune tab with search space configuration and default range population
- Feature importance with kind selection (split, gain, SHAP)
- Learning curve plots with fold filtering
- KPI cards on Jobs detail page
- Config edit lock during training
- Export model artifacts and standalone Python code
- CSP security headers
- OpenMP daemon thread degradation detection
- DataFrame memory limit checks
- CI pipeline (GitHub Actions): Ruff, mypy, pytest, Biome, Vitest
- PyPI publishing via `gh-action-pypi-publish`

[Unreleased]: https://github.com/nbx-liz/LizyStudio/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/nbx-liz/LizyStudio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nbx-liz/LizyStudio/releases/tag/v0.1.0
