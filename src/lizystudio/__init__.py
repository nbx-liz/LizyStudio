"""LizyStudio: Web-based GUI for LizyML."""

try:
    from lizystudio._version import __version__, __version_tuple__
except ImportError:  # pragma: no cover
    __version__ = "0.0.0.dev0"
    __version_tuple__ = (0, 0, 0, "dev0")

__all__ = ["__version__", "__version_tuple__"]
