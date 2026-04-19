# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
