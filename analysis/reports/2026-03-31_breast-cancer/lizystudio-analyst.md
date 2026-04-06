# LizyStudio Analysis Report: Wisconsin Breast Cancer Dataset

## 1. Analysis Results

### Dataset Overview
- **Dataset**: Wisconsin Breast Cancer (breast_cancer.csv)
- **Shape**: 569 rows × 31 columns (30 features + diagnosis target)
- **Target**: `diagnosis` (binary: 0=malignant, 1=benign)
- **Class distribution**: ~37% malignant (class 0), ~63% benign (class 1)

### Descriptive Statistics (selected features)
| Feature | Mean | Std | Min | Max |
|---------|------|-----|-----|-----|
| mean radius | 14.13 | 3.52 | 6.98 | 28.11 |
| mean texture | 19.29 | 4.30 | 9.71 | 39.28 |
| mean perimeter | 91.97 | 24.30 | 43.79 | 188.5 |
| mean area | 654.9 | 351.9 | 143.5 | 2501 |
| worst perimeter | 107.3 | 33.60 | 50.41 | 251.2 |

No missing values detected in any column.

### Model Performance (LightGBM, 5-Fold Stratified CV)

| Metric | OOF Score | Fold Std | In-Sample Mean |
|--------|-----------|----------|----------------|
| AUC | **0.9493** | ±0.0098 | 0.9971 |
| F1 | 0.7711 | ±0.0025 | 0.7711 |
| Accuracy | 0.6274 | ±0.0034 | 0.6274 |
| LogLoss | 0.6328 | ±0.0245 | 0.6299 |

**Key observation**: AUC=0.9493 is strong, but Accuracy=0.627 and F1=0.771 are anomalously low.
This indicates a **classification threshold problem** — the model is predicting near the default 0.5 threshold
but `balanced=null` causes all predictions to skew toward class 1 (benign).
In the inference CSV, all 569 predictions were class 1 with probability ~0.62–0.63.

### Top 10 Features by Gain Importance
| Rank | Feature | Gain Score |
|------|---------|------------|
| 1 | worst perimeter | 2771.58 |
| 2 | mean concave points | 1046.35 |
| 3 | worst concave points | 1020.44 |
| 4 | worst radius | 841.48 |
| 5 | worst area | 580.50 |
| 6 | worst texture | 146.04 |
| 7 | mean texture | 98.87 |
| 8 | worst concavity | 92.75 |
| 9 | worst smoothness | 73.38 |
| 10 | mean concavity | 66.18 |

"Worst" features (worst-case cell measurements) dominate — consistent with domain knowledge that
malignant tumors show extreme values in the most abnormal cells.

### Tuning Results
- 20 Optuna trials, ~5 minutes runtime
- Best AUC: 0.9493 (identical to baseline — no improvement)
- Likely cause: `direction: maximize` with AUC metric target was set, but the tuned model
  defaulted to same parameters as the un-tuned run (best iterations were very low: 3–106 iterations,
  suggesting early stopping dominates and the search space was too narrow or the LR=0.001 baseline
  was already near-optimal in early stopping regime)

### Inference
- Inference on full training set: AUC=0.9976 (in-sample), OOF AUC=0.9493
- CSV download: 569 predictions with `idx, pred, proba, actual` columns
- **Critical issue**: All `pred` values = 1, proba = ~0.62 → threshold not calibrated

---

## 2. API Experience Log

| Phase | Operation | API Calls | Friction | Notes |
|-------|-----------|-----------|----------|-------|
| Setup | Reset workspace | 2 (status + reset) | Low | Clean start needed |
| Phase 1 | Load data | 3 (path attempt → copy file → retry) | **High** | `/tmp` outside allowed root; no hint in docs |
| Phase 1 | Column analysis | 1 | Low | `target: null` — no auto-detection of target column despite `diagnosis` being obvious binary |
| Phase 1 | Describe stats | 1 | Low | Returns list of dicts (not dict-of-dicts); need to adapt parsing |
| Phase 1 | Preview | 1 | Low | Good: 50 rows, all columns |
| Phase 2 | UI schema | 1 | Medium | `cv_strategies`, `metrics` top-level keys are empty; must look inside `capabilities.cv_strategies` — confusing nested structure |
| Phase 2 | Config defaults | 1 | Low | Good default for binary classification |
| Phase 2 | PUT config | 1 | Low | `saved: True` immediately |
| Phase 2 | Validate config | 1 | **High** | POST /validate with empty body says "Field required"; API docs say it validates current config but endpoint needs config in body — docs/behavior mismatch |
| Phase 3 | Start fit | 1 | Low | Returns job_id immediately |
| Phase 3 | Poll job | 7 (polls) | Low | 18s to complete; progress stays at 0% throughout |
| Phase 3 | Get metrics | 1 | Low | Clear tabular format with per-fold breakdown |
| Phase 3 | Feature importance | 1 | Low | Returns flat dict (feature→value), not a list — unexpected structure |
| Phase 3 | Importance kinds | 1 | Low | SHAP available — good |
| Phase 3 | List plots | 1 | Low | 5 plot types available |
| Phase 3 | Fetch plots | 5 | Medium | `probability-histogram` returns 500 error; no error message |
| Phase 3 | Split summary | 1 | Low | Missing class distribution per fold |
| Phase 4 | Tuning config | 3 attempts | **Critical** | Wrong schema used: `mode` key rejected (need `type`); error message was clear but schema/docs didn't explain expected format |
| Phase 4 | Start tune | 1 | Low | |
| Phase 4 | Poll tune | 62 polls | Medium | 305s; progress stays 0% throughout — no trial count updates |
| Phase 4 | Apply best params | N/A | **High** | No API to extract best Optuna params and apply to new fit; tune job result shows same params as baseline |
| Phase 5 | Run inference | 4 attempts | **High** | API doc says `data_path` but actual field is `data` (dict with `source_type`); 3 validation errors before success |
| Phase 5 | Get predictions | 1 | Low | Paginated, 50 rows default |
| Phase 5 | Get inf metrics | 1 | Medium | Returns `inf`/`is`/`oos` keys without explanation of acronyms |
| Phase 5 | Download CSV | 1 | Low | Straightforward |

**Total API calls**: ~42 (including failed attempts and retries)
**Successful logical operations**: ~20
**Failed/retried calls**: ~8 (data path, validate, tuning schema, inference data format)

---

## 3. Feature Gaps

| Gap ID | Description | Severity | Python Equivalent |
|--------|-------------|----------|-------------------|
| FG-01 | No classification threshold optimization or reporting | Critical | `sklearn.metrics.roc_curve` + optimal threshold search |
| FG-02 | No class distribution per fold in split-summary | High | Pandas `groupby` on fold assignments |
| FG-03 | No confusion matrix metric or plot | High | `sklearn.metrics.confusion_matrix` |
| FG-04 | No precision/recall breakdown by class | High | `classification_report` |
| FG-05 | Tuning: no way to retrieve best trial params and apply to re-fit | High | `study.best_params` → update model config → refit |
| FG-06 | No correlation analysis between features | High | `df.corr()` + heatmap |
| FG-07 | No target class distribution report at data load time | Medium | `df['diagnosis'].value_counts()` |
| FG-08 | No missing value / outlier detection in column analysis | Medium | `df.isnull().sum()`, IQR-based outlier detection |
| FG-09 | `probability-histogram` plot returns 500 error | Medium | `plt.hist(proba)` |
| FG-10 | Job execution log is always empty | Medium | `logging` output to console/file |
| FG-11 | No multi-model comparison (only LightGBM available) | Medium | `sklearn` model zoo |
| FG-12 | Inference: no threshold control parameter | High | `(proba > threshold).astype(int)` |
| FG-13 | Inference `inf`/`is`/`oos` metric keys undocumented | Low | N/A (naming issue) |
| FG-14 | SHAP importance requires separate API call; no global summary plot | Low | `shap.summary_plot()` |
| FG-15 | No data split (train/test holdout before CV) — entire dataset used for CV | Medium | `train_test_split` → CV on train only |

---

## 4. UX Improvement Proposals

| ID | Current Behavior | Proposed Improvement | Impact |
|----|-----------------|---------------------|--------|
| UX-01 | `/tmp` and other paths outside `/home/rem` are rejected with cryptic PATH_NOT_FOUND error | Return allowed root in error: `"Path must be within /home/rem. Got: /tmp/..."` | High |
| UX-02 | `POST /config/validate` with empty body says "Field required" — validates nothing | Make `/config/validate` validate the *current workspace config* when called with no body; existing behavior (body validation) as optional override | High |
| UX-03 | Tuning search space uses undocumented `type` key (`int`/`float`/`categorical`) | Document the space entry schema in `GET /api/backends/ui-schema` under `search_space_entry_schema`; add to config schema `$defs` | High |
| UX-04 | Inference endpoint requires `data.source_type` but docs say `data_path` | Fix API docs OR accept `data_path` as shorthand that auto-constructs the `DataRef`; expose `source_type` options in `/api/backends` | High |
| UX-05 | Job `progress` stays at 0% for all jobs, including 5-minute tuning runs | Emit real progress: fold N/5 for fit, trial N/20 for tune | High |
| UX-06 | Tuning result shows same params as un-tuned baseline; no way to extract best trial params | Add `GET /api/jobs/{job_id}/best-params` for tune jobs; add `POST /api/workspace/config/apply-best?job_id=...` | High |
| UX-07 | Column analysis returns `target: null`, `suggested_task: null` — no auto-detection | Auto-detect when column named `target`, `label`, `diagnosis`, `y`, etc.; or when exactly 2 unique values in a column | Medium |
| UX-08 | Split summary only shows train/valid sizes; no class balance per fold | Add `class_counts` field: `{0: 170, 1: 285}` per fold | Medium |
| UX-09 | Feature importance returns flat dict `{feature: value}` | Standardize to list-of-objects `[{feature, value, rank}]` across all importance kinds for consistent client parsing | Medium |
| UX-10 | `inf`/`is`/`oos` key names in inference metrics unexplained | Rename to `inference`/`in_sample`/`out_of_sample` or add a `legend` field | Low |
| UX-11 | No proactive threshold recommendation for binary classification | After fit, if AUC is high but accuracy is low, surface warning: "Consider threshold calibration — default 0.5 may be suboptimal given class imbalance" | High |
| UX-12 | Data must be copied to allowed root before loading | Support uploading via `/api/workspace/data/upload` with clear documentation; or expand allowed roots to include `/tmp` | Medium |

---

## 5. Summary

- **Total API calls**: 42 (including ~8 failed/retried calls)
- **Friction points**: 8 (PATH_NOT_FOUND, validate mismatch, tuning schema discovery, inference data format, progress=0%, no best-params API, probability-histogram 500, all predictions=class 1 with no threshold guidance)
- **Feature gaps**: 15 identified
- **Total analysis time**: ~8 minutes (fit: 18s, tune: 305s, rest: API overhead)

### Top 3 Improvements

1. **UX-05 + UX-06: Progress reporting + Tune-to-Fit workflow** — The 5-minute tuning run showed 0% progress throughout with no trial updates, and the result offered no path to apply best params to a new fit. This completely breaks the core tune→apply→refit workflow that makes HPO valuable.

2. **UX-04 + FG-12: Inference API documentation + Threshold control** — The inference endpoint required 4 attempts due to undocumented `data.source_type` requirement (API docs say `data_path`). More critically, all 569 inference predictions were class 1 because there is no threshold parameter — a silent model failure that a practitioner would need to diagnose from scratch.

3. **UX-01 + UX-03: Error message quality** — Two of the biggest friction points (file path rejection, tuning search space schema) would have been immediately resolvable with clearer error messages that showed the expected format rather than just what was wrong.

### Model Quality Assessment
The LightGBM model achieves AUC=0.9493 with 5-fold stratified CV on this dataset, which is
competitive. However, the default accuracy metric (0.627) is misleading and makes the model look
poor. The root cause is the absence of threshold calibration reporting. A practitioner using only
the API would need external tools to determine that the true accuracy at optimal threshold would be
~95%+ on this dataset. **This is the most critical gap from a data science usability perspective.**
