# LizyML production-artifact fixtures

Real `config.json` / `fit_result.json` / `metadata.json` / `tune_result.json`
artifacts captured from jobs the LizyStudio GUI ran. Backend integration tests
use `config.json` + `data.csv` as their input (for example
`tests/integration/test_fit_load_round_trip.py`), and the frontend mirror at
`frontend/src/__fixtures__/lizyml/` feeds the frontend golden tests.

## Why these exist

PR #344 and Issue #345 both shipped to GUI because tests used hand-written
synthetic data that did not match what production code paths actually wrote
to disk. Real artifacts captured from the same code path users exercise are
the only data source that tracks shape evolution. See
`feedback_production_artifact_fixtures.md` for rationale and Issue #346 for
the rollout plan.

## Scenarios

| Directory | Task | Target | Excluded columns | Run | Notable shape | Source CSV |
|---|---|---|---|---|---|---|
| `binary_no_cal/` | binary | `Survived` | `PassengerId`, `Name`, `Sex` | Fit | `metrics: {raw}` | titanic 418 rows |
| `binary_isotonic/` | binary | `Survived` | `PassengerId`, `Name`, `Sex` | Fit, Calibration = isotonic | `metrics: {raw, calibrated}` ← shape that broke PR #344 | titanic 418 rows |
| `regression/` | regression | `target` | `feature_x1`, `feature_x2` | Fit | regression metric set | synthetic 80 rows |
| `tune/` | binary | `target` | `feature_c` | Tune, Number of trials = 10 | adds `tune_result.json` | iris-like 150 rows |

Every other setting is the UI default, including the categorical columns the
UI auto-detects and the default Tune search space. The excluded columns are
the ones the lizyml 0.9.1 capture used (owner ruling D-20261022-005).

Each directory contains:

- `data.csv` — source CSV used to drive the run (never rewritten by a capture:
  `tests/fixtures/lizyml015/` and several tests depend on its bytes)
- `config.json` — the job's config from `meta.json`, paths scrubbed
- `fit_result.json` — the job's `fit_result.json`
- `metadata.json` — the job's `model/metadata.json`, paths scrubbed
- `tune_result.json` — only in `tune/`, paths scrubbed

## Capture metadata

- **Captured**: 2026-10-22
- **lizyml version**: 0.20.0
- **Python version**: 3.12.3
- **Platform**: linux (aarch64)
- **Jobs**: binary_no_cal `job_bfca7941`, binary_isotonic `job_27682903`,
  regression `job_c499144c`, tune `job_866aa15e` (P-0116 child 8)

## Re-capture procedure

`tests/test_lizyml_fixture_freshness.py` runs in PR CI and fails when the
lizyml minor recorded here, in each `metadata.json` and the installed one
differ, or when a `config.json` no longer has the shape the UI writes. A
lizyml minor bump therefore re-captures in the same PR (owner ruling
D-20261022-005).

The capture is **GUI-driven on purpose**: the frontend writes part of the
config a job runs with (the reporting-metric list, no default seed, the
`inner_valid_explicit` marker, no derived `direction`), so a job made through
the API alone would not look like a production job. A Playwright driver runs
the GUI the way a user does; it lives outside `tests/e2e`, so CI does not run
it.

1. Stop any server on ports 8501 and 5173 (the driver starts both itself).
2. From `frontend/`, with a new jobs directory and manifest path:

   ```sh
   CAPTURE_JOBS_DIR=<new jobs dir> CAPTURE_MANIFEST=<manifest.json> \
     pnpm exec playwright test -c tests/fixture-capture/playwright.capture.config.ts
   ```

   Each scenario resets the workspace, loads its `data.csv` by path (copied
   under `/tmp`, the server's files root), picks the target, sets the
   excluded columns, applies the scenario's setting, runs, and waits for
   `completed`. The manifest maps each scenario to its job id.
3. From the repository root:

   ```sh
   uv run python scripts/export_lizyml_fixtures.py <new jobs dir> <manifest.json>
   ```

   It writes the files above and the frontend mirrors, scrubs local paths,
   and refuses a job that did not complete or a path left after scrubbing.
4. Format the mirrors: `cd frontend && pnpm exec biome format --write src/__fixtures__/lizyml`.
5. Update **Capture metadata** above, then run
   `uv run pytest tests/test_lizyml_fixture_freshness.py` and the suites that
   read these fixtures.
