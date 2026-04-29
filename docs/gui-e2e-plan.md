# GUI E2E 強化計画
作成日: 2026-04-29
動機: post-#271 smoke Phase 4 監査の延長。GUI 動作カバレッジの欠落補填 + 全設定項目の Config 反映 invariant 化。

## ゴール

1. **GUI 操作シナリオの網羅性向上** — 既存 49 シナリオの白地（Jobs functional / CV strategy 切替 / Feature Weights / Column Settings / Preset Load / running lock 等）を埋める
2. **設定項目 → Config 反映 invariant の自動化** — 全 UI コントロールが `PUT /api/workspace/config` の正しいフィールドに正しい値を書くことを E2E で locking

## 設計原則

### Config-reflection 検証パターン

各シナリオは「**操作 → ネットワーク観測**」の 3 段で書く。

```typescript
// (1) UI 操作前の baseline を取る
const before = await getConfig(request);

// (2) UI 操作（input / click / select）
await page.getByLabel("Folds").fill("7");

// (3) PUT /config を観測してアサート
const put = await page.waitForRequest(req =>
  req.url().endsWith("/api/workspace/config") && req.method() === "PUT"
);
const body = put.postDataJSON();
expect(body.split.n_splits).toBe(7);

// (4) 反映後の GET を取り、saved 値が期待と一致
const after = await getConfig(request);
expect(after.split.n_splits).toBe(7);
```

これにより以下を同時に検証:

- UI コントロール → wire field name の対応
- 値の型変換（NumberInput の string → int 等）
- 同時に flush される他フィールドが意図せず変わっていない
- サーバ側の Pydantic バリデーションを通過

## Phase A: 設定項目 × UI コントロール × Config 反映マトリクス

LizyML schema 全フィールドを横軸に、UI 表現と E2E 状態を縦軸にした **完全マトリクス**。

### A.1 `data` セクション

| Config field | 型 | UI コントロール | UI 場所 | 既存 E2E | 状態 |
|---|---|---|---|---|---|
| `data.path` | str? | TextInput + Browse | DataSourceSection | workspace-fit:UI Data load | ✅ |
| `data.target` | str | Select | DataPanel target | workspace-fit:UI target select | ✅ |
| `data.task`* | enum | SegmentGroup | DataPanel task | workspace-ui-improvements:Task SegmentButton | ✅ |
| `data.time_col` | str? | Select (CV 条件付き) | CvSection | **なし** | ❌ NEW |
| `data.group_col` | str? | Select (CV 条件付き) | CvSection | **なし** | ❌ NEW |

注: `data.task` は LizyML では `LizyMLConfig.task` トップレベル。

### A.2 `features` セクション

| Config field | 型 | UI コントロール | UI 場所 | 既存 E2E | 状態 |
|---|---|---|---|---|---|
| `features.exclude` | list[str] | Excl checkbox 列 | ColumnSettingsSection | **なし** | ❌ NEW |
| `features.auto_categorical` | bool | (UI 露出なし、デフォルト true) | — | — | ⚠ 確認要 |
| `features.categorical` | list[str] | Type=Cat トグル | ColumnSettingsSection | **なし** | ❌ NEW |

### A.3 `split` セクション（8 strategy 分岐）

#### 共通
| Config field | UI | 既存 E2E | 状態 |
|---|---|---|---|
| `split.method` | SegmentButton | workspace-advanced:API group_kfold のみ | ⚠ UI 切替テスト無し |
| `split.n_splits` | NumberInput "Folds" | **なし** | ❌ NEW |

#### Strategy 別フィールド（CV strategy 切替で出現/消失）

| Strategy | 固有フィールド | UI | E2E |
|---|---|---|---|
| `kfold` | `random_state`, `shuffle` | NumberInput + Switch | ❌ |
| `stratified_kfold` | `random_state` | NumberInput | ❌ |
| `group_kfold` | (n_splits, group_col) | Select | ❌ |
| `stratified_group_kfold` | `random_state`, `shuffle`, group_col | mix | ❌ |
| `time_series` | `gap`, `train_size_max?`, `test_size_max?`, time_col | NumberInput*4 + Select | ❌ |
| `purged_time_series` | `purge_gap`, `embargo`, `train_size_max?`, `test_size_max?` | NumberInput*4 | ❌ |
| `group_time_series` | `gap`, sizes, group_col, time_col | mix | ❌ |
| `blocked_group_kfold` | `blocks{col,cutoffs,mode,train_window?}`, `groups{col,n_splits,stratify,shuffle}`, `min_train_rows`, `min_valid_rows` | BlockedGroupKFoldEditor | ❌ |

→ **8 strategy × 平均 4 フィールド = 32 個のサブシナリオ**。strategy 切替時に**他 strategy のフィールドが消える** invariant も必要（post-#271 smoke で何度も問題化したクラス）。

### A.4 `model` セクション（LGBM）

| Config field | UI | E2E |
|---|---|---|
| `model.name` | (固定 lgbm) | — |
| `model.params` | dict (Raw Config or KeyValueEditor) | KeyValueEditor.test (unit のみ) |
| `model.auto_num_leaves` | Switch | ❌ |
| `model.num_leaves_ratio` | NumberInput | ❌ |
| `model.min_data_in_leaf_ratio` | NumberInput (nullable) | ❌ |
| `model.min_data_in_bin_ratio` | NumberInput (nullable) | ❌ |
| `model.feature_weights` | FeatureWeightsEditor | unit のみ。**E2E なし** | ❌ NEW (Issue #277 領域) |
| `model.balanced` | Switch | workspace-fit:UI Balanced toggle | ✅ |

### A.5 `training` セクション

| Config field | UI | E2E |
|---|---|---|
| `training.seed` | NumberInput | ❌ |
| `training.early_stopping.enabled` | Switch | ❌ |
| `training.early_stopping.rounds` | NumberInput | ❌ |
| `training.early_stopping.inner_valid.method` | Select (holdout/group_holdout/time_holdout) | ❌ |
| `training.early_stopping.inner_valid.ratio` | NumberInput | ❌ |
| `training.early_stopping.inner_valid.stratify` (holdout) | Switch | ❌ |
| `training.early_stopping.inner_valid.random_state` | NumberInput | ❌ |
| `training.early_stopping.validation_ratio` | NumberInput (nullable) | ❌ |

### A.6 `tuning` セクション

| Config field | UI | E2E |
|---|---|---|
| `tuning.optuna.params.n_trials` | NumberInput | workspace-tune:API のみ |
| `tuning.optuna.params.direction` | (Tune tab metric chips に置換、H-0013) | workspace-ui-improvements:metric chips | ✅ |
| `tuning.optuna.params.timeout` | NumberInput (nullable) | ❌ |
| `tuning.optuna.space` | KeyValueEditor + Range / Choice / Fixed | workspace-tune:UI 空 Choice disable | ⚠ 部分 |
| `tuning.optuna.space.<param>.kind` | Mode SegmentButton | workspace-ui-improvements:Mode SegmentButton | ✅ |
| `tuning.optuna.space.<param>.range` | min/max/step | ❌ |
| `tuning.optuna.space.<param>.choices` | list editor | ❌ |
| `tuning.optuna.space.<param>.fixed` | FixedValueEditor | unit のみ |

### A.7 `evaluation` / `calibration`

| Config field | UI | E2E |
|---|---|---|
| `evaluation.metrics` | (UI 露出なし。Tune tab metric chips が一部担当) | metric chips のみ | ⚠ |
| `calibration.method` (binary 限定) | Select | CalibrationSection.test (unit) | ❌ |
| `calibration.n_splits` | NumberInput | unit のみ |
| `calibration` enable トグル | Switch | workspace-fit:UI Calibration toggle | ✅ |

## Phase B: GUI 操作ギャップ補填（前回 §1.7 ベース）

| # | ギャップ | 新規追加 spec | 規模 |
|---|---|---|---|
| B-1 | Jobs ページ functional UI 0 件 | `jobs-ui.spec.ts`: 一覧クリック→詳細表示 / フィルタ操作 / Export ダイアログ / Delete 確認 / Cancel | 中 |
| B-2 | Inference History クリックで結果切替 | `inference-flow.spec.ts` 拡張 | 小 |
| B-3 | CV strategy 切替（8 strategy 巡回） | `workspace-cv.spec.ts`: Phase A.3 のマトリクスを駆動 | 中 |
| B-4 | Feature Weights エディタ操作 | `workspace-feature-weights.spec.ts`: ON → Add → 値編集 → PUT 観測 | 小 |
| B-5 | Column Settings の Excl/Type 操作 | `workspace-columns.spec.ts`: チェック → PUT で features.exclude/categorical 反映 | 小 |
| B-6 | Preset Load → form 反映 | `workspace-presets.spec.ts`: Save → Load → 全 NumberInput が反映 | 小 |
| B-7 | Fit 中 running lock の UI 表示 | `workspace-running-lock.spec.ts`: Fit 開始 → 全 input が disabled / 409 toast | 中 |
| B-8 | Mobile/Tablet レイアウト | `workspace-mobile.spec.ts`: viewport 縮小 → bottom-tab 切替で全 panel アクセス | 中 |

## Phase C: Config-reflection invariant 自動 spec ジェネレータ

A のマトリクスを **手書きで全 60+ 件書くと保守がきつい**。代わりに以下の構造で自動化する。

### 仕様

```typescript
// frontend/tests/e2e/helpers/config-reflection.ts
export interface ConfigFieldSpec {
  name: string;
  uiSelector: () => Locator;
  uiAction: (locator: Locator, value: any) => Promise<void>;
  configPath: string;        // e.g. "split.n_splits"
  testValue: any;
  defaultValue: any;
  precondition?: () => Promise<void>; // e.g. "select stratified_kfold first"
}

export async function assertConfigReflection(
  page: Page, request: APIRequestContext, spec: ConfigFieldSpec
): Promise<void> {
  await spec.precondition?.();
  await assertCurrentConfig(request, spec.configPath, spec.defaultValue);
  const putPromise = page.waitForRequest(/api\/workspace\/config/);
  await spec.uiAction(spec.uiSelector(), spec.testValue);
  const put = await putPromise;
  expect(deepGet(put.postDataJSON(), spec.configPath)).toEqual(spec.testValue);
  await assertCurrentConfig(request, spec.configPath, spec.testValue);
}
```

### Spec データソース

`frontend/tests/e2e/fixtures/config-fields.ts` に **A.1〜A.7 のマトリクスをデータとして外出し**。spec ファイル本体は `forEach(spec => test(spec.name, ...))` のループで全項目をカバー。フィールド追加時は fixture 行を 1 つ足すだけ。

### 既存の P-0087 contract test との関係

`tests/contract/test_ui_schema_pydantic_alignment.py` が **schema レベルの drift** を locking するなら、この E2E は **値の流通** を locking する。重複ではなく直交補完。

## Phase D: 段階実装プラン

| Phase | 内容 | PR 規模 | change-gate |
|---|---|---|---|
| **D-1** | Phase A マトリクス完成（fixture データ + helper の骨格） | 中 (~400 行) | 不要 (テスト追加のみ) |
| **D-2** | Phase B-1 (Jobs UI) + B-3 (CV strategy 切替) | 中 | 不要 |
| **D-3** | Phase B-2/B-4/B-5/B-6 (Inference history / FW / Columns / Presets) | 中 | 不要 |
| **D-4** | Phase B-7 running lock + B-8 mobile | 中 | 不要 |
| **D-5** | Phase C ジェネレータ起動 + 全フィールド loop | 大 (~600 行) | 不要 |

各 Phase の完了条件: `pnpm test:e2e` PR ブロッキング job が green、Nightly visual も green 維持。

## 期待効果

| 指標 | 現状 | 計画後 |
|---|---:|---:|
| GUI シナリオ数 | 49 | ~110 |
| Config field × UI 反映カバレッジ | 推定 25% | 100% |
| post-#271 smoke 系統の手動検証必要性 | 都度発生 | 自動化済み |
| 新規フィールド追加時の手間 | spec 1 個書く | fixture 1 行追加 |

## リスク

- **`waitForRequest` はタイミング依存** — debounce 中に複数 PUT が飛ぶと取り違える。`useConfigSync` の dedup key で安定化していることを利用、念のため `request.postDataJSON()` で内容確認
- **Mobile spec の golden** — visual 系は Nightly 行きにし、PR ブロッキングは functional のみ
- **CV strategy 切替時の他 strategy フィールド消失 invariant** — 現実装では `cv_strategy_fields` (P-0087) が SSOT、ただし wire 側で前 strategy の値が漏れる可能性は再検証が必要

## 次のアクション候補

1. **D-1 から着手**: `frontend/tests/e2e/helpers/config-reflection.ts` の helper + 1 サンプルフィールド (split.n_splits) で雛形を作る
2. もしくは **Phase B-3 (CV strategy 切替)** を先行: post-#271 smoke で繰り返し問題化した領域なので回帰防止効果が最も高い
3. もしくは **Phase B-1 (Jobs UI)** を先行: 現状 functional UI シナリオが完全にゼロな領域
