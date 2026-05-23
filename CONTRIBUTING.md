# Contributing to LizyStudio

Thank you for your interest in contributing! This guide covers the workflow,
conventions, and quality gates you need to know.

## Getting started

### Prerequisites

- Python 3.10+
- Node.js 20+ (pinned via `.nvmrc`; use [fnm](https://github.com/Schniz/fnm) or [nvm](https://github.com/nvm-sh/nvm) to auto-switch)
- [uv](https://docs.astral.sh/uv/) (Python package manager)
- [pnpm](https://pnpm.io/) (frontend package manager — activated via Node corepack from `packageManager` field)

### Development setup

```bash
# Clone the repository
git clone https://github.com/nbx-liz/LizyStudio.git
cd LizyStudio

# Backend
uv sync                             # install Python dependencies
uv run lizystudio --reload          # dev server on http://localhost:8501

# Frontend
cd frontend
pnpm install                        # install Node dependencies
pnpm dev                            # Vite dev server on http://localhost:5173 (proxies to 8501)
```

## Branch workflow

```
main          ← stable releases (direct commits prohibited)
└── develop   ← integration branch (PR target)
    └── feat/*, fix/*, ...  ← feature/fix branches
```

1. Create a branch from `develop` (e.g. `feat/add-export-csv`)
2. Make your changes, commit, push
3. Open a PR targeting `develop`
4. After review and CI pass, merge into `develop`
5. `develop` is periodically merged into `main` for releases

## Commit messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

<optional body>
```

**Types:** `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`

Examples:
```
feat(api): add column statistics endpoint
fix(frontend): resolve inference target detection
test(e2e): add ModelPanel Playwright tests
docs(history): add proposal H-0061 for new feature
```

## Code style

### Python (backend)

- **Formatter/Linter:** [Ruff](https://docs.astral.sh/ruff/) (line-length 88, target Python 3.10)
- **Type checker:** [mypy](https://mypy-lang.org/) (strict mode)
- **Tests:** [pytest](https://pytest.org/) with 80%+ coverage required

```bash
uv run ruff check .                 # lint
uv run ruff format --check .        # format check
uv run mypy src/lizystudio/         # type check
uv run pytest --cov=src/lizystudio --cov-fail-under=80 -q  # test
```

### TypeScript (frontend)

- **Formatter/Linter:** [Biome](https://biomejs.dev/) (ESLint/Prettier are **not** used)
- **Tests:** [Vitest](https://vitest.dev/) (unit) + [Playwright](https://playwright.dev/) (e2e)
- **API types:** auto-generated via `openapi-typescript` — never hand-write API types
- **Mock assertions:** assert the call *count*, not just the fact — use
  `expect(spy).toHaveBeenCalledTimes(N)`, never bare `expect(spy).toHaveBeenCalled()`.
  When `N` is not 1, add a one-line comment naming the reason. The
  `tohavebeencalled-guard` CI job enforces this (Issue #537).

```bash
cd frontend
pnpm check                          # Biome lint + format
pnpm build                          # production build
pnpm test                           # Vitest
pnpm test:e2e                       # Playwright
```

## Pre-commit hooks

Pre-commit hooks run on every commit:

- **ruff / ruff-format** — Python lint + format (auto-fix)
- **biome check** — TypeScript lint + format (`frontend/src/**`)
- **block-stray-artifacts** ([`scripts/check_stray.sh`](scripts/check_stray.sh)) —
  fails the commit if the staged set contains scratch/build artefacts
  (root-level `*.png` / `*.csv` / `*.parquet`, `coverage.json` / `.coverage`,
  `dist/*.whl` / `dist/*.tar.gz`, `*.tsbuildinfo`). These belong under `tmp/`
  (see [Working artefacts](#working-artefacts)). Allowed exceptions:
  `docs/images/*.png`, `tests/fixtures/**`, `frontend/src/__fixtures__/**`,
  `frontend/tests/e2e/__screenshots__/**`, `data/**`.

If a hook fails, fix the issue and commit again — do **not** bypass with
`--no-verify`. The one legitimate `--no-verify` case is intentionally adding a
file `block-stray-artifacts` flags (e.g. a new doc image outside `docs/images/`);
explain why in the commit body.

## Quality gates (CI)

Every PR must pass these checks before merge:

| Check | Backend | Frontend |
|-------|---------|----------|
| Lint | `ruff check .` | `pnpm check` (Biome) |
| Format | `ruff format --check .` | `pnpm check` (Biome) |
| Types | `mypy src/lizystudio/` | TypeScript strict via `pnpm build` |
| Tests | `pytest` (80%+ coverage) | `vitest run --coverage` |
| E2E | — | `playwright test --project=chromium` (functional only on PRs) |
| Orphan goldens | — | [`scripts/check_orphan_goldens.sh`](scripts/check_orphan_goldens.sh) — every committed `frontend/tests/e2e/__screenshots__/<project>/` must be run by some workflow's `--project=<project>` |

If you add a new Playwright project, also reference it from a workflow (or
keep its goldens out of git); if you retire one, delete its goldens in the
same PR — regenerate later via `pnpm test:e2e:update` if it returns.

### E2E request-budget assertions (Issue #538)

Storm / spam / flood-class bugs (v0.6.2 Target-select cluster #529 / #530
/ #531, polling storm #339, replay loop #341) slip past tests that only
assert eventual *state*. To detect them, **every E2E spec exercising a
user action should include at least one request-budget assertion**
counting HTTP calls per click / submit / load.

Use the helpers in
[`frontend/tests/e2e/helpers/request-budget.ts`](frontend/tests/e2e/helpers/request-budget.ts):

```ts
import { installFetchRecorder, expectBudget } from "./helpers/request-budget";

const recorder = installFetchRecorder(page);
// ...drive UI to "ready" state...
const sinceClick = recorder.snapshot({
  method: "PUT",
  urlPattern: "/api/workspace/config",
});
await page.getByRole("combobox", { name: /target/i }).click();
await page.getByRole("option", { name: "survived" }).click();
await page.waitForTimeout(3000);
expect(sinceClick().length).toBeLessThanOrEqual(3);  // budget with rationale comment
```

Rules:

- Budget values must be justified in a code comment citing a measured
  baseline or a related Issue (see `workspace-target-select-puts.spec.ts`
  for the canonical "history: 9 → 4 → 3 → 2" form).
- Failing budget → investigate the *cause* and either fix the regression
  or file a follow-up bug. **Never relax the budget to make a failing
  spec pass.**

Surfaces covered today: target-select, tab-switch, data-load via Path,
CV strategy change, Folds spinbutton, Fit submit, Tune submit,
Inference run double-click guard. The full #538 surface table is now
covered end-to-end (Tune resume is structurally protected by Issue
#554's regression test rather than a request-budget spec because the
flow is API-driven).

### Property-based testing (Issue #539)

Tests that assert specific (input, expected output) examples can leave
gaps when bugs only fire on the input-axis product that nobody hand-listed.
Property-based testing explores the combinatorial space against declared
invariants. **For code touching concurrency, state machines, or resource
ownership** (see `invariants-first.md`), declare at least one property
test per invariant in addition to example-based tests.

- **Backend**: `hypothesis` (dev dep). Tests live in
  [`tests/property/test_pbt_<topic>.py`](tests/property/).
- **Frontend**: `fast-check` (dev dep). Tests live in
  [`<name>.pbt.test.ts`](frontend/src/hooks/useConfigWriteFunnel.pbt.test.ts)
  — vitest auto-discovers them.

Pilots landed today:

| Module | File | Invariants |
|---|---|---|
| `JobStore` state machine | [`tests/property/test_pbt_job_state_machine.py`](tests/property/test_pbt_job_state_machine.py) | INV-no-illegal: every transition not in `LEGAL_TRANSITIONS` is rejected; INV-terminal-no-resurrection: terminal states admit no outgoing transitions. |
| `useConfigWriteFunnel` pure helpers | [`frontend/src/hooks/useConfigWriteFunnel.pbt.test.ts`](frontend/src/hooks/useConfigWriteFunnel.pbt.test.ts) | 6 properties covering `materializeOp` round-trip / sibling preservation, `coalesceByReason` replace-dominance both directions, disjoint-path merge survival, same-path → next-wins (#530 fix), and the coalesce + materialise composition. |

### Mutation testing (Issue #539 Phase 1)

Complements property tests by perturbing production code and measuring
whether the suite catches the perturbation. Survival rate (mutation
score) is a **trend metric, not a PR gate**; thresholds are configured
so the runs never block a merge. Tightening per module is a follow-up.

- **Backend**: `mutmut`. Scope = JobStore three-file split
  (`_job_metadata.py` / `_job_active_slot.py` / `_job_control_flags.py`).
  Config: `[tool.mutmut]` in `pyproject.toml`. Local invocation:
  `uv run mutmut run`.
- **Frontend**: `stryker-js` + `@stryker-mutator/vitest-runner`.
  Scope = `frontend/src/hooks/useConfigWriteFunnel.ts`. Config:
  [`frontend/stryker.conf.json`](frontend/stryker.conf.json). Local
  invocation: `pnpm mutation:test`.
- Nightly CI runs both jobs (`continue-on-error: true`) and uploads
  artefacts. See `.github/workflows/nightly.yml::mutation-test`.

When a property test reveals a real production bug (as fast-check did
on the first run with the path-overlap edge case), document the
boundary in the test rather than silently widening the property —
that's the invariant becoming load-bearing.

## Test fixtures

When adding a new transform, parser, or schema mapper, the **first test case
must use a fixture captured from a real production run**, not hand-written
synthetic data. Synthetic data verifies logic but cannot track shape
evolution; PR #344 and Issue #345 both shipped to GUI because tests
asserted against shapes that had drifted from what production wrote.

- **Frontend** consumers: import from [`frontend/src/__fixtures__/lizyml/`](frontend/src/__fixtures__/lizyml/)
- **Backend** consumers: read from [`tests/fixtures/lizyml/<scenario>/`](tests/fixtures/lizyml/)

Re-capture is manual (GUI-driven) and required when `lizyml` minor/major
bumps or when the API/Service layer changes how artifacts are written. The
procedure is in [`tests/fixtures/lizyml/README.md`](tests/fixtures/lizyml/README.md).
The manual GUI flow is intentional: a scripted re-capture would bypass
the API/Service layer that determines what production users actually
write to disk — exactly the layering this fixture set is meant to lock down.

See Issue #346 for the rollout (4 fixture scenarios on lizyml 0.9.1,
3-layer frontend lock, fit→load round-trip CI gate at P-0095).

## Change gate

Changes to public APIs, data contracts, or architecture require a **Proposal** in
[HISTORY.md](HISTORY.md) before implementation. See the file for the full template.

Gate-required changes include:
- API endpoint additions, modifications, or removals
- `BackendAdapter` Protocol changes
- Common types (`FitSummary`, `PlotData`, etc.) changes
- Screen-to-screen data flow changes
- External dependency additions or removals

Gate **not** required: pure UI tweaks, test additions, documentation fixes, refactoring
without behavior change.

## Project structure

```
src/lizystudio/
├── api/          # FastAPI routers
├── backends/     # BackendAdapter protocol + implementations
├── services/     # Business logic, session state
└── ws/           # WebSocket progress

frontend/src/
├── api/          # API client + auto-generated types
├── components/   # React components (by feature)
├── pages/        # Page-level components
└── lib/          # Shared utilities
```

## Working artefacts

Spike outputs, debug screenshots, ad-hoc dumps, and one-off audit scripts go
under **`tmp/`** — never the repo root and never a tracked directory. `tmp/`
is gitignored, so anything you drop there cannot accidentally end up in a
commit.

- Visual / Playwright spikes: write screenshots to `tmp/screenshots/`
- Throwaway scripts and CSV/JSON dumps: `tmp/`
- Local coverage / profiling output: `tmp/` (the canonical `pytest --cov` run
  in CI writes its own; you do not need a tracked copy)

This keeps `ls` on the repo root meaningful and stops generations of build
artefacts (`dist/*.dev401`, `dist/*.dev439`, …) from co-residing. A
`block-stray-artifacts` pre-commit hook (see [Pre-commit hooks](#pre-commit-hooks))
is the tripwire if you `git add` something that bypasses `.gitignore`; the
`tmp/` convention is the habit that keeps the tripwire from ever firing.

> Need the file in the repo? It is probably a fixture (`tests/fixtures/**`,
> `frontend/src/__fixtures__/**`) or a doc image (`docs/images/*.png`) — those
> locations are explicitly un-ignored. Everything else is scratch.

## Documentation language

- **Markdown docs** (BLUEPRINT, HISTORY, PLAN, CLAUDE): Japanese
- **Code** (comments, docstrings, commit messages, PRs): English

## Reporting issues

Use [GitHub Issues](https://github.com/nbx-liz/LizyStudio/issues) with the
provided templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
