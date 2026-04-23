"""Cross-layer contract tests.

Each test here asserts an invariant that spans two or more layers (UI
schema vs Pydantic, validate-endpoint vs fit-endpoint, defaults vs fit,
etc.). Contract tests exist to catch class-of-bugs that unit tests at
each layer miss by construction.
"""
