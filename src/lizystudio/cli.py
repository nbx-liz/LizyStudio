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
        default=None,
        help="Backend adapter name (default: LIZYSTUDIO_BACKEND if set, else lizyml)",
    )
    parser.add_argument(
        "--jobs-dir",
        type=Path,
        default=None,
        help=(
            "Job storage directory "
            "(default: LIZYSTUDIO_JOBS_DIR if set, else .lizystudio/jobs)"
        ),
    )
    args = parser.parse_args(argv)

    # Pass settings via env vars so they survive --reload restarts
    if args.backend is not None:
        os.environ["LIZYSTUDIO_BACKEND"] = args.backend
    else:
        os.environ.setdefault("LIZYSTUDIO_BACKEND", "lizyml")
    if args.jobs_dir is not None:
        os.environ["LIZYSTUDIO_JOBS_DIR"] = str(args.jobs_dir)
    else:
        os.environ.setdefault("LIZYSTUDIO_JOBS_DIR", ".lizystudio/jobs")
    if args.reload:
        os.environ["LIZYSTUDIO_RELOAD"] = "1"

    import uvicorn

    uvicorn.run(
        "lizystudio.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
