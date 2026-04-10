# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.2] - 2026-04-10

### Fixed
- Align parameter defaults between backend and frontend
- Fix Jobs page plot rendering issues
- Add `inner_valid` filtering for cross-validation results

### Changed
- Harden CI version safety with multi-layer protection

## [0.1.1] - 2026-04-08

### Added
- Literal types to Pydantic response models for stricter API contracts
- pytest unit/integration markers for selective test execution
- Page-level ErrorBoundary for graceful frontend error handling
- Vitest coverage thresholds raised to 80/70/75/80

### Fixed
- Inference target detection and export browse button
- ModelPanel coverage gaps

### Changed
- Split 7 large frontend components into smaller modules
- Split `lizyml_ui_schema` into dedicated `constants` and `metrics` modules
- Align BLUEPRINT and HISTORY with implementation (H-0055–H-0060)

## [0.1.0] - 2026-04-07

### Added
- **Workspace** — single-page iterative workflow: data setup → model config → fit → results
- **Jobs** — lifecycle management, result browsing, model export for fit/tune runs
- **Inference** — apply trained models to new data with optional SHAP explanations
- JSON-Schema-driven config forms (Pydantic → JSON Schema → dynamic UI)
- BackendAdapter architecture for pluggable ML backends
- LizyML adapter (LightGBM + scikit-learn via LizyML)
- Real-time training progress via WebSocket
- Job persistence to disk (survives server restarts)
- CV fold preview, column statistics, value distribution bars
- BlockedGroupKFold 2-axis editor
- Tune tab with search space configuration and default range population
- Feature importance with kind selection (split, gain, SHAP)
- Learning curve plots with fold filtering
- KPI cards on Jobs detail page
- Config edit lock during training
- Export model artifacts and standalone Python code
- CSP security headers
- OpenMP daemon thread degradation detection
- DataFrame memory limit checks
- CI pipeline (GitHub Actions): Ruff, mypy, pytest, Biome, Vitest
- PyPI publishing via `gh-action-pypi-publish`

[Unreleased]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/nbx-liz/LizyStudio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/nbx-liz/LizyStudio/releases/tag/v0.1.0
