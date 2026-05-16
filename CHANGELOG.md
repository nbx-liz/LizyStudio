# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.1] - 2026-05-16

The **Tune backend SSOT consolidation + StudioError observability** patch
release. Lands the full P-0109 chain (PRs #516..#524) that
re-architects the Tune workflow around an intent/effective split:
backend adapters now own Tune defaults, the workspace persists only
sparse user intent, and the frontend reads via a dedicated
`/config/tuning-snapshot` endpoint. The first-mount Fixed-defaults
display bug ([2026-05-14 confirmed](HISTORY.md)) is structurally
resolved by PR-5 (#521) — three racing `useEffect`s in the Tune tab
are physically deleted, replaced by render-time fallbacks driven by
`tuning_effective`. Bundles a small observability follow-up (#513 /
PR #515) that logs every `StudioError` at WARNING level.

Bundles:

1. **P-0109 Tune SSOT consolidation (Option B, no schema bump)** —
   `BackendCore` gains `get_tuning_defaults` / `compute_effective_tuning`
   (#517); `LizyMLAdapter` implements them with task-aware defaults
   and direction derivation from the effective first metric (#518,
   #523); `GET /config/tuning-snapshot` + `PUT /config/tuning-overrides`
   added (#519); `WorkspaceState.tuning_overrides` becomes a
   first-class field with INV-T6 snapshot freeze at job-start (#520);
   three Tune-tab `useEffect`s deleted + render-time fallbacks (#521);
   `useTuningSnapshot` TanStack hook + `SearchSpaceRow` "Modified"
   badge + `TASK_DEFAULT_METRICS` frontend constant deleted (#524);
   docs / HISTORY Decision flip / BLUEPRINT / architecture-as-implemented
   reconciled (#522).
2. **StudioError observability (#513 / PR #515)** —
   `studio_error_handler` now emits a WARNING-level log line
   (`code` / `status_code` / `method` / `path`) for every
   `StudioError`, with `details` deliberately excluded to avoid
   leaking user-supplied input. Precursor to R-3.1 typed-error work.

### Added

- **`BackendCore.get_tuning_defaults(task)` Protocol method
  (P-0109 / #517)** — backend-owned per-task tuning defaults
  (search space, n_trials, sampler/pruner, evaluation metric list).
  Returned snapshot is read-only and consumed by both the frontend
  (Tune tab seed) and the service layer (effective composition).
- **`BackendCore.compute_effective_tuning(defaults, overrides, task)`
  Protocol method (P-0109 / #517 / #523)** — pure SSOT for
  intent/effective composition. Computes the effective Tune state by
  merging sparse overrides over defaults; `direction` is derived from
  the effective first metric so a metric-list override propagates to
  the optimization direction automatically. Returns
  `user_set_paths` so the UI can mark per-row "Modified" badges.
- **`GET /api/workspace/config/tuning-snapshot` (P-0109 / #519,
  augmented in #524)** — returns
  `{tuning_effective, tuning_defaults, tuning_overrides}`. Primary
  read path for the Tune tab; `tuning_effective.user_set_paths`
  drives the "Modified" badge.
- **`PUT /api/workspace/config/tuning-overrides` (P-0109 / #519)** —
  accepts a sparse `TuningOverrides` body with REPLACE semantics.
  Persists user intent without writing catalog defaults to disk.
- **`SearchSpaceRow` "Modified" badge (P-0109 / #524)** — rendered
  when the row's path appears in `tuning_effective.user_set_paths`,
  giving users a clear visual cue for which entries they have
  explicitly edited vs. catalog defaults.
- **`useTuningSnapshot` TanStack Query hook (P-0109 / #524)** —
  canonical client-side accessor for the snapshot endpoint with
  TanStack cache key alignment (`['workspace', 'tuning-snapshot']`).

### Changed

- **`LizyMLAdapter.compute_effective_tuning` direction derivation
  (P-0109 / #523)** — now computes `direction` from the *effective*
  first metric (after override) rather than the default first metric.
  Ensures that overriding `evaluation_metrics` also flips the
  optimization direction when needed (e.g. accuracy → log_loss).
- **`services/training.py::_prepare_tune_config` (P-0109 / #523)** —
  the hard-coded `maximize_metrics = {"auc","auc_pr","r2","accuracy","f1","auc_mu"}`
  set is removed. Direction resolution now flows exclusively through
  the adapter SSOT, eliminating one of two duplicated direction
  catalogs (INV-T3).
- **Frontend `TASK_DEFAULT_METRICS` constant deleted (P-0109 / #524)** —
  the canonical default metric list is taken from
  `tuning_defaults.evaluation_metrics` via the snapshot endpoint;
  the duplicated frontend catalog is gone.
- **Three Tune-tab `useEffect`s physically deleted (P-0109 / #521)** —
  `TuneTab` search-space initialization, `TuneEvaluationSection`
  direction sync, and metrics-seed effects are replaced by
  render-time fallbacks. The first-mount Fixed-defaults bug
  (which manifested as a flash of catalog defaults before the
  effects synced) cannot recur because there is no longer any
  client-side derivation race.

### Fixed

- **StudioError observability — every 4xx now logged (#513 / #515)** —
  `api/errors.py::studio_error_handler` emits a WARNING-level log
  line per error: `StudioError <CODE> (<status>) at <METHOD> <PATH>`.
  Operators can now correlate user-reported 4xx errors with server
  log entries. `details` deliberately excluded from the WARNING
  channel to avoid logging user-supplied input.

### Compatibility

- **on-disk `STUDIO_FORMAT_VERSION` is unchanged (still 2)** —
  P-0109 deliberately took **Option B** (no schema bump). The
  `WorkspaceConfig.tuning` block on disk retains its v2 shape;
  `absorb_legacy_tuning` / `get_legacy_config_view` bidirectional
  shims absorb legacy nested writes into `WorkspaceState.tuning_overrides`
  at load/save time. INV-T7 (on-disk schema stability) is trivially
  preserved.
- **Legacy `PUT /api/workspace/config` (with embedded `tuning` block)
  continues to work** — Tune-tab edits currently route through this
  legacy endpoint; A-2 follow-up issue tracks routing them through
  the new `PUT /config/tuning-overrides` (sparse) endpoint.
- **No behaviour change to `tune_result.trials` / Optuna re-attach** —
  PR #420 / v3-20 Tune resume semantics are unaffected.

### Internal

- `BackendAdapter` Protocol extended with `TuningDefaults` /
  `TuningOverrides` / `TuningConfig` common types (P-0109 / #517).
- `WorkspaceState.tuning_overrides` is now a first-class field on
  the state dataclass (P-0109 / #520); `materialize_tuning_for_job`
  produces an immutable snapshot at job-start (INV-T6).
- The `_assert_inv_t3(...)` warn-only helper added in PR #523 is
  currently *not invoked* — the assertion adds tens-of-ms read-only
  latency before `backend.tune(...)` and interacts with the
  pause-observation timing in `tune-resume.spec.ts:185`. The helper
  is retained in source; re-enablement is tracked as follow-up
  issue A-1. The INV-T3 guarantee itself is unaffected — it is
  enforced by `LizyMLAdapter.compute_effective_tuning`.
- HISTORY P-0109 row flipped to **Decision: Approved & shipped
  (Option B, 2026-05-15)**; ROADMAP §3 P-0109 line moved to the
  "shipped" tier; BLUEPRINT §Tune Adapter section updated to
  reference the intent/effective split (#522).

## [0.6.0] - 2026-05-13

The **Tune workflow polish + v0.5 Exit Criteria closure** release.
Completes the v0.5 reliability theme by landing the last open phase
(`PLAN.md` v3-26 / R-4.2 Pickle compat nightly CI, `HISTORY.md`
P-0107), overhauls the Tune setup UX end-to-end against the LizyML
v0.15 SSOT (P-0104 Wave 1-3), introduces a run-gate check for
structurally-broken search spaces (P-0108 / Issue #474), and moves
metric-compat watchlist ownership from the Service layer into a new
`BackendCore.get_incompatible_metrics` capability (P-0106) as a
forward step toward a second ML backend.

Bundles:

1. **Tune workflow overhaul (P-0104)** — canonical Range / Choice
   defaults + `Fit seed=1120` alignment; integer guard + inline
   warning on NumberInput; `inner_valid` picker with auto-populated
   Evaluation defaults; Re-tune Settings `enabled` switch; UiSchema
   `objective` / `parameter_bounds` / `metric` all wired through to
   the LizyML v0.15 SSOT (`model_metric` removed).
2. **Residuals plot kind selector (P-0105)** — 3-panel layout
   mirroring the Importance plot pattern (Issue #457).
3. **Pickle compat nightly + structured `PICKLE_INCOMPATIBLE` envelope
   (P-0107 / v3-26 / R-4.2)** — past-N=3-minor lizyml matrix gates
   silent cross-version load in the Nightly workflow; the 400
   envelope now carries `kind` (`schema_mismatch` /
   `lizyml_version_mismatch` / `corrupt_meta`), `recovery_hint`, and
   `suggested_fix` so the frontend can render actionable guidance.
4. **Search-space run-gate validation (P-0108 / Issue #474)** —
   inverted Range and `log + low<=0` search-space entries are now
   rejected at `POST /tune` with a 422 + concrete `suggested_fix`,
   *before* the tune job launches. `PUT /config` stays permissive so
   in-flight edits persist (PR #473 post-mortem).
5. **Backend capability split (P-0106 / Issue #403)** — metric-compat
   watchlist (MAPE / RMSLE / R² preconditions + the sMAPE/WAPE
   alternative suggestion) moves from `Service.validate_config` into
   `BackendCore.get_incompatible_metrics`. Service layer becomes
   metric-agnostic; a future second backend declares its own
   vocabulary.
6. **Backend refactor closing chapter (#451 / #452 / #456)** —
   `services/jobs.py` (1062 → 522 lines) split into 4 focused
   modules + a thin orchestrator façade (`JobMetadataStore`,
   `ActiveJobSlot`, `JobControlFlags`, `JobLineage`); helper splits
   on `workspace_reset`, `_run_job_core`, `run_job_in_subprocess`;
   stray-artefact + orphan-golden CI gates.

### Added

- **`BackendCore.validate_search_space(space)` Protocol method
  (P-0108)** — structural validation of `tuning.optuna.space`
  entries. The lizyml adapter implements it via `parse_space()` and
  filters out empty-choices categoricals (frontend owns that UX).
  Default `return []` keeps minimal backends working unchanged.
- **`BackendCore.get_incompatible_metrics(task, target, names)`
  Protocol method (P-0106)** — backend-owned advisory for
  configured metrics whose target preconditions the loaded dataset
  violates. lizyml implements MAPE / RMSLE / R² preconditions plus
  the sMAPE / WAPE replacement suggestion.
- **`PICKLE_INCOMPATIBLE` envelope `details.kind` +
  `recovery_hint` + `suggested_fix` (P-0107)** — new additive
  fields on the existing 400 response. `kind` is one of
  `"schema_mismatch"` / `"lizyml_version_mismatch"` /
  `"corrupt_meta"` / `"unknown"`. Backwards-compatible: legacy
  clients consuming only `code` + `message` are unaffected.
- **Nightly `pickle-compat` job + `scripts/pickle_compat_matrix.sh`
  (v3-26)** — installs past-N=3-minor lizyml releases into
  ephemeral venvs, saves a sidecar with each, then verifies the
  runtime rejects every one with the structured envelope. Silent
  load is `exit 1`.
- **Residuals plot kind selector (P-0105)** — `available_residuals_kinds`
  drives a 3-panel layout for Predicted vs. Actual / Residuals vs.
  Predicted / Residuals histogram (Issue #457).
- **Tune Evaluation auto-populate** — Evaluation `metrics` are
  pre-filled from the model defaults when the Tune tab opens, with
  an `inner_valid` picker so the user can select which fold drives
  the Optuna objective.
- **Re-tune Settings `enabled` Switch** — Re-tune dialogue exposes an
  explicit enable toggle that sends `null` for unchanged fields,
  removing the UX ambiguity where a blank input could mean either
  "keep the default" or "clear the value".
- **NumberInput integer guard + inline warning** — decimal input on
  fields that the schema declares integer is caught client-side
  with an inline message, before the request reaches the backend
  (P-0104 Wave 2.4 / Issue #460).
- **Stray-artefact pre-commit hook + orphan-visual-golden CI gate
  (#456 L1-L4)** — `.tmp` / build droppings cannot accidentally land
  on develop; an obsolete Playwright golden cannot survive a
  test deletion.

### Changed

- **Tune defaults aligned to v0.15 SSOT (P-0104 Wave 2.2 / Wave 3.1a /
  Wave 3.1b)** — canonical `Range` / `Choice` defaults pulled from
  the LizyML UiSchema, `Fit seed = 1120` for parity with the
  default `search_space_catalog` seed. `objective` /
  `parameter_bounds` / `metric` are now read from the LizyML
  registry instead of duplicated Studio constants;
  `model_metric` field removed.
- **`services/jobs.py` (1062 → 522 lines, #451)** — split into
  `_job_metadata.py` (344L) / `_job_active_slot.py` (201L) /
  `_job_control_flags.py` (214L) / `_job_lineage.py` (200L) +
  thin orchestrator. Public Protocol unchanged; all call sites
  and tests remain unmodified.
- **`services/workspace.py::_workspace_metric_compatibility_errors`
  collapsed to a thin envelope (P-0106)** — type narrowing +
  adapter dispatch only. Backwards-compatible (INV-metric-1: the
  emitted envelope is byte-identical to v0.5.0).
- **`subprocess_runner.run_job_in_subprocess` / `workspace_reset` /
  `_run_job_core` split into helpers (#452)** — pure refactors;
  no behaviour change; each helper carries focused
  responsibilities (~40-60 lines instead of one ~130L function).
- **`lizyml` dependency: `>=0.15.0, <0.16.0`** (bumped from
  `>=0.12.0, <0.13.0`, #464) — required by the P-0104 Wave 3.1a /
  3.1b SSOT migration.

### Fixed

- **Silent load of cross-minor pickle artefacts is now impossible
  (P-0107)** — Re-tune / Resume on a checkpoint saved by an older
  lizyml minor surfaces immediately as `PICKLE_INCOMPATIBLE` with
  the `lizyml_version_mismatch` classification and a one-line
  suggested fix (refit, or pin the saved version), instead of
  failing deep inside the load path.
- **Structurally-broken tuning search spaces fail fast (P-0108)** —
  inverted Range (`low >= high`) and `log + low<=0` no longer
  manifest as "All tuning trials failed" after N Optuna trials;
  `POST /tune` rejects them with a 422 and a concrete
  `suggested_fix` ("Swap Min and Max..." / "Raise Min above
  zero..."). `PUT /config` stays permissive so in-progress edits
  are not lost.
- **INV-5 queue-full eviction + INV-1 multi-paused reconcile
  coverage (#449 / #450)** — regression tests pin the established
  invariants from v0.5.0 against a future refactor that might
  weaken them silently.

### Internal

- **Test coverage additions** — INV-5 queue-full eviction + INV-1
  multi-paused reconcile (#449 / #450), inference Results panel +
  Download CSV + multi-task (#443 / #444 / #448), Jobs page Export
  Format toggle + Pause / Resume + Re-fit UI (#442 / #445 / #446).
- **`BLUEPRINT.md` / `architecture-as-implemented.md` /
  `docs/v0.4-business-readiness-plan.md` / `docs/ROADMAP.md`** all
  reconciled to v0.5.0 + v0.6.0 state.
- **`tests/bench/test_bench_pickle_compat.py`** new
  (`@slow + @pickle_compat`) — synthetic drift coverage for the
  schema + version + corrupt-meta classes.

### Compatibility

- **REST API**: zero endpoint removals; zero schema removals;
  `PICKLE_INCOMPATIBLE` adds optional `details` fields (additive).
- **`BackendAdapter` Protocol**: two new methods
  (`validate_search_space`, `get_incompatible_metrics`) with
  default `return []` bodies. Existing implementations satisfy
  automatically.
- **On-disk format**: `meta.json` `format_version=1` unchanged.
- **Frontend**: no breaking UI changes. Tune tab UX evolves
  significantly (defaults, Re-tune Switch, inner_valid picker,
  Residuals kind selector) but the wire format is
  backwards-compatible.
- **Dependencies**: `lizyml >=0.15.0, <0.16.0` (was `>=0.12.0,
  <0.13.0`). Users with a pinned `lizyml==0.14.x` will need to
  upgrade.

### Migration notes

- Users with checkpoints saved under lizyml `0.14.x` (or older) will
  see `PICKLE_INCOMPATIBLE` on Re-tune / Resume after upgrading.
  The new `suggested_fix` field points at the two recovery paths:
  re-run the tune on the current runtime, or pin
  `lizyml==<saved_version>` in `pyproject.toml` to reload the
  artefact. This was always the implicit policy; v0.6 just makes
  it discoverable.

## [0.5.0] - 2026-05-07

The **v0.5 reliability** release. Closes 4 of 5 v0.5 Exit Criteria
(P-0099 R-1 invariants, browser reload state restoration,
format_version CI gating, slot release coverage). Brings 24h Tune
long-run resumability across server restarts and WebSocket
reconnects to the production runtime, plus tightens dependency
hygiene with a CVE patch round.

Bundles:

1. **R-1 state-machine invariants (P-0099)** — INV-1 through INV-7
   declared up-front and encoded as regression tests across v3-17
   through v3-23 (slot release on 6 paths, cancel observability,
   `meta.json` atomic write, `paused` job state, subprocess crash
   recovery, WS-disconnect-doesn't-release).
2. **R-1.4 Tune long-run resumability** — Optuna study reattach via
   `(storage, study_name)`, in-place pause/resume buttons, server
   startup reconciliation for orphan + paused jobs.
3. **R-2.1 WebSocket reconnect strategy** — 5min ceiling +
   indefinite retry + jitter; missed messages recovered via the
   terminal-replay cache (P-0093).
4. **R-2.2 Browser reload state restoration (P-0102)** — Workspace
   re-attaches to the previously running / completed job after a
   reload without `?job_id=`; dirty-config warning gates an
   accidental tab close mid-PUT.
5. **R-4.1 format_version migration matrix CI gate (P-0103)** —
   captured v0 / v1 / v2 fixtures + dedicated `format-version-matrix`
   CI job ensure a future schema bump cannot ship without proving
   the migration chain end-to-end.

### Added

- **Browser reload state restoration (P-0102, v3-24)** — reloading
  the Workspace tab now re-attaches the UI to the previously
  running / completed job via `workspaceStatus.current_job_id`,
  even when the URL has no `?job_id=` query param. A `beforeunload`
  warning fires when the config write funnel still has an in-flight
  PUT, so a misclick on the reload button no longer silently loses
  unsaved edits. Closes the v0.5 Exit Criterion for browser reload
  state recovery.
- **format_version migration matrix CI gate (P-0103, v3-25)** — new
  `format-version-matrix` CI job runs the full matrix
  (`tests/regression/test_format_version_migration_matrix.py`,
  `test_legacy_workspace_fixtures.py`, `test_storage_versions.py`)
  on every PR. Captured-to-disk fixtures for v0 / v1 / v2 workspaces
  live under `tests/fixtures/legacy_workspaces/`, so a future
  `STUDIO_FORMAT_VERSION` bump cannot ship without proving the
  migration chain end-to-end. Closes the v0.5 Exit Criterion for
  format_version CI gating.
- **Pause / Resume Tune long-runs (P-0099 R-1.4, v3-20)** — new
  `POST /api/jobs/{id}/pause` and `POST /api/jobs/{id}/unpause`
  endpoints + Jobs UI buttons let a 24h tuning job pause at the
  next trial boundary, persist state, and resume in place via the
  same `(storage, study_name)` Optuna handle.
- **Server startup reconciliation (P-0099 R-1.5b, v3-22)** — orphan
  jobs (running on disk but no live process) are auto-failed;
  paused jobs reclaim their active slot at boot so the next request
  observes a coherent JobStore state.
- **WebSocket reconnect strategy (R-2.1, v3-23)** — frontend retries
  WS connects with exponential backoff up to 5 min ceiling + jitter,
  and never gives up; missed messages flow through the terminal-
  replay cache.

### Changed

- **Storage protection (P-0103, v3-25c)** — `write_versioned_json`
  now refuses to overwrite a workspace artefact whose existing
  on-disk `format_version` is older than the runtime's
  `STUDIO_FORMAT_VERSION`. To opt in to upgrading a legacy workspace
  in place, set `LIZYSTUDIO_ALLOW_LEGACY_WRITE=1` before launching
  `lizystudio`. New artefacts and same-version overwrites are
  unaffected. Recovery for users on v0 / v1 workspaces is documented
  in HISTORY P-0103.
- **`format_version` bumped 1 -> 2** — `Job.status` literal extended
  with `"paused"`. Migration is byte-identity (no v1 artefact ever
  contained `"paused"`); the bump exists so a future runtime that
  re-shapes the field can detect a v2 workspace via `format_version`
  and refuse with `IncompatibleFormatVersionError`.

### Fixed

- **SHAP 0.51.0 LightGBM-binary UserWarning noise** — the upstream
  warning about TreeExplainer output shape change is now suppressed
  at server startup. The lizyml SHAP adapter already handles both
  the legacy ndarray and the new list-of-ndarray shapes, so the
  warning was purely informational; the noise (5 folds x 2
  importance kinds per fit) was drowning out actionable log entries.

### Security

- **CVE fixes** — `mako` 1.3.10 -> 1.3.12 (CVE-2026-44307) and
  `python-multipart` 0.0.22 -> 0.0.27 (CVE-2026-40347,
  CVE-2026-42561) on the locked production dependency set. Post-
  upgrade `pip-audit` reports zero vulnerabilities.

## [0.4.2] - 2026-05-06

The **v0.5 prep** maintenance release. **No user-facing behaviour
changes** — the on-disk job format, REST API surface, and frontend UX
are byte-for-byte identical to v0.4.1. This release exists so
downstream consumers can pin against a stable artifact while the v0.5
R-1 reliability sprint lands phase by phase over the coming weeks.

Bundles:

1. Post-v0.4.1 spec reconciliation — locks the severity envelope
   introduced by PR-B4 / PR-C2 / PR-D1 as a documented Decision.
2. Edge-case + integration test coverage for the metric-compat
   watchlist and the validate-debounce → warning banner render path.
3. The v0.5 R-1 Change Gate Proposal (P-0099) declaring the seven
   invariants and the new `paused` job state that v3-17 through v3-26
   will encode as invariant tests before implementation.

### Documentation

- **HISTORY P-0100** — formalises the `severity` envelope (PR-B4)
  post-hoc: `severity: Literal["error","warning","info"]`, default
  `"error"` for backward compatibility with pre-PR-B4 backends, and
  the `_blocking_errors` filter semantics that PR-D1 (#400) wired into
  all four `/fit` and `/tune` raise sites.
- **HISTORY P-0101** — documents the metric-compat watchlist
  (`mape` / `rmsle` / `r2`) and the `task=regression` guard introduced
  by PR-C2 (#399) and PR-D1 (#400).
- **HISTORY P-0099** — declares the seven invariants (INV-1 through
  INV-7) and the new `paused` job state that the v0.5 R-1 sprint will
  encode as invariant tests before implementation. **Proposal-only
  Change Gate; no runtime change in this release.**
- **BLUEPRINT §5.2** — Validate response envelope spec (severity
  Literal, `suggested_fix` nullability, watchlist trigger table,
  `_blocking_errors` semantics, frontend `isBlockingError` mapping).
- **PLAN.md** — adds 10 new phases (`v3-17` through `v3-26`) covering
  R-1.1 through R-4.2 with explicit Entry / Exit criteria and DoD
  pointing at the corresponding INV-N invariant tests.
- `docs/v0.4-business-readiness-plan.md` v0.2 — status PARTIAL; R-3.4.1
  and R-5 marked shipped; R-1 / R-2 / R-4 carried over to v0.5.
- `docs/architecture-as-implemented.md` §5.4 — Validate envelope hop
  diagram + frontend `isBlockingError` mapping.
- `docs/ROADMAP.md` post-v0.4.1 reconciliation (recent shipped, open
  issues, v0.5 R-1 Next Actions, drift flags for PLAN / BLUEPRINT
  follow-ups already addressed by this release).

### Tests

- 6 new backend cases on `tests/contract/test_validate_metric_compatibility.py`
  (9 → 15) covering all-NaN target, ±inf target, int64 vs float64
  consistency, duplicate metric dedup, malformed metric entries, and
  non-dict `evaluation` field defensive handling (#404).
- 4 new frontend cases on `frontend/src/api/types.test.ts` locking the
  `isBlockingError` severity-default rule (#404).
- 2 new frontend integration cases on
  `frontend/src/components/workspace/ConfigEditorBody.integration.test.tsx`
  exercising the validate-debounce → `setErrors` → warning banner render
  path end-to-end with a mocked workspace API (#405).

### Cross-repo

- [`LizyML #105`](https://github.com/nbx-liz/LizyML/issues/105) filed —
  Optuna persistent storage (`JournalStorage`) for resumable tuning.
  Critical path for v0.5 R-1.4 (`#360`); LizyStudio v3-20 cannot start
  until this lands upstream.

### Internal follow-ups (no user impact)

- `#403` (BackendAdapter metric-compat refactor) — deferred to v0.6
  alongside the second `BackendAdapter` implementation. Watchlist
  behaviour stays locked by the contract suite.

## [0.4.1] - 2026-05-05

The **Validate clarity** patch release. Bundles three follow-ups to the
v0.4.0 Wide DataFrame release surfaced during GUI verification (#393,
#394) plus the v0.4.1 quality-gate fix that restored the warning-only
fit path (PR-D1). Adopts upstream lizyml 0.11.0 so the SPA can
recommend zero-tolerant sMAPE / WAPE alternatives when MAPE is
incompatible with the loaded target.

No breaking changes. All new behaviours degrade cleanly on pre-PR-B4
backends (entries without a `severity` field default to `"error"`,
preserving the legacy "any error blocks" semantics).

### Added

- **Validate API auto-disable for incompatible regression metrics
  (#394)** — `POST /api/workspace/config/validate` and
  `PUT /api/workspace/config` now return `severity="warning"` entries
  when the loaded dataset's target column makes a configured metric
  mathematically impossible: `mape` on a target that contains zeros,
  `rmsle` on a target with negative values, and `r2` on a constant
  target. Each entry carries a `suggested_fix` naming the metric to
  remove; for `mape` the suggestion also points at the new `smape`
  and `wape` metrics shipped in lizyml 0.11.0 as zero-tolerant
  replacements. The frontend renders these advisories in a new yellow
  banner above ConfigForm with the suggestion as a second line, while
  the existing red banner keeps surfacing blocking errors.

### Changed

- **Validate response `valid` flag and PUT `saved` flag now honor
  severity (#394)** — only `severity="error"` entries flip
  `valid=false` / `saved=false`. Pre-PR-B4 entries with no severity
  default to `"error"` for backward compatibility, so existing
  consumers (legacy frontends, scripts piping JSON) see no change.
  Warnings advise but neither block persistence nor the Fit button —
  which now gates on `severity=error` count instead of total error
  count.
- **Bump `lizyml` minimum to `0.11.0` (<0.12.0)** — adopts upstream
  sMAPE / WAPE regression metrics (LizyML H-0071 / #101). The new
  metrics surface automatically through `MetricRegistry` lookup, so
  `tuning.optuna.params.direction` chips and learning curve filters
  list `smape` / `wape` for `task=regression` without further wiring.
  Defensive fallback list in `lizystudio.backends.lizyml_metrics`
  extended to include the two new metrics for parity.

### Fixed

- **`POST /fit` and `POST /tune` no longer 422 on warning-only configs
  (PR-D1, Issue #394 follow-up)** — the four `if errors: raise
  ValidationError(errors)` sites in `workspace_fit` / `workspace_tune`
  rejected any non-empty errors list, so a config the SPA legally saved
  (yellow advisory banner only) would 422 when the user clicked Fit.
  Both endpoints now filter through the shared `_blocking_errors`
  helper so only `severity="error"` entries block the run; pre-PR-B4
  entries with no severity continue to default to blocking. Regression
  covered by `tests/contract/test_fit_tune_severity_filter.py`.
- **`_workspace_metric_compatibility_errors` now restricts the
  `mape` / `rmsle` / `r2` watchlist to `task=regression`** — previously
  a binary or multiclass config with a numeric target could surface a
  misleading R² warning when its distribution happened to look
  constant from the validator's point of view. The watchlist is
  regression-specific by construction, so the validator now
  short-circuits on non-regression tasks.
- **Hide redundant `SHAP Summary` tab in Workspace Plot panel (#393)** —
  Workspace previously surfaced SHAP both as a standalone `SHAP Summary`
  tab and as `Importance` with `kind=shap`, which rendered identical
  figures. The Workspace tab strip now filters out `shap-summary` so
  SHAP is reachable only via the `Importance` tab's kind selector.
  Inference's `SHAP Summary` accordion (#373) is unaffected — it does
  not consume `PlotSection` and continues to render the dedicated
  surface. `docs/plot-matrix.md` symmetry rule 1 generalised to allow
  the `{tuning, shap-summary}` Workspace exclusion set.

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
