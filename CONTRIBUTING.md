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

```bash
cd frontend
pnpm check                          # Biome lint + format
pnpm build                          # production build
pnpm test                           # Vitest
pnpm test:e2e                       # Playwright
```

## Pre-commit hooks

Pre-commit hooks run Ruff and Biome automatically on every commit.
If a hook fails, fix the issue and commit again — do **not** bypass with `--no-verify`.

## Quality gates (CI)

Every PR must pass these checks before merge:

| Check | Backend | Frontend |
|-------|---------|----------|
| Lint | `ruff check .` | `pnpm check` (Biome) |
| Format | `ruff format --check .` | `pnpm check` (Biome) |
| Types | `mypy src/lizystudio/` | TypeScript strict via `pnpm build` |
| Tests | `pytest` (80%+ coverage) | `vitest run --coverage` |

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

## Documentation language

- **Markdown docs** (BLUEPRINT, HISTORY, PLAN, CLAUDE): Japanese
- **Code** (comments, docstrings, commit messages, PRs): English

## Reporting issues

Use [GitHub Issues](https://github.com/nbx-liz/LizyStudio/issues) with the
provided templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).
