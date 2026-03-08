# LizyStudio

Web-based GUI for [LizyML](https://github.com/nbx-liz/LizyML).

## Quick Start

```bash
pip install lizystudio
lizystudio
```

Then open http://127.0.0.1:8501 in your browser.

## Development

### Prerequisites

- Python 3.10+
- Node.js 18+
- [uv](https://docs.astral.sh/uv/)
- [pnpm](https://pnpm.io/)

### Setup

```bash
# Backend
uv sync

# Frontend
cd frontend && pnpm install
```

### Run (development)

```bash
# Terminal 1: Backend
uv run lizystudio --reload

# Terminal 2: Frontend
cd frontend && pnpm dev
```

Open http://localhost:5173 for the dev frontend (hot-reload).

## License

MIT
