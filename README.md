# LizyStudio

A web-based GUI for machine-learning workflows. Configure, train, evaluate,
tune and run inference — all from your browser, no code required.

LizyStudio wraps ML backend libraries (starting with
[LizyML](https://github.com/nbx-liz/LizyML)) behind an adapter layer, so the
same interface works across different backends.

## Features

- **Workspace** — iterative loop of data setup, model config, fit, and result
  review in a single page
- **Jobs** — lifecycle management, result browsing, and model export for every
  training / tuning run
- **Inference** — apply trained models to new data and evaluate predictions
- **JSON-Schema-driven forms** — backend config schemas are rendered
  automatically; no hand-written UI per backend
- **Adapter architecture** — plug in new ML backends by implementing a single
  Python protocol

## Requirements

- Python 3.10+

## Installation

```bash
pip install lizystudio
```

## Quick start

```bash
lizystudio              # starts the server on http://localhost:8501
lizystudio --port 9000  # custom port
```

Open your browser and navigate to the URL shown in the terminal.

## Development

```bash
# Backend
uv run lizystudio --reload          # dev server with auto-reload
uv run pytest                       # run tests
uv run ruff check .                 # lint
uv run mypy src/lizystudio/         # type check

# Frontend
cd frontend
pnpm install
pnpm dev                            # Vite dev server (port 5173, proxy -> 8501)
pnpm build                          # production build -> src/lizystudio/static/
pnpm check                          # Biome lint + format
pnpm test                           # Vitest
```

## License

[MIT](LICENSE)
