# LizyStudio ROADMAP

このドキュメントは **「今アクティブな作業」と「未着手のバックログ」を 1 ページで俯瞰** するためのインデックスです。

- 仕様の正は依然として `BLUEPRINT.md` / `HISTORY.md` / `PLAN.md`。
- このファイルは **横串インデックス** であり、詳細はリンク先で確認すること。
- 着手する際は HISTORY に Proposal を起票（変更ゲート対象の場合）→ PLAN にフェーズ追加 → 実装、の順で進める。

最終更新: 2026-04-30

---

## 0. ナンバリング体系の Glossary

過去のリファクタリングごとに別系統の ID が乱立しているため、最初にマッピングを示す。

| 系統 | 由来 | 例 | 現状 |
|---|---|---|---|
| `v1` / `v2-N` / `v3-N` | `PLAN.md` のフェーズ番号（プロジェクト全体の時系列） | `v3-12` | **進行中の正規 ID**。新規着手は `v3-13` 以降を採番 |
| `H-00XX` | HISTORY.md の旧 Proposal 番号（H-0017..H-0085） | `H-0085` | 採番終了。引き続き参照 ID として有効 |
| `P-00XX` | HISTORY.md の現行 Proposal 番号（P-0086 から） | `P-0092` | **進行中の正規 ID**。新規 Proposal は `P-0093` 以降 |
| Coupling `A-N` / `B-N` / `C-N` | `docs/coupling-analysis.md` のリファクタ系列 | `B-7`, `C-9` | **完了** (2026-04-22)。歴史参照のみ |
| GUI E2E `Phase A.1〜A.7`, `B-1..B-8`, `C`, `D-1..D-5` | `docs/gui-e2e-plan.md` の E2E 計画 | `B-4`, `D-3` | **進行中**。本文書 §3 で実装状況を追跡 |
| `G-1..G-8`, `H-1..H-4` | 2026-04-30 develop ブランチの code-review 監査で付けた gap/highlight ID | `G-3`, `H-2` | **完了** (PR #300, #303, #306..#310)。歴史参照のみ |
| `INV-N` | 個別 Proposal 内の invariant ID | `INV-A1` | Proposal 内ローカル ID |

> **判断ルール**: 仕様変更を伴う作業は P-XXXX を起票し、PLAN.md にフェーズ（`v3-N`）を追加する。E2E 単独追加は B-N / D-N で運用継続。

---

## 1. 直近完了（参考）

新規着手の前に、直近完了した大きな塊を把握しておく：

| 完了日 | ID | タイトル | 主要 PR |
|---|---|---|---|
| 2026-04-30 | **P-0092** | ConfigForm cross-hook write funnel（6 phase） | #290〜#295, #289（B-3 spec） |
| 2026-04-30 | P-0092 follow-up | H-1〜H-4 / G-1〜G-8 / Issue #298 修正 | #300, #303, #306〜#310 |
| 2026-04-22 | Coupling refactor A+B+C | 26 項目（API queries/Job lineage/format_version 等） | 多数。`docs/coupling-analysis.md:11` |
| 2026-04-28 | P-0091 | FW editor の `nonExcludedColumns` から target/excluded を除外（#277） | #287 |
| 2026-04-28 | P-0090 | cross-hook 競合書き込みの構造的解消（#278 残課題） | #286 |
| 2026-04-28 | P-0089 | running lock：実行中の `PUT /config` を 409 で保護（#279） | #282 |
| 2026-04-26 | P-0088 | `/status` に `files_root` 追加 + E2E globalSetup 検証（#256/#257 Phase 2） | #261 |
| 2026-04-26 | P-0087 Phase 1+2 | UI schema ↔ Pydantic drift contract test（#258/#259） | #260, #262〜#264 |
| 2026-04-25 | P-0086 | `/fit`/`/tune` に optional `config` body 受入 | #252 |

---

## 2. アクティブ：仕様変更を伴う Proposal

### 2.1 P-0087 Phase 3：`cv_strategy_fields` を Pydantic から自動派生

- **状態**: 🟡 未着手（HISTORY.md:2418 で「Phase 3 PR で別途検討」と記載）
- **動機**: 現在 `lizystudio/backends/lizyml_ui_schema.py` で hand-coded。lizyml 側の Pydantic model から生成すれば drift が原理的に消える
- **ブロッカー**: lizyml 側に構造化フィールドメタデータの export を頼む必要あり（リポジトリ間調整）
- **優先度**: 中（P-0087 Phase 1+2 で contract test が drift を検出可能なので、緊急ではないが残課題）
- **着手手順**: HISTORY に P-0093 として Proposal 起票 → lizyml 側調整 → PLAN.md に `v3-13` として登録 → 実装

### 2.2 ML Backend 抽象の 2nd 実装による検証

- **状態**: 🟡 未着手（`docs/coupling-analysis.md:283` に flag、Issue 未起票）
- **動機**: A-1〜A-6 で `BackendAdapter` Protocol を整備したが、実装が lizyml 1 件のみ。第 2 実装で抽象の妥当性を検証したい
- **ブロッカー**: 第 2 backend の選定が未決（候補: scikit-learn `Pipeline` 直接 / `xgboost` Native API / 他）
- **優先度**: 低〜中（戦略タスク、次の四半期で計画したい）

---

## 3. アクティブ：GUI E2E カバレッジ強化（gui-e2e-plan.md Phase D）

`docs/gui-e2e-plan.md` の段階実装プラン。**Phase A の Config field × E2E カバレッジは現状約 18%（7/40）**。Phase C generator が完成すれば一気に解消する。

### 3.1 Phase B 残：個別 spec の追加

| ID | spec | 状態 | 規模 | ROI |
|---|---|---|---|---|
| **B-1** | `jobs-ui.spec.ts` — Jobs ページの click/フィルタ/Export ダイアログ/Delete 確認/Cancel | ❌ 未着手（既存 `jobs-flow.spec.ts` は API のみ） | 中 | 高 |
| **B-2** | `inference-flow.spec.ts` 拡張 — History クリックで結果切替 | ❌ 既存 spec に未追加 | 小 | 中 |
| **B-3** | `workspace-cv.spec.ts` — 7 strategy 巡回 | ✅ 完了（PR #289） | — | — |
| **B-3b** | BlockedGroupKFold エディタ専用 spec | ❌ 未着手（B-3 が deferred） | 中 | 中 |
| **B-4** | `workspace-feature-weights.spec.ts` — FW エディタ操作 | ❌ 未着手（unit only、リグレッションリスク高） | 小 | **最高** |
| **B-5** | `workspace-columns.spec.ts` — Excl/Type 操作 | ❌ 未着手（`features.exclude` / `features.categorical` 無 E2E） | 小 | 高 |
| **B-6** | `workspace-presets.spec.ts` — Preset Load → form 反映 | ⚠️ Save のみ既存（`workspace-model-panel.spec.ts:101`）、Load 反映未 assertion | 小 | 中 |
| **B-7** | `workspace-running-lock.spec.ts` — running lock UI mapping | ✅ 完了（PR #300） | — | — |
| **B-8** | `workspace-mobile.spec.ts` — bottom-tab traversal | ❌ 未着手（Issue #304 と連動） | 中 | 低〜中 |

### 3.2 Phase C: Config-reflection invariant generator

| 項目 | 状態 |
|---|---|
| Helper（`tests/e2e/helpers/config-reflection.ts`） | ✅ 既存（206 行、PR #288） |
| Sample spec（`split.n_splits` のみ） | ✅ 既存 |
| Fixture data（`tests/e2e/fixtures/config-fields.ts`） | ❌ 未作成 |
| 32+ フィールドの自動 loop | ❌ 未着手 |

着手すれば B-4/B-5/B-6 の一部を fixture 行追加だけで済ませられるため、**B-N より先に Phase C 起動を狙う方が ROI が高い可能性あり**。

### 3.3 Phase D 段階プラン進捗

| Phase | 内容 | 状態 |
|---|---|---|
| D-1 | Phase A helper + sample 1 件 | ✅ 完了（#288） |
| D-2 | B-1（Jobs UI） + B-3（CV strategy） | 🟡 B-3 のみ完了。**B-1 未着手** |
| D-3 | B-2 / B-4 / B-5 / B-6 | ❌ 全て未着手 |
| D-4 | B-7 + B-8 | 🟡 B-7 完了。**B-8 未着手** |
| D-5 | Phase C generator 起動 + 全フィールド loop | ❌ 未着手 |

---

## 4. アクティブ：Open Issues

| Issue | タイトル | priority | 推奨アクション |
|---|---|---|---|
| **#27** | [Testing] Add load and concurrency tests | medium / tier-4 | (a) `pytest-benchmark` 100k-row microbench を tier-3 で先行マージ可 / (b) 並行 fit stress harness は tier-4 |
| **#28** | [Testing] Add offline/resume resilience tests | medium / tier-4 | `current_job_id` ライフサイクル契約決定が前提。post-completion deep-link は #143 でカバー済み、during-run reload が gap |
| **#125** | chore(frontend): migrate Tailwind CSS v3 → v4 | medium / tier-4 | Owner status: `Button` で spike → 専用 sprint。即着手は推奨しない |
| **#298** | Inner Validation user-driven path（H-2） | — | ✅ 完了（PR #308 でクローズ済み） |
| **#304** | track skipped tests（DataPanel jsdom + mobile E2E） | low | DataPanel の 2 件と mobile 6 件を分割対応。Mobile 側は B-8 と一体で処理可 |

---

## 5. ドキュメントドリフト（要メンテナンス）

| 対象 | 最終更新 | リスク | 対応 |
|---|---|---|---|
| `docs/architecture.md` / `api.md` / `adapter-guide.md` | 2026-04-10 | services/training/jobs が 18 commits/each で refactor された期間中に未更新。Adapter 契約の記載が古い可能性 | 棚卸しタスクとして別 PR で着手 |
| `PLAN.md` | v3-12 で停止 | P-0086〜P-0092 ＋ Phase D が反映されていない | **本 PR で v3-13 を追加** |
| `HISTORY.md` P-0092 | Decision 後の H-1〜H-4 / G-1〜G-8 / Issue #298 fix が無記載 | 「Closes §P-0092」と実態の齟齬 | **本 PR で follow-up セクションを追記** |
| `MEMORY.md` 古いノート | `project_coupling_refactor_progress` が「C-6/C-9/B-9-Part2 残り」と誤情報 | Claude が誤前提で計画する | **本 PR で更新** |
| `analysis/` 削除済み | 2026-04 期間 | `python-analyst` ↔ `lizystudio-analyst` パイプライン成果物の置き場が無い | 意図的削除か要確認、別 issue 検討 |

---

## 6. 推奨 Next Action（ROI 順 / 1 PR 単位）

### Tier 0：即効・低リスク

1. **本 PR**：本 ROADMAP + PLAN/HISTORY/MEMORY ドリフト是正
2. **Issue #304 DataPanel 分**：jsdom skip 2 件を再挑戦 or 削除

### Tier 1：高 ROI E2E 強化

3. **B-4** Feature Weights editor spec — 最高 ROI、リグレッション死角解消
4. **B-5** Column Settings spec — Phase A の `features.exclude`/`features.categorical` 同時カバー
5. **B-1** Jobs UI spec — UI 全面ノーカバー領域の埋め
6. **B-6** Preset Load reflection — 既存 spec に Load 反映 assertion 追加

### Tier 2：構造的改善

7. **Phase C generator 起動** — fixture loop で 5〜10 フィールド一気に追加
8. **B-8 mobile spec + Issue #304 完全クローズ**

### Tier 3：戦略課題

9. `docs/architecture.md` 等のドリフト是正棚卸し
10. **P-0093** として P-0087 Phase 3 を Proposal 化（lizyml 側調整）
11. **#28** offline/resume：`current_job_id` ライフサイクル契約決め
12. **#27** (a) pytest-benchmark microbench

### Tier 4：要長期計画

13. **#125** Tailwind v4 — Button spike → 専用 sprint
14. ML Backend 2nd 実装による Adapter 抽象検証

---

## 7. 運用メモ

- 新規 Proposal を起票するときは **P-0093 から採番**。`H-XXXX` 採番は終了。
- E2E 単独追加（仕様変更なし）は HISTORY 起票不要、本 ROADMAP の §3 を更新するだけで OK。
- 本 ROADMAP はステータス変更時に都度更新。タスク完了時は §1 へ移動、新規着手時は §2/§3/§4 へ追加する。
- 古い ID（B-N coupling、A.M Phase A など）は履歴参照のためそのまま残す。検索性のため改名はしない。
