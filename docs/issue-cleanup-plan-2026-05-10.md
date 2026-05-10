# Issue Cleanup Plan — 2026-05-10

**Status**: 🟡 計画策定済み・着手は別セッションで実施
**Drafted**: 2026-05-10
**Last Updated**: 2026-05-10 (LizyML v0.13/v0.14 release + Issue #159 reflected)
**Owner**: TBD
**Scope**: LizyStudio + LizyML 両 repo の open Issue を 6 Wave 構成で消化する計画
**Trigger**: 2026-05-10 セッションでの Issue 棚卸しに基づく

## Update Log

- **2026-05-10 (post-drafting, AM)**: LizyML v0.13.0 + v0.14.0 が同日リリース。
  - LizyML #152 → CLOSED（H-0078 Phase 1-3 完了）
  - **Wave 1.2 縮退**: LizyML #152 PR → 単純な dep bump へ
  - **Wave 3 unblock**: Studio #461 が並行可能に
  - **D6 確定 → Option C**（#460 を usability-only に縮小、bounds map は #461 で UiSchema 直行）
  - **D3 再評価**: LizyML 側 `_OBJECTIVE_CHOICES` の silent override バグ発見 → LizyML Issue [#159](https://github.com/nbx-liz/LizyML/issues/159) 起票
  - **D7 追加**: model_metric 連動方針確定（LizyML Issue #159 待ち）

- **2026-05-10 (PM, LizyML #159 完結)**: LizyML v0.15.0 リリース完了。
  - LizyML #159 → CLOSED（H-0079 Phase 1-3 + follow-up すべて完了）
  - **PRs merged**: [#160](https://github.com/nbx-liz/LizyML/pull/160) Phase 1 / [#161](https://github.com/nbx-liz/LizyML/pull/161) Phase 2 / [#162](https://github.com/nbx-liz/LizyML/pull/162) Phase 3 / [#163](https://github.com/nbx-liz/LizyML/pull/163) docs / [#164](https://github.com/nbx-liz/LizyML/pull/164) follow-up coverage / [#165](https://github.com/nbx-liz/LizyML/pull/165) CHANGELOG / [#166](https://github.com/nbx-liz/LizyML/pull/166) release v0.15.0
  - **新 Public API**:
    - `EstimatorProvider.objective_choices(task) -> tuple[str, ...]` — canonical 名のみ（regression 9 / binary 3 / multiclass 2）
    - `EstimatorProvider.metric_choices(task) -> dict[Literal["native", "feval"], tuple[str, ...]]`
    - `MetricChoices` type alias
    - `TASK_COMPATIBLE_OBJECTIVES` whitelist
    - `default_space(task, provider=None)` — provider 渡しで完全 SSOT 連動
  - **副次的に発見・修正されたバグ**: `_LGBM_NATIVE_METRICS["multiclass"]` に誤って `auc` が含まれていた（LightGBM 4.x が `"Multiclass objective and metrics don't match"` で拒否する）。L4 drift test が捕捉して Phase 3 で除去。**Studio 側でも `option_sets.model_metric.multiclass` に `auc` が含まれていれば同期で除外する必要あり**（Wave 3 で対応）
  - **Wave 3 完全 unblock**: lizyml dep を `>=0.12.0,<0.13.0` → `>=0.15.0,<0.16.0` に bump（v0.13/v0.14 経由不要、直接 v0.15 へ jump 可）
  - **Studio 側次アクション**:
    - Wave 1.1（Proposal P-XXXX）に LizyML #159 の SSOT 連動を組み込む
    - Wave 1.2 dep bump は **v0.15.0 直行**
    - Wave 3 #461 拡張版で `objective_choices()` + `metric_choices()` も UiSchema 経由で読む（`parameter_bounds()` と同じ枠で）

---

## 0. このドキュメントの位置付け

CLAUDE.md §1.1 / ROADMAP.md §0 の Tier 4（アクティブな個別計画）に該当。
完了時はヘッダに `**Status**: ✅ shipped <YYYY-MM-DD>` を付けて Tier 5 化（ファイル移動はしない）。

仕様の正は **依然として BLUEPRINT.md / HISTORY.md / PLAN.md**。
本計画は Issue 消化の sequencing と risk gate を整理するもので、新規仕様は提示しない。

---

## 1. Open Issue 全件棚卸し（23 件）

### 集計

- **LizyStudio**: 21 件（#403 / #442–#461）
- **LizyML**: 2 件（#148 future, #159 — #152 は 2026-05-10 に CLOSED）

### 分類

| Group | 件数 | Issue 番号 | テーマ | 優先度 |
|---|---|---|---|---|
| **A. Tune workflow 改修**（Studio + LizyML 横断、相互依存大） | 6 | #458 #459 #460 #461 + LizyML #152 (closed) + LizyML #159 | UX bug + 仕様 + validation + objective/metric SSOT API | **HIGH** |
| **B. UX polish (独立)** | 1 | #457 | Residuals kind selector | medium |
| **C-Inference. E2E test coverage** | 4 | #443 #444 #447 #448 | Inference 系 e2e | medium-low |
| **C-Jobs. E2E test coverage** | 3 | #442 #445 #446 | Jobs 系 e2e | medium-low |
| **D. Backend test coverage** | 2 | #449 #450 | INV defense | medium-low |
| **E. Refactor (技術負債)** | 3 | #403 #451 #452 | God-class 分割 + 関数縮小 | low（#451 は v0.5 R-1 後と明記） |
| **F. Docs / Chore** | 4 | #453 #454 #455 #456 | doc 整合 + 不要ファイル掃除 | low (tier-1/2) |
| **G. LizyML upstream (将来)** | 1 | LizyML #148 | v1.0 BREAKING removal | future（v1.0 まで保留） |

---

## 2. 依存関係マップ

```
LizyML #152 ──────► Studio #461 (Phase 2)
                        ▲
                    [dep bump 必要]

Studio #459 ──┐
Studio #458 ──┼──► 同じファイル群を編集 (lizyml_ui_schema.py / SearchSpaceRow.tsx / BLUEPRINT.md)
Studio #460 ──┘    ┗━ 直列実行必須 (merge conflict 回避)

Studio #457 ─── 独立 (PlotSection.tsx のみ)

Studio #454/#455 ─── 独立 (削除のみ)
Studio #456 ◄─── #454/#455 完了後

Studio #442–#448 ─── 独立、テストのみ
Studio #449/#450 ─── 独立、テストのみ

Studio #451/#452/#403 ─── #459–#461 着地後 (lizyml_ui_schema.py 領域の変更落ち着いてから)
Studio #453 ─── 全体着地後 (architecture-as-implemented を最後に reconcile)
```

### 重複ファイル検出（直列必須なものを同定）

| ファイル | 触る Issue | 戦略 |
|---|---|---|
| `src/lizystudio/backends/lizyml_ui_schema.py` | #458 #459 #460（#461 で再編集） | 直列 PR、1 owner |
| `frontend/src/components/workspace/SearchSpaceRow.tsx` | #459 #460（#461） | 直列 PR、1 owner |
| `BLUEPRINT.md §4.2.2` | #458 #459 | **1 つの BLUEPRINT 編集 PR にまとめる**（Wave 2.1 か 2.2 に同梱） |
| `src/lizystudio/backends/lizyml/config_mixin.py` | #459 のみ（Fit seed default） | 単独 |
| `frontend/src/components/retune/RetuneSettingsSection.tsx` | #458 のみ | 独立 |
| `HISTORY.md` Proposal | #458 #459 #460 | **1 つの Proposal P-XXXX に統合**（Decision 1 確定） |

---

## 3. 実行計画 — 6 Wave 構成

### Wave 1 — 基盤（Week 1, 並行開発可能）

| # | 作業 | 担当 repo | 並行性 |
|---|---|---|---|
| 1.1 | **Proposal P-XXXX 起票** in `HISTORY.md`（Tune workflow overhaul = #458 + #459 + #460 spec scope + LizyML #159 SSOT 連動方針 を 1 つにまとめる） | Studio | 単独 — 最初に承認取得 |
| 1.2 | **dep bump chore**（v0.12 → **v0.15** 直行）。LizyML #152（H-0078）+ #159（H-0079）すべて 2026-05-10 出荷済。`pyproject.toml` の `lizyml[plots,tuning,calibration,explain]>=0.12.0,<0.13.0` を `>=0.15.0,<0.16.0` に。`uv lock` 実行 + smoke test | Studio | 1.1 と並行 |
| 1.3 | **#455 PR**（session-handoff docs 削除）tier-1 | Studio | 1.1/1.2 と並行 |
| 1.4 | **#454 PR**（repo-root artefacts 掃除）tier-1 | Studio | 1.1/1.2 と並行 |

**Wave 1 終了条件:** Proposal P-XXXX が Decision 待ちで commit 済み / dep bump (`lizyml>=0.15.0,<0.16.0`) merge / #454 #455 merge

**LizyML 上流ブロッカーは全て解消済み** — Wave 2 / Wave 3 すべて並行可能

### Wave 2 — Tune workflow Studio 実装（Week 2, 直列）

Wave 1.1（Proposal）merge 後、以下を **直列で** 実行:

| # | 作業 | 触るファイル | tier |
|---|---|---|---|
| 2.1 | **#458 PR**（Re-tune Switch + null payload） | `RetuneSettingsSection.tsx` + BLUEPRINT（BLUEPRINT は 2.2 とまとめても OK） | 3 |
| 2.2 | **#459 PR-A**（backend: `lizyml_ui_schema.py` canonical defaults + `get_default_config()` seed=1120 + regression `cross_entropy` 除去 + objective master を **LightGBM 全 enum** に拡張、後で LizyML 連動に切替） | `lizyml_ui_schema.py` `config_mixin.py` `BLUEPRINT.md` | 4 |
| 2.3 | **#459 PR-B**（frontend: SearchSpaceRow inner_valid picker + Tune Evaluation defaults auto-populate） | `SearchSpaceRow.tsx` `TuneEvaluationSection.tsx` `TuneTab.tsx` | 4 |
| 2.4 | **#460 PR**（D6=Option C: usability-only — NumberInput integer 強制 + inline 警告のみ。bounds map は **採用しない**、#461 で UiSchema 直行） | `NumberInput.tsx` `SearchSpaceRow.tsx` `TuneTab.tsx` | 4 |

**Wave 2 内 sequencing 根拠:**
- 2.1 を最初に: 単独ファイル、独立 testable
- 2.2 を 2 番目に: backend SSOT を確定させる
- 2.3 を 3 番目に: 2.2 の `default_choices` を frontend が consume
- 2.4 を最後に: 上記が落ち着いた SearchSpaceRow.tsx に追加（D6 Option C により bounds map は省略 → throwaway code 不発生）

### Wave 3 — Integration（即着手可能、LizyML 上流ブロッカー解消済み）

| # | 作業 | 依存 |
|---|---|---|
| 3.1 | **#461 PR 拡張版** — UiSchema に 3 つの SSOT 連動を統合 | Wave 1.2 dep bump merge |
| | 1) `LGBMProvider().parameter_bounds(task)` → UiSchema (H-0078) | |
| | 2) `LGBMProvider().objective_choices(task)` → UiSchema (H-0079) | |
| | 3) `LGBMProvider().metric_choices(task)["native"] + ["feval"]` → UiSchema (H-0079) | |
| | + SearchSpaceRow Range Min/Max クランプ | |
| | + `validate_config` rewire（`parse_space()` 経由で v0.13 の typed errors 利用） | |
| | + `BoundaryDimStatus.clamped_to_bound` バッジ | |
| | + Studio `option_sets.objective` ハードコード削除（`option_sets.model_metric` ハードコード削除も） | |
| | + **multiclass `auc` 除去**（LizyML Phase 3 で発覚した LightGBM 4.x 不整合に追従） | |
| | + contract test `tests/contract/test_lizyml_objective_metric_drift.py` | |
| 3.2 | **dep bump smoke test 追加** — workspace-fit / workspace-tune e2e で v0.15 切替後の regression 検証 | 3.1 と同 PR でも別 PR でも可 |

**Wave 3 注意点:**
- LizyML `objective_choices(task)` は **canonical 名のみ**返す（aliases 排除済）。Studio UI でそのまま enum 表示可
- `metric_choices(task)` は **dict 戻り** — Studio で UI 表示するときは `{...["native"], ...["feval"]}` を flat 化するか、native/feval ラベルで区別表示するかは設計判断
- LizyML の `default_space()` は **conservative subset**（`gamma`/`poisson`/`tweedie`/`mape` 除外）を使う。Studio が user-facing UI で「全 valid choice」を出すか「tune-safe subset」を出すかは別判断（Wave 1.1 Proposal で確定推奨）

### Wave 4 — UX polish（Wave 2-3 と並行投入可能）

| # | 作業 | 並行性 |
|---|---|---|
| 4.1 | **#457 PR**（Residuals kind selector） | Wave 2/3 と完全独立 |

### Wave 5 — Test coverage（Wave 3 着地後、並行可能）

| # | 作業 | 束ね方 |
|---|---|---|
| 5.1 | **#443 #444 #447 #448 PR**（Inference e2e cluster） | 1 PR にまとめ（相互強化） |
| 5.2 | **#442 #445 #446 PR**（Jobs e2e cluster） | 1 PR にまとめ |
| 5.3 | **#449 #450 PR**（backend INV defense tests） | 1 PR にまとめ |

### Wave 6 — 技術負債 + 全体 reconcile（when bandwidth）

| # | 作業 | 注意 |
|---|---|---|
| 6.1 | **#456 PR**（stray-file 防止機構） | #454 #455 完了後 |
| 6.2 | **#403 PR**（metric-compat watchlist） | Wave 3 着地後 |
| 6.3 | **#452 PR**（5 関数の縮小） | low risk, opportunistic |
| 6.4 | **#451 PR series**（JobStore split, 5 sub-PR） | v0.5 R-1 完全着地後と明記、最後に |
| 6.5 | **#453 PR**（BLUEPRINT / architecture-as-implemented reconcile） | 全部終わった後の最終整合 |

**LizyML #148（v1.0 BREAKING）は v1.0 timing まで保留** — 本サイクルでは触らない。

**Wave 6 内の順序は bandwidth に応じて柔軟に**（Decision 5）。

---

## 4. 効率化テクニック

| 手法 | 適用箇所 | 節約量 |
|---|---|---|
| **1 つの Proposal P-XXXX に統合** | Wave 1.1 | 3 Proposal → 1（process overhead 1/3） |
| **BLUEPRINT 編集を Wave 2.1 か 2.2 にバンドル** | #458 #459 共通 | 1 PR で済む |
| **e2e 同テーマ束ね** | Wave 5.1 #443+#444+#447+#448 | 4 PR → 1（CI 4 周回避） |
| **chore quick wins を Wave 1 並走** | #454 #455 | 既存大きな作業の隙間で済ます |

---

## 5. 確実性ゲート

| Wave | Gate | 失敗時の対応 |
|---|---|---|
| 1.1 | Proposal の Decision 行は **未確定** で commit（P-XXXX status: draft） | 仕様変更があれば Proposal 自体を編集 |
| 1.2 | LizyML #152: 既存テスト全 green + new test 追加（low<high / log+low / clamp） | merge 前に green confirm |
| 2.x | 各 PR で `pnpm test` `pnpm test:e2e --grep workspace-tune` `uv run pytest` `pnpm check` `pnpm build` 全 green | 失敗→ branch protection blocks merge |
| 2.x | OpenAPI 型再生成 `pnpm generate:api` 実行（backend payload shape 変わるため） | tsc fail で検出 |
| 2.1 | `tuning.re_tune = null` vs `{ n_rounds: 1, ... }` の **後方互換テスト** 必須 | 既存保存 job 読み込み test（**Decision 2: 保存形式として許容、シム不要**） |
| 2.2 | `option_sets.objective.regression` から `cross_entropy` 除去 → 既存の対応 fixture を update | `tests/contract/test_ui_schema_matches_pydantic.py` で固定 |
| 3.1 | dep bump 後の **smoke test**（workspace-fit + workspace-tune） | 失敗→ revert lizyml pin |
| 5.x | e2e テスト追加時 quarantine marker 適切に運用 | flaky 化したら quarantine + 追跡 issue |

---

## 6. ユーザ承認済み Decision Points（2026-05-10 確定）

| # | 質問 | 決定 |
|---|---|---|
| **D1** | #458/#459/#460 の Proposal を 1 つにまとめるか別々か | **1 つに束ねる**（P-XXXX に統合） |
| **D2** | 既存保存 job の `tuning.re_tune = { n_rounds: 1, ... }` を API 受信時に正規化するか | **保存形式として許容**（シム不要、後方互換テストのみ） |
| **D3** | objective / metric master を LizyML SSOT 連動するか（旧: `[huber, mse, mae, quantile, mape]` に縮小） | **LizyML を正として連動** — ただし LizyML 現状に silent override バグあり、LizyML Issue [#159](https://github.com/nbx-liz/LizyML/issues/159) 起票済。修正版 release 後に Studio 連動 |
| **D4** | Wave 5 e2e 束ねを 4+3+2 = 3 PR にまとめてよいか | **3 PR にまとめで OK** |
| **D5** | Wave 6 順序（refactor #451/#452/#403 と docs reconcile #453 の優先順位） | **bandwidth に応じて柔軟に**（やりやすい順序） |
| **D6** | #460（Phase 1 hardcoded bounds）と #461（Phase 2 UiSchema 連動）をどう構成するか | **Option C（ハイブリッド）** — #460 を usability-only に縮小（NumberInput integer + inline 警告のみ）、bounds map は省略。#461 で UiSchema 直行 + dep bump |
| **D7** | model_metric も D3 スコープに入れるか | **入れる** — LizyML #159 の `metric_choices(task)` API 経由で連動。Phase 構成は #159 修正版 release 後の Studio Wave 3 に組み込む |

### D3 に関する事前確認結果（2026-05-10 実施済み）

LizyML `lizyml/estimators/lgbm/defaults.py` の現状確認:

```python
_OBJECTIVE_CHOICES: dict[str, tuple[str, ...]] = {
    "regression": ("huber", "fair"),    # ← LizyML default-space 用、LightGBM が許容する範囲はこれより広い
    "binary": ("binary",),
    "multiclass": ("multiclass", "multiclassova"),
}

_TASK_METRIC: dict[str, list[str]] = {
    "regression": ["huber", "mae", "mape"],
    "binary": ["auc", "binary_logloss"],
    "multiclass": ["auc_mu", "multi_logloss"],
}
```

**結果:** LizyML は新メトリクス追加していない。むしろ Studio より少ない。

### D3 / D7 後続調査結果（2026-05-10 同日、LizyML #159 起票）

LizyML 実装を慎重に再確認した結果、**Silent override バグ**を発見:

1. `_OBJECTIVE_CHOICES` は LightGBM 全 objective enum より大幅に狭い:
   - regression: 9 中 2 のみ（`huber`, `fair`）。LightGBM は `regression`, `regression_l1`, `huber`, `fair`, `poisson`, `quantile`, `mape`, `gamma`, `tweedie` をサポート
   - binary: 3 中 1 のみ（`binary`）。LightGBM は `binary`, `cross_entropy`, `cross_entropy_lambda`
   - multiclass: 完備（`multiclass`, `multiclassova` ※softmax は alias）
2. **`LGBMAdapter._build_params()` (adapter.py:378) が user/trial-supplied `objective` を unconditional に pop**。タスク内の合法な objective も上書きされる
3. 結果として tune trials が `fair` をサンプルしても実際には `huber` で学習（silent failure、tuning_table が嘘を表示）
4. `metric` 側は同じ問題なし（`metric_bridge.resolve_metrics()` が正しく合成）
5. ただし `metric` API も private（`_LGBM_NATIVE_METRICS` / `_FEVAL_METRICS`）で Studio から import 不可

**LizyML Issue #159 起票:** `feat(estimators): expose objective_choices() / metric_choices() via EstimatorProvider; fix silent objective override`

- **Part 1**: silent strip 修正（task-incompatible のみ拒否）
- **Part 2**: `EstimatorProvider.objective_choices(task) -> tuple[str, ...]` 追加
- **Part 3**: `EstimatorProvider.metric_choices(task) -> dict[Literal["native", "feval"], tuple[str, ...]]` 追加（dict 戻りで native vs feval を区別）
- **Part 4**: 内部の private dict を新 API 経由にリファクタ
- **再発防止 7 層**: parametric end-to-end identity / tune-fit identity / provider drift smoke / registry coverage / runtime assertion / CHANGELOG / config-reference docs

### Studio 連動方針（D3 / D7 統合 — LizyML #159 修正後に着手）

| 段階 | LizyML 状態 | Studio 側挙動 |
|---|---|---|
| **暫定**（#159 修正前） | v0.14.0 のまま | Studio Wave 2.2 で `option_sets.objective` を **LightGBM 全 enum** に揃える（LightGBM 直の正本、LizyML が修正されればそのまま通る）。`option_sets.metric` / `model_metric` は現状維持 |
| **本連動**（#159 修正後） | v0.15+ release | Studio Wave 3 (#461) で `EstimatorProvider.objective_choices()` / `metric_choices()` を UiSchema 経由で読む。Studio の hardcoded master 削除 |
| **Drift 検出**（恒久化） | — | `tests/contract/test_lizyml_objective_metric_drift.py` で Studio master と LizyML SSOT の同期を CI で固定 |

---

## 7. 概算スケジュール

| Wave | 内容 | 所要 PR 数 | 期間目安 |
|---|---|---|---|
| 1 | 基盤（Proposal + LizyML #152 + chore quick wins） | 4 | 3-5 日 |
| 2 | Tune workflow 直列実装 | 4 | 5-7 日 |
| 3 | LizyML 統合 | 1 | 1-2 日 |
| 4 | Residuals UX | 1 | 1 日 |
| 5 | Test coverage 束ね | 3 | 3-4 日 |
| 6 | 技術負債 + reconcile | 5+ | 1 週以上、bandwidth 次第 |

**全 23 Issue を約 18 PR で消化、Wave 1-3 で user-facing 改善が完結（約 2-3 週間）**。
Wave 4-6 は技術負債で、別タイミング着手可能。

---

## 8. 着手チェックリスト（次セッションで使う）

着手前に確認すべき項目:

- [ ] 本ドキュメントの D1–D7 の決定が依然有効か再確認（特に D6=Option C / D7=LizyML SSOT 連動）
- [ ] 既存 Issue 状態の最終確認:
  - LizyML #152 → CLOSED（v0.13/v0.14 出荷）
  - LizyML #159 → CLOSED（v0.15.0 出荷、2026-05-10 PM）
  - Studio #457–#461 が依然 open であることを確認
- [ ] 別 Issue が新規発生していないか確認（`gh issue list --state open` 全件再取得）
- [ ] 開発環境セットアップ: `uv sync` / `cd frontend && pnpm install`
- [ ] develop ブランチの最新化: `git fetch && git checkout develop && git pull`
- [ ] LizyML v0.15.0 が PyPI で利用可能か確認（`pip index versions lizyml` または `uv pip install lizyml==0.15.0` のドライラン）

着手順:

1. **Wave 1.1** から始める — Proposal P-XXXX を `HISTORY.md` に起票（branch: `feat/proposal-tune-workflow-overhaul`）
   - 含める scope: Tune defaults canonical spec / Re-tune Switch UX / validation guardrails / **LizyML v0.15 SSOT 連動方針**（objective_choices / metric_choices / parameter_bounds の UiSchema 経由読み取り）/ multiclass `auc` 除去
2. **Wave 1.2** dep bump PR — `>=0.15.0,<0.16.0` へ直接 jump（v0.13/v0.14 経由不要）
3. Wave 1.3/1.4 chore PRs を Wave 1.1/1.2 と並行投入
4. Wave 2 へ進む（#458 → #459 → #460 D6=Option C usability-only）
5. Wave 3 へ進む（#461 拡張版 = UiSchema 3-API 統合 + multiclass `auc` 除去）

**Wave 1.2 dep bump 時の注意:**
- LizyML v0.15.0 は **behaviour change** あり: `LGBMConfig.params["objective"]` が同 task 互換値で実効化される（pre-0.15 は silent strip）
- 既存の Studio fit/tune fixture / e2e snapshot で `objective` を非デフォルトにしているケースがあれば挙動が変わる可能性
- v0.15.0 CHANGELOG の "Changed (potentially breaking)" 項を必読: https://github.com/nbx-liz/LizyML/blob/main/CHANGELOG.md

---

## 9. 関連リンク

- [BLUEPRINT.md §4.2.2](../BLUEPRINT.md) — Tune Tab UI 設計
- [HISTORY.md](../HISTORY.md) — 過去の Proposal / Decision
- [ROADMAP.md](./ROADMAP.md) — Tier 0–5 のドキュメント役割マップ
- [CLAUDE.md §2 change-gate](../CLAUDE.md) — 仕様変更 Proposal の必須項目
- Issue #457 — Residuals kind selector
- Issue #458 — Re-tune Switch UX + BLUEPRINT range table stale
- Issue #459 — Tune defaults canonical spec（3 task + Fit seed + inner_valid picker）
- Issue #460 — validation Phase 1（Studio UI guardrails）
- Issue #461 — validation Phase 2（UiSchema 統合）
- LizyML Issue #152 — parameter_bounds + parse_space + expand_dims clamping
