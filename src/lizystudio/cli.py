"""CLI entry point for LizyStudio."""

from __future__ import annotations

import argparse


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
    args = parser.parse_args(argv)

    import uvicorn

    uvicorn.run(
        "lizystudio.server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )
