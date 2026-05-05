# Plot Matrix — backend / frontend symmetry

**Status**: ✅ shipped 2026-05-05 (PR-B4 / R-3.3)
**Owner**: Phase B / v0.4.0 plot audit
**Related**: PR #385 (PR-B1), PR #386 (PR-B2), `BLUEPRINT.md` §5 plots, `docs/v0.4-business-readiness-plan.md` §6 (R-3.3)

The plot subsystem spans three layers: the LizyML adapter
(`src/lizystudio/backends/lizyml/evaluation_mixin.py`) declares which
plot types exist and how to render them; the JobStore + jobs API
(`src/lizystudio/api/jobs.py`) ships `GET /api/jobs/{id}/plots` and
`GET /api/jobs/{id}/plot/{plot_type}`; the frontend
(`frontend/src/components/workspace/PlotSection.tsx`) renders the
labels and tab strip. **A plot type that exists in one layer but not
the others is a silent UX bug** — the frontend either falls back to
showing the raw kebab-case ID, or the backend returns 404 for a tab
the user can see.

This file is the single source of truth for the inventory + per-row
symmetry checks. Every plot-touching PR must update both this matrix
*and* the relevant code; new plot types land in all layers in the
same PR.

---

## Inventory (as of 2026-05-05, post PR-B3)

| Plot ID                    | Adapter dispatch            | Frontend label    | Task scope          | Notes |
|----------------------------|-----------------------------|-------------------|---------------------|-------|
| `learning-curve`           | `plot_learning_curve`       | `Learning Curve`  | all                 | accepts `metrics` filter |
| `oof-distribution`         | `plot_oof_distribution`     | `OOF Dist`        | all                 | |
| `roc-curve`                | `roc_curve_plot`            | `ROC`             | binary              | |
| `calibration`              | `calibration_plot`          | `Calibration`     | binary + cal enabled | |
| `probability-histogram`    | `probability_histogram_plot`| `Prob Hist`       | binary + cal enabled | |
| `residuals`                | `residuals_plot`            | `Residuals`       | regression          | |
| `importance`               | `importance_plot`           | `Importance`      | all                 | accepts `kind={split,gain,shap}`; `top_n` query (P-0097) |
| `shap-summary`             | `importance_plot`           | `SHAP Summary`    | all + shap installed| alias of `importance_plot(kind="shap")` (Issue #373) |
| `tuning`                   | `tuning_plot`               | _(in TuneTrialsSection)_ | tune jobs    | NOT in `PLOT_LABELS` — rendered by `TuneTrialsSection`, intentionally absent from the tab strip |

### Source map

| Layer | File | Symbol |
|---|---|---|
| Adapter dispatch | `src/lizystudio/backends/lizyml/evaluation_mixin.py` | `_PLOT_DISPATCH` |
| Adapter availability probe | `src/lizystudio/backends/lizyml/evaluation_mixin.py` | `available_plots()` |
| API list endpoint | `src/lizystudio/api/jobs.py` | `GET /api/jobs/{id}/plots` |
| API render endpoint | `src/lizystudio/api/jobs.py` | `GET /api/jobs/{id}/plot/{plot_type}` |
| Frontend labels | `frontend/src/components/workspace/PlotSection.tsx` | `PLOT_LABELS` |
| Importance kind labels | `frontend/src/components/workspace/PlotSection.tsx` | `KIND_LABELS` |

---

## Symmetry rules (must hold)

1. **Adapter ⊇ frontend (with one exception)**: every key in `PLOT_LABELS` must be a key in `_PLOT_DISPATCH`. The lone exception is `tuning`, which is dispatched by the adapter but rendered by `TuneTrialsSection` rather than the tab strip — the inverse direction (`_PLOT_DISPATCH \ {tuning} ⊆ PLOT_LABELS`) holds.
2. **availability_plots ⊆ _PLOT_DISPATCH**: every plot ID returned by `available_plots()` must dispatch correctly. `shap-summary` is conditionally probed via a try/except on `importance(kind="shap")` because shap is an optional dependency.
3. **Frontend always falls back to kebab-case**: when `PLOT_LABELS[id]` is missing, the tab strip renders `id` directly (`PlotSection.tsx:147`). This is graceful, but invisible — anyone shipping a plot must update the label table to keep the UI polished.

### Verification

The adapter side is unit-tested in `tests/test_lizyml_evaluation_mixin.py` (one case per `_PLOT_DISPATCH` entry). The frontend side has snapshot coverage in `frontend/src/components/workspace/PlotSection.test.tsx`. There is no automated cross-layer drift check today — the matrix above plus the source map are the contract.

---

## How to add a new plot type

1. Implement the rendering on the lizyml side (or wherever the new backend lives).
2. Add the dispatch entry to `_PLOT_DISPATCH` and probe in `available_plots()` if the prerequisite is conditional (optional dependency, task type).
3. Add a unit test exercising the new dispatch entry.
4. Add the human label to `PLOT_LABELS` (and `KIND_LABELS` if it needs sub-kinds).
5. Add a row to the inventory table above.
6. If the new plot has its own toolbar (top-N, kind selector, metric filter), wire the props through `JobResultsBody.tsx` → `PlotSection.tsx`.
7. Capture a Storybook snapshot if the plot has unique visual chrome.

---

## How to remove / rename a plot type

1. Add a deprecation comment + removal target version to the relevant `_PLOT_DISPATCH` entry.
2. Keep the entry around for **one** minor release to give users time to remove it from their muscle memory.
3. After the grace release: drop from `_PLOT_DISPATCH`, drop from `PLOT_LABELS`, drop the row here, and add a `BREAKING` line to `CHANGELOG.md`.

---

## History

- **2026-05-05** — file created as part of PR-B4 (R-3.3 audit). `shap-summary` was missing from `PLOT_LABELS` and rendered as raw kebab-case in the tab strip; PR-B4 fixed the label and pinned the symmetry rule above.
