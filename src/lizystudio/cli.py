"""CLI entry point for LizyStudio."""

from __future__ import annotations

import argparse
import os
from pathlib import Path


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="lizystudio",
        description="LizyStudio — Web GUI for LizyML",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8501,
        help="Port to listen on (default: 8501)",
    )
    parser.add_argument(
        "--reload",
        action="store_true",
        help="Enable auto-reload for development",
    )
    parser.add_argument(
        "--backend",
        default="lizyml",
        help="Backend adapter name (default: lizyml)",
    )
    parser.add_argument(
        "--jobs-dir",
        type=Path,
        default=Path(".lizystudio/jobs"),
        help="Job storage directory (default: .lizystudio/jobs)",
    )
    args = parser.parse_args(argv)

    # Pass settings via env vars so they survive --reload restarts
    os.environ["LIZYSTUDIO_BACKEND"] = args.backend
    os.environ["LIZYSTUDIO_JOBS_DIR"] = str(args.jobs_dir)
    if args.reload:
        os.environ["LIZYSTUDIO_RELOAD"] = "1"

    import uvicorn

    uvicorn.run(
        "lizystudio.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
