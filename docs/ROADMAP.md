# LizyStudio ROADMAP

このドキュメントは **「今アクティブな作業」と「未着手のバックログ」を 1 ページで俯瞰** するためのインデックスです。

- 仕様の正は依然として `BLUEPRINT.md` / `HISTORY.md` / `PLAN.md`。
- このファイルは **横串インデックス** であり、詳細はリンク先で確認すること。
- 着手する際は HISTORY に Proposal を起票（変更ゲート対象の場合）→ PLAN にフェーズ追加 → 実装、の順で進める。

最終更新: 2026-05-01（P-0093 WS terminal-replay 起票 + Phase C wave 1〜8 完了：22/40+ field カバー）

---

## 0. ドキュメント役割分担マップ

プロジェクト内のすべての markdown を Tier 構造で整理する。**新規ドキュメントを追加するときは、本セクションを最初に更新する**。

### Tier 1: 仕様の正（CLAUDE.md §1 で priority order が定義済）

| ドキュメント | 役割 | 採番系統 | 更新トリガー |
|---|---|---|---|
| `BLUEPRINT.md` | 設計意図 (WHAT)。構造・責務・画面定義・API・Adapter | — | 仕様変更時（Proposal の Decision 後） |
| `HISTORY.md` | Proposal → Decision の通時記録 (WHY) | `H-00XX` (旧) / `P-00XX` (新) | Proposal 起票時 + Decision 確定時 |
| `PLAN.md` | フェーズ別実装ロードマップ (WHEN) | `v1` / `v2-N` / `v3-N` | フェーズ着手時 + 完了時 |
| `CLAUDE.md` | Claude の working rules + tech stack 制約 (HOW) | — | ルール変更時 |

### Tier 2: アクティブ運用（横串 INDEX）

| ドキュメント | 役割 | 更新トリガー |
|---|---|---|
| `docs/ROADMAP.md` | 残課題のバックログ・Next Action ROI ランキング・命名 Glossary・本ドキュメント役割マップ | 課題着手時／完了時／新規ドキュメント追加時 |

### Tier 3: リファレンス（read-mostly、現役）

| ドキュメント | 役割 | 最終更新 | 関係 |
|---|---|---|---|
| `docs/architecture.md` | 入門レベルの architecture overview。BLUEPRINT §3 へのゲートウェイ | 2026-04-10 | 内容は BLUEPRINT 派生 |
| `docs/architecture-as-implemented.md` | 実装の現状 snapshot（BLUEPRINT は意図、こちらは現実） | 2026-04-17 | BLUEPRINT との対比で読む |
| `docs/api.md` | REST API リファレンス。BLUEPRINT §5 へのゲートウェイ | 2026-04-10 | 内容は BLUEPRINT 派生 |
| `docs/adapter-guide.md` | BackendAdapter Protocol 実装手順 | 2026-04-10 | BLUEPRINT §6 (Adapter 設計) と対 |

> **Tier 3 のドキュメントは BLUEPRINT.md からの派生であり、BLUEPRINT が真。drift が見つかったら BLUEPRINT 側を真として Tier 3 を更新する。**

### Tier 4: アクティブな個別計画

仕様変更（Proposal）には届かないが、複数 PR をまたいで実装する計画は個別ドキュメントを起こす。

| ドキュメント | 役割 | ステータス | 進捗追跡 |
|---|---|---|---|
| `docs/gui-e2e-plan.md` | GUI E2E Phase A/B/C/D 計画 | 🟡 進行中（Phase D 残り B-1/B-2/B-4/B-5/B-6/B-8 + Phase C generator） | 本 ROADMAP §4 |

### Tier 5: アーカイブ（完了済み・参照のみ）

完了したらヘッダに `**Status**: ✅ shipped <YYYY-MM-DD>` を付けて Tier 5 へ。**ファイル移動はしない**（検索可能性のため）。

| ドキュメント | 内容 | クローズ日 |
|---|---|---|
| `docs/coupling-analysis.md` | A-1..A-10 / B-1..B-10 / C-1..C-12 の疎結合化計画 | 2026-04-22 |
| `docs/c6-openapi-fetch-plan.md` | C-6（openapi-fetch 導入）の実装計画 | 2026-04-22 |
| `docs/ui-config-sync-audit-2026-04.md` | Issue #249 起点の Workspace form config-sync 監査 | 2026-04-23 |

### Project Chrome（外部向け）

| ドキュメント | 役割 |
|---|---|
| `README.md` | PyPI / install / quick-start。end users 向けランディング |
| `CONTRIBUTING.md` | 貢献ワークフロー + 品質ゲート |
| `CHANGELOG.md` | リリースノート（Keep a Changelog 形式） |
| `SECURITY.md` | セキュリティポリシー |
| `frontend/README.md` | Frontend dev startup |
| `.claude/AGENTS.md` | エージェント orchestration ガイド |

### 運用ルール

1. **新規 Tier 4 ドキュメント追加時** — `docs/<topic>-plan.md` で起こし、本表 Tier 4 行を追加、ROADMAP §4〜§6 へリンク登録。
2. **完了通知（Tier 4 → Tier 5）** — `**Status**: ✅ shipped <YYYY-MM-DD>` をドキュメント先頭に付与し、本表で行を Tier 4 → Tier 5 へ移す。
3. **Tier 3 が drift していると分かったとき** — BLUEPRINT が真。Tier 3 を BLUEPRINT に追従させる。逆にしない。
4. **memory ノートの位置付け** — `~/.claude/projects/-home-rem-repos-LizyStudio/memory/` は Claude の point-in-time observations。仕様の正ではない。drift が見つかれば memory を更新するか削除する。
5. **どこにも該当しない雑文** — 書かない。Issue / PR description / `docs/<topic>-plan.md` のいずれかに納める。

---

## 1. ナンバリング体系の Glossary

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

## 2. 直近完了（参考）

新規着手の前に、直近完了した大きな塊を把握しておく：

| 完了日 | ID | タイトル | 主要 PR |
|---|---|---|---|
| 2026-05-01 | P-0093 (impl) | WebSocket terminal-replay（Issue #327） | branch `fix/issue-327-ws-terminal-replay` (PR 作成待ち) |
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

## 3. アクティブ：仕様変更を伴う Proposal

### 3.0 P-0093：WebSocket terminal-message replay for late subscribers（Issue #327）

- **状態**: 🟢 実装完了（PR レビュー待ち）— branch `fix/issue-327-ws-terminal-replay`
- **動機**: 高速 Fit (< 3 秒) で `ProgressBroadcaster.send()` が subscribe 前 message を破棄。UI の terminal-detection が 2〜4 秒遅延し、運用ログでユーザーが再 Fit する行動が観測された
- **対象 Issue**: #327（同根の副症状 #328 は別 PR で対応）
- **PLAN フェーズ**: v3-15（PLAN.md 参照）
- **invariant test**: `tests/test_progress.py::TestTerminalReplay` 7 ケース
- **次アクション**: PR 作成 → CI 全 green → develop マージ

### 3.1 P-0087 Phase 3：`cv_strategy_fields` を Pydantic から自動派生

- **状態**: 🟡 未着手（HISTORY.md:2418 で「Phase 3 PR で別途検討」と記載）
- **動機**: 現在 `lizystudio/backends/lizyml_ui_schema.py` で hand-coded。lizyml 側の Pydantic model から生成すれば drift が原理的に消える
- **ブロッカー**: lizyml 側に構造化フィールドメタデータの export を頼む必要あり（リポジトリ間調整）
- **優先度**: 中（P-0087 Phase 1+2 で contract test が drift を検出可能なので、緊急ではないが残課題）
- **着手手順**: HISTORY に P-0093 として Proposal 起票 → lizyml 側調整 → PLAN.md に `v3-13` として登録 → 実装

### 3.2 ML Backend 抽象の 2nd 実装による検証

- **状態**: 🟡 未着手（`docs/coupling-analysis.md:283` に flag、Issue 未起票）
- **動機**: A-1〜A-6 で `BackendAdapter` Protocol を整備したが、実装が lizyml 1 件のみ。第 2 実装で抽象の妥当性を検証したい
- **ブロッカー**: 第 2 backend の選定が未決（候補: scikit-learn `Pipeline` 直接 / `xgboost` Native API / 他）
- **優先度**: 低〜中（戦略タスク、次の四半期で計画したい）

---

## 4. アクティブ：GUI E2E カバレッジ強化（gui-e2e-plan.md Phase D）

`docs/gui-e2e-plan.md` の段階実装プラン。**Phase A の Config field × E2E カバレッジは現状約 55%（22/40）**。Phase C generator + wave 1〜8 で大幅進捗、残りは UI 露出無し / 隠しフィールド / 複合 UI のため §4.2 末尾「カバー困難」表に分類。

### 4.1 Phase B 残：個別 spec の追加

| ID | spec | 状態 | 規模 | ROI |
|---|---|---|---|---|
| **B-1** | `jobs-ui.spec.ts` — Jobs ページの click/フィルタ/Export ダイアログ/Delete 確認/Cancel | ✅ 完了（PR #316） | 中 | — |
| **B-2** | `inference-flow.spec.ts` 拡張 — History クリックで結果切替 | ✅ 完了（PR #315） | 小 | — |
| **B-3** | `workspace-cv.spec.ts` — 7 strategy 巡回 | ✅ 完了（PR #289） | — | — |
| **B-3b** | BlockedGroupKFold エディタ専用 spec | 🔴 deferred — UI 経由で blocked_group_kfold へ切替えると discriminated union が partial wire body を 422 で拒否し、cache reconcile が cv.strategy を revert する funnel ループを踏む。Component test で代替（`BlockedGroupKFoldEditor.component.test.tsx`） | 中 | 中 |
| **B-4** | `workspace-feature-weights.spec.ts` — FW エディタ操作 | ✅ 完了（PR #312） | 小 | — |
| **B-5** | `workspace-columns.spec.ts` — Excl/Type 操作 | ✅ 完了（PR #313） | 小 | — |
| **B-6** | `workspace-presets.spec.ts` — Preset Load → form 反映 | ✅ 完了（PR #314） | 小 | — |
| **B-7** | `workspace-running-lock.spec.ts` — running lock UI mapping | ✅ 完了（PR #300） | — | — |
| **B-8** | `workspace-mobile.spec.ts` — bottom-tab traversal | ✅ 完了（PR #318） | 中 | — |

### 4.2 Phase C: Config-reflection invariant generator

| 項目 | 状態 |
|---|---|
| Helper（`tests/e2e/helpers/config-reflection.ts`） | ✅ 既存（PR #288 / #320 で testValue 厳格化 / #325 で waitForConfigSettle 移行） |
| Sample spec（`split.n_splits` のみ） | ✅ 既存 |
| Fixture data（`tests/e2e/fixtures/config-fields.ts`） | ✅ 完了（PR #317） |
| Generator spec（`workspace-config-fields-loop.spec.ts`） | ✅ 完了（PR #317） |
| Phase A field 自動 loop | 🟢 **22 / 40+ field（≈55%）カバー済**。wave 1〜8 完了（PR #317 / #319 / #320 / #321 / #322 / #323 / #324 / #325） |

#### Phase C 着手済み fixture（22 field）

| Section | Field | Wave | PR |
|---|---|---|---|
| `data` | `data.path` / `data.target` / `data.task` | （既存 spec） | — |
| `data` | `data.group_col` / `data.time_col` | wave 8 | #325 |
| `features` | `features.exclude` / `features.categorical` | （B-5 spec） | #313 |
| `split` | `split.method` (7 strategy) | （B-3 spec） | #289 |
| `split` | `split.n_splits` / `split.random_state` | wave 1 / wave 4 | #317 / #321 |
| `split` | `split.shuffle` / `split.gap` / `split.purge_gap` / `split.embargo` | wave 5 / wave 6 | #322 / #323 |
| `split` | `split.train_size_max` / `split.test_size_max` | wave 7 | #324 |
| `model` | `model.balanced` / `model.feature_weights` | wave 1 / B-4 | #317 / #312 |
| `model` | `model.auto_num_leaves` / `model.num_leaves_ratio` | wave 3 | #320 |
| `model` | `model.min_data_in_leaf_ratio` / `model.min_data_in_bin_ratio` | wave 3 | #320 |
| `training` | `training.seed` / `training.early_stopping.rounds` | wave 2 | #319 |
| `training` | `training.early_stopping.enabled` | wave 3 | #320 |
| `tuning` | `tuning.optuna.params.direction` (metric chips) | （既存 spec） | — |
| `tuning` | `tuning.optuna.params.n_trials` | wave 4 | #321 |
| `tuning` | `tuning.optuna.params.timeout` | wave 5 | #322 |
| `tuning` | `tuning.optuna.space.kind` | （既存 spec） | — |
| `calibration` | `calibration` enable | （既存 spec） | — |
| `calibration` | `calibration.method` / `calibration.n_splits` | wave 7 | #324 |

#### Phase C 残（カバー困難または対象外）

| Field | 状態 | 理由 |
|---|---|---|
| `features.auto_categorical` | UI 露出なし | 常に true、コントロール無し |
| `split.min_train_rows` / `split.min_valid_rows` | UI/wire 不一致 | 全 strategy で UI 表示するが `active.includes` フィルタで wire 出力されるのは blocked_group_kfold のみ。B-3b 経由が必要 |
| `split.blocks.*` / `split.groups.*` | 🔴 deferred | B-3b funnel state 問題 |
| `model.params` (KeyValueEditor) | unit のみ | 動的キーの dict、wave loop に乗らない |
| `training.early_stopping.inner_valid.*` | GLOBALLY_HIDDEN | field-renderers.tsx:22 で常時非表示 |
| `training.early_stopping.validation_ratio` | GLOBALLY_HIDDEN | 同上 |
| `tuning.optuna.space.{range,choices,fixed}` | 複合 UI | param-by-param で kind 切替 + value editor。専用 spec 候補 |
| `evaluation.metrics` | UI 露出なし | Tune タブの metric chips が一部担当（既存カバー） |

### 4.3 Phase D 段階プラン進捗

| Phase | 内容 | 状態 |
|---|---|---|
| D-1 | Phase A helper + sample 1 件 | ✅ 完了（#288） |
| D-2 | B-1（Jobs UI） + B-3（CV strategy） | ✅ 完了（B-3 #289 / B-1 #316） |
| D-3 | B-2 / B-4 / B-5 / B-6 | ✅ 完了（#315 / #312 / #313 / #314） |
| D-4 | B-7 + B-8 | ✅ 完了（#300 / #318） |
| D-5 | Phase C generator 起動 + 全フィールド loop | 🟢 generator + 22 field 完了（#317〜#325）。残課題は §4.2「カバー困難」表に記載 |

---

## 5. アクティブ：Open Issues

| Issue | タイトル | priority | 推奨アクション |
|---|---|---|---|
| **#327** | WebSocket "completed" race — results not visible after fast Fit | **high** | 🟢 実装完了。PR 作成 → CI green 待ち（branch `fix/issue-327-ws-terminal-replay`、P-0093 / v3-15） |
| **#328** | execution.log empty — subprocess stdout discarded | medium | 🟢 実装完了（branch `fix/issue-328-execution-log-redirect`）。`subprocess_runner.py` で stdout/stderr を `execution.log` にリダイレクト + 10 MiB head-drop cap + `_StderrDrainer` 退役 |
| **#27** | [Testing] Add load and concurrency tests | medium / tier-4 | (a) `pytest-benchmark` 100k-row microbench を tier-3 で先行マージ可 / (b) 並行 fit stress harness は tier-4 |
| **#28** | [Testing] Add offline/resume resilience tests | medium / tier-4 | `current_job_id` ライフサイクル契約決定が前提。post-completion deep-link は #143 でカバー済み、during-run reload が gap |
| **#125** | chore(frontend): migrate Tailwind CSS v3 → v4 | medium / tier-4 | Owner status: `Button` で spike → 専用 sprint。即着手は推奨しない |
| **#298** | Inner Validation user-driven path（H-2） | — | ✅ 完了（PR #308 でクローズ済み） |
| **#304** | track skipped tests（DataPanel jsdom + mobile E2E） | low | Mobile 6 件は B-8（PR #318）でクローズ済。DataPanel 2 件は jsdom + Radix Select の制約のため別 PR で対応 |

---

## 6. ドキュメントドリフト（要メンテナンス）

| 対象 | 最終更新 | リスク | 対応 |
|---|---|---|---|
| `docs/architecture.md` / `api.md` / `adapter-guide.md` | 2026-04-10 | services/training/jobs が 18 commits/each で refactor された期間中に未更新。Adapter 契約の記載が古い可能性 | 棚卸しタスクとして別 PR で着手 |
| `PLAN.md` | v3-12 で停止 | P-0086〜P-0092 ＋ Phase D が反映されていない | **本 PR で v3-13 を追加** |
| `HISTORY.md` P-0092 | Decision 後の H-1〜H-4 / G-1〜G-8 / Issue #298 fix が無記載 | 「Closes §P-0092」と実態の齟齬 | **本 PR で follow-up セクションを追記** |
| `MEMORY.md` 古いノート | `project_coupling_refactor_progress` が「C-6/C-9/B-9-Part2 残り」と誤情報 | Claude が誤前提で計画する | **本 PR で更新** |
| `analysis/` 削除済み | 2026-04 期間 | `python-analyst` ↔ `lizystudio-analyst` パイプライン成果物の置き場が無い | 意図的削除か要確認、別 issue 検討 |

---

## 7. 推奨 Next Action（ROI 順 / 1 PR 単位）

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

## 8. 運用メモ

- 新規 Proposal を起票するときは **P-0093 から採番**。`H-XXXX` 採番は終了。
- E2E 単独追加（仕様変更なし）は HISTORY 起票不要、本 ROADMAP の §3 を更新するだけで OK。
- 本 ROADMAP はステータス変更時に都度更新。タスク完了時は §1 へ移動、新規着手時は §2/§3/§4 へ追加する。
- 古い ID（B-N coupling、A.M Phase A など）は履歴参照のためそのまま残す。検索性のため改名はしない。
