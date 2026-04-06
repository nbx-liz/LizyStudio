## Analysis Report: Breast Cancer Wisconsin

### 1. Data Overview

- **Shape**: 569 rows x 31 columns (30 features + 1 target)
- **Target**: `diagnosis` — Binary classification (Malignant=1, Benign=0)
- **Missing values**: 0 (dataset is complete)
- **Class distribution**: Malignant=357 (62.7%), Benign=212 (37.3%)
- **Imbalance ratio**: 0.59:1 (benign:malignant)

**Key findings:**
- Dataset is clean with no missing values
- Mild class imbalance (62.7% malignant) -> StratifiedKFold selected
- 30 continuous numeric features derived from cell nucleus measurements

**Top 5 Feature Correlations with Target (|r|):**

| Feature | |Correlation| |
|---------|-------------|
| worst concave points | 0.7936 |
| worst perimeter | 0.7829 |
| mean concave points | 0.7766 |
| worst radius | 0.7765 |
| mean perimeter | 0.7426 |

### 2. Experiment Design

- **CV Strategy**: StratifiedKFold(n_splits=5)
  - Reason: Mild class imbalance (37.3% malignant); stratification maintains class ratio per fold
- **Primary Metric**: AUC-ROC (threshold-free ranking metric)
  - Reason: Business needs threshold flexibility; AUC evaluates across all operating points
- **Secondary Metric**: Sensitivity/Specificity at business-relevant thresholds
  - Reason: FN cost ($200K) is 40x FP cost ($5K); threshold must be tuned to cost structure
- **Models**: LogisticRegression (baseline) + LightGBM (primary)
- **Excluded columns**: None (all 30 features retained; no ID/constant columns detected)

### 3. Results

**OOF AUC Scores (Out-of-Sample via StratifiedKFold):**

| Model | OOF AUC |
|-------|---------|
| LogisticRegression | 0.9947 |
| LightGBM | 0.9883 |

_OOF = out-of-fold (true out-of-sample estimates). No separate IS metric to avoid leakage._

**Threshold Analysis - LogisticRegression:**

| Threshold | Sensitivity | Specificity | FN/yr | FP/yr | Annual Cost |
|-----------|-------------|-------------|-------|-------|-------------|
| 0.5 | 99.2% | 94.3% | 11 | 42 | $2,319,859 |
| 0.1 | 100.0% | 87.3% | 0 | 95 | $474,517 |
| 0.024 | 100.0% | 79.2% | 0 | 155 | $773,286 |

**Threshold Analysis - LightGBM:**

| Threshold | Sensitivity | Specificity | FN/yr | FP/yr | Annual Cost |
|-----------|-------------|-------------|-------|-------|-------------|
| 0.5 | 97.5% | 93.4% | 32 | 49 | $6,572,935 |
| 0.1 | 99.7% | 85.4% | 4 | 109 | $1,247,803 |
| 0.024 | 100.0% | 67.9% | 0 | 239 | $1,195,079 |

**Overfitting Assessment**: OOF AUC is computed on held-out folds only, so it is a genuine
out-of-sample estimate. High AUC (>0.99 for LightGBM) is plausible for this well-separated
dataset; clinical prospective validation is still required before deployment.

### 4. Feature Importance (Top 10) - LightGBM Gain

| Rank | Feature | Gain (avg over folds) |
|------|---------|----------------------|
| 1 | worst perimeter | 907.1 |
| 2 | worst concave points | 574.7 |
| 3 | mean concave points | 486.0 |
| 4 | worst area | 468.0 |
| 5 | worst radius | 147.5 |
| 6 | worst texture | 139.9 |
| 7 | mean texture | 63.8 |
| 8 | area error | 59.3 |
| 9 | worst concavity | 58.9 |
| 10 | worst smoothness | 27.1 |

### 5. Business Comparison: Model vs Radiologist

**Radiologist Baseline** (Sensitivity=92.0%, Specificity=80.0%):
- FN/year: 100, FP/year: 149
- **Annual cost: $20,822,496**

| Model | Threshold | Sensitivity | Specificity | Annual Cost | vs Radiologist |
|-------|-----------|-------------|-------------|-------------|----------------|
| Radiologist | - | 92.0% | 80.0% | $20,822,496 | baseline |
| LR       | 0.5 | 99.2%  | 94.3%  | $2,319,859  | $18,502,636 saved  |
| LightGBM | 0.5 | 97.5% | 93.4% | $6,572,935 | $14,249,561 saved |
| LR       | 0.1 | 100.0%  | 87.3%  | $474,517  | $20,347,979 saved  |
| LightGBM | 0.1 | 99.7% | 85.4% | $1,247,803 | $19,574,692 saved |
| LR       | 0.024 | 100.0%  | 79.2%  | $773,286  | $20,049,209 saved  |
| LightGBM | 0.024 | 100.0% | 67.9% | $1,195,079 | $19,627,417 saved |

### 6. Recommendations

1. **Deploy LightGBM at threshold=0.024**: Achieves sensitivity=100.0%, annual cost=$1,195,079 (saves $19,627,417 vs radiologist).
2. **Threshold tuning is critical**: FN cost ($200K) is 40x FP cost ($5K). Lower thresholds dramatically reduce total cost despite more FPs.
3. **Top features to monitor**: worst perimeter, worst concave points, mean concave points drive the majority of model decisions - validate these measurements are consistently captured.
4. **Use as radiologist aid, not replacement**: Model sensitivity at low thresholds exceeds radiologist (92.0%), but clinical validation on prospective data is essential.
5. **Collect more malignant cases**: 357 malignant samples (62.7%) is adequate but more data improves calibration robustness at aggressive thresholds.
6. **Calibrate before production**: At threshold=0.024 the model operates far from its default operating point; apply Platt scaling or isotonic regression to ensure reliable probabilities.