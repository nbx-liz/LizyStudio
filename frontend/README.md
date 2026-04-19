# LizyStudio Frontend

React + TypeScript + Vite UI for [LizyStudio](https://github.com/nbx-liz/LizyStudio).

## Prerequisites

- **Node.js 20 or newer** — declared via `engines.node` in `package.json`. CI runs on Node 20. Older versions (including Node 18.x) have been observed to crash the production build (`pnpm build`) with a V8 fatal error under the current dependency graph, so 20 is the enforced floor rather than a recommendation.
- **pnpm 10 or newer** — the project pins `pnpm@10.31.0` via the `packageManager` field. Enable corepack once with `corepack enable` and pnpm will match automatically.
- A running backend on `http://localhost:8501` for `pnpm dev` (the Vite dev server proxies API calls there).

Run `node -v` to confirm. If you see anything below `v20`, install Node 20 via your version manager (`nvm install 20`, `fnm install 20`, `volta install node@20`, etc.) before continuing.

## Install

```bash
cd frontend
pnpm install
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
- Development rules: [../CLAUDE.md](../CLAUDE.md)
