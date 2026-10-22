# LizyStudio Frontend

React + TypeScript + Vite UI for [LizyStudio](https://github.com/nbx-liz/LizyStudio).

## Prerequisites

- **Node.js 24 or newer** — declared via `engines.node` in `package.json` and pinned in `.nvmrc`. CI and the publish build run on Node 24 (P-0112). On an older Node, pnpm prints `WARN Unsupported engine` and continues, so treat 24 as the required floor even though nothing refuses the install.
- **pnpm 10 or newer** — the project pins `pnpm@10.31.0` via the `packageManager` field. Enable corepack once with `corepack enable` and pnpm will match automatically.
- A running backend on `http://localhost:8501` for `pnpm dev` (the Vite dev server proxies API calls there).

Run `node -v` to confirm. If you see anything below `v24`, install Node 24 via your version manager (`nvm install 24`, `fnm install 24`, `volta install node@24`, etc.) before continuing.

## Install

The full one-time setup (backend, git hooks, toolchain versions) is in
[../CONTRIBUTING.md § Getting started](../CONTRIBUTING.md#getting-started).
For the frontend alone:

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # browser for pnpm test:e2e
```

## Develop

```bash
# Start the backend in another terminal first
uv run lizystudio --reload            # from the repo root

# Then in frontend/
pnpm dev                              # Vite dev server on http://localhost:5173
```

The dev server proxies `/api/*` to `http://localhost:8501`.

## Test

```bash
pnpm test                             # Vitest unit tests
pnpm test:watch                       # Vitest in watch mode
pnpm test:e2e                         # Playwright end-to-end
pnpm test:e2e:visual                  # Playwright visual regression
pnpm test:e2e:a11y                    # Playwright accessibility scan
```

## Check

```bash
pnpm check                            # Biome lint + format check
pnpm format                           # Biome format, auto-fix
pnpm build                            # tsc --build + Vite production build
```

The production build writes into `../src/lizystudio/static/` so it can be served by the FastAPI backend.

## Component development

```bash
pnpm storybook                        # Storybook on http://localhost:6006
pnpm build-storybook
pnpm test:storybook                   # Storybook test runner
```

## Generated API types

```bash
# Backend must be running for this to work
pnpm generate:api                     # Regenerate src/api/generated/schema.d.ts
pnpm check:api-types                  # Verify the generated file is up to date
```

## Project links

- Root repo: [../README.md](../README.md)
- Technical spec: [../BLUEPRINT.md](../BLUEPRINT.md)
- Proposal history: [../HISTORY.md](../HISTORY.md)
- Phased roadmap: [../PLAN.md](../PLAN.md)
- Contributing and setup: [../CONTRIBUTING.md](../CONTRIBUTING.md)
