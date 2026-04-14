# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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

[Unreleased]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nbx-liz/LizyStudio/releases/tag/v0.1.0
