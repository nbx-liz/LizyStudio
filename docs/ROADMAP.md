# LizyStudio ROADMAP

このドキュメントは **「今アクティブな作業」と「未着手のバックログ」を 1 ページで俯瞰** するためのインデックスです。

- 仕様の正は依然として `BLUEPRINT.md` / `HISTORY.md` / `PLAN.md`。
- このファイルは **横串インデックス** であり、詳細はリンク先で確認すること。
- 着手する際は HISTORY に Proposal を起票（変更ゲート対象の場合）→ PLAN にフェーズ追加 → 実装、の順で進める。

最終更新: 2026-05-13（**v0.6.0 release 済 (2026-05-13, PyPI lizystudio==0.6.0)** + **`issue-cleanup-plan-2026-05-10.md` Wave 1〜6 完了** — `PLAN.md` v0.5 phase 全消化。直近の Tier 1 next は **#513 (StudioError observability、v0.6.0 検証中に発見した 5 行 PR)** / **#495** / 🔒 **#452-b**。次の節目候補は **v0.7+**: 第 2 backend (#403 残・#452-b 解禁トリガ)、Tailwind v4、P-0087 Phase 3、typed error 体系 (R-3.1〜R-3.3) など）

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
| `docs/architecture-as-implemented.md` | 実装の現状 snapshot（BLUEPRINT は意図、こちらは現実） | 2026-05-12 | BLUEPRINT との対比で読む |
| `docs/api.md` | REST API リファレンス。BLUEPRINT §5 へのゲートウェイ | 2026-04-10 | 内容は BLUEPRINT 派生 |
| `docs/adapter-guide.md` | BackendAdapter Protocol 実装手順 | 2026-04-10 | BLUEPRINT §6 (Adapter 設計) と対 |

> **Tier 3 のドキュメントは BLUEPRINT.md からの派生であり、BLUEPRINT が真。drift が見つかったら BLUEPRINT 側を真として Tier 3 を更新する。**

### Tier 4: アクティブな個別計画

仕様変更（Proposal）には届かないが、複数 PR をまたいで実装する計画は個別ドキュメントを起こす。

| ドキュメント | 役割 | ステータス | 進捗追跡 |
|---|---|---|---|
| `docs/gui-e2e-plan.md` | GUI E2E Phase A/B/C/D 計画 | 🟢 Phase A〜D ほぼ完了（B-1〜B-8 + Phase C generator + 22 field 着地、残課題は §4.2「カバー困難」表） | 本 ROADMAP §4 |
| `docs/issue-cleanup-plan-2026-05-10.md` | Open Issue を 6 Wave で消化する計画（Tune workflow 中心） | 🟢 Wave 1〜6 完了。残りは #452-b（2nd-adapter gated）+ #495（deferred tier-3）のみ — それらが片付いたら Tier 5 へ | 本ドキュメント自体 |
| `docs/v3-20-tune-resume-design.md` | v3-20 (R-1.4 Tune resume) 設計レビュー資料 | 🟢 shipped（v0.5.0 で v3-20a〜g 着地）— Tier 5 相当 | — |

### Tier 5: アーカイブ（完了済み・参照のみ）

完了したらヘッダに `**Status**: ✅ shipped <YYYY-MM-DD>` を付けて Tier 5 へ。**ファイル移動はしない**（検索可能性のため）。

| ドキュメント | 内容 | クローズ日 |
|---|---|---|
| `docs/coupling-analysis.md` | A-1..A-10 / B-1..B-10 / C-1..C-12 の疎結合化計画 | 2026-04-22 |
| `docs/c6-openapi-fetch-plan.md` | C-6（openapi-fetch 導入）の実装計画 | 2026-04-22 |
| `docs/ui-config-sync-audit-2026-04.md` | Issue #249 起点の Workspace form config-sync 監査 | 2026-04-23 |
| `docs/v0.4-business-readiness-plan.md` | v0.4「業務利用可能」化の Phase 別計画（R-1〜R-5） — R-1/R-2/R-4.1 は v0.5.0 で着地、R-3.1〜3.3 のみ v0.6+ deferred | 2026-05-07 |
| `docs/v3-20-tune-resume-design.md` | v3-20 (R-1.4 Tune resume) 設計レビュー資料 — v3-20a〜g で実装完了 | 2026-05-07 |
| `docs/pre-v05-handoff-2026-05-05.md` | v0.5 着手前 MUST/SHOULD/OPTIONAL 13 件の作業内訳 — 全件消化済 | 2026-05-07 |

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
| GUI E2E `Phase A.1〜A.7`, `B-1..B-8`, `C`, `D-1..D-5` | `docs/gui-e2e-plan.md` の E2E 計画 | `B-4`, `D-3` | **概ね完了**（B-1〜B-8 + Phase C generator + 22 field 着地）。本文書 §4 で実装状況を追跡 |
| `G-1..G-8`, `H-1..H-4` | 2026-04-30 develop ブランチの code-review 監査で付けた gap/highlight ID | `G-3`, `H-2` | **完了** (PR #300, #303, #306..#310)。歴史参照のみ |
| `INV-N` | 個別 Proposal 内の invariant ID | `INV-A1` | Proposal 内ローカル ID |

> **判断ルール**: 仕様変更を伴う作業は P-XXXX を起票し、PLAN.md にフェーズ（`v3-N`）を追加する。E2E 単独追加は B-N / D-N で運用継続。

---

## 2. 直近完了（参考）

新規着手の前に、直近完了した大きな塊を把握しておく：

| 完了日 | ID | タイトル | 主要 PR |
|---|---|---|---|
| 2026-05-13 | Wave 6.4 (#451) | `services/jobs.py` (1062→522 行) を 4 module に分割 — `JobMetadataStore` / `ActiveJobSlot` / `JobControlFlags` / `JobLineage` + thin orchestrator façade。backend 最後の god-class 解消（"C-level closing chapter"） | #499 / #500 / #501 / #502 / #503 |
| 2026-05-13 | Wave 6.5 (#453) + 6.3-a (#452) | BLUEPRINT / arch-as-implemented / v0.4-business-readiness / ROADMAP を v0.5.0 state に reconcile (#497) + `subprocess_runner.run_job_in_subprocess` を helper 分割 (#498) | #497 / #498 |
| 2026-05-12 | Wave 6.1-6.3 (#403/#456/#452) | metric-compat を `BackendCore` capability の裏へ (P-0106) + stray-file gate + orphan-golden gate + `workspace_reset` / `_run_job_core` の helper 分割 | #490 / #491 / #492 / #493 / #494 |
| 2026-05-12 | P-0104〜P-0106 | Tune workflow 全面整備（Re-tune UX + canonical defaults + validation guardrails + LizyML v0.15 SSOT 連動）+ Residuals kind selector + metric-compat capability | 多数（Wave 1〜5）。HISTORY §P-0104〜§P-0106 |
| 2026-05-12 | LizyML v0.15.0 連動 | `LGBMProvider.objective_choices/metric_choices/parameter_bounds` を UiSchema 経由で SSOT 化、Studio hardcoded master 削除（D3/D7） | (Wave 3.1b) |
| 2026-05-07 | **v0.5.0 release** | Reliability release — Tune 24h+ resumability + server restart recovery + WS reconnect + browser reload restoration + format_version CI gate + CVE patch round | #416〜#438（多数）, release merge |
| 2026-05-07 | P-0099 (v3-17〜v3-22) | Job state machine invariants INV-1〜INV-7 + `paused` state + pause/unpause API + `WsPaused` + server restart reconciliation | #408（proposal）, #412〜#426 |
| 2026-05-07 | P-0102 (v3-24) | ブラウザリロード後の workspace state 自動復元（`current_job_id` hydrate + beforeunload dirty guard） | #429 / #430 / #435 |
| 2026-05-07 | P-0103 (v3-25) | 古い format_version の workspace を read-only で保護（`LegacyFormatProtectionError` + `format-version-matrix` CI gate） | #432 / #434 / #436 / #438 |
| 2026-05-07 | R-2.1 (v3-23) | WebSocket 再接続戦略（5min ceiling + indefinite retry + ±15% jitter） | #427 |
| 2026-05-05 | **v0.4.1 release** | Validate clarity patch — severity envelope + auto-disable uncomputable metrics + lizyml 0.11.0 (sMAPE/WAPE) | #397 / #398 / #399 / #400 / #401 / #402 (release merge) |
| 2026-05-05 | PR-D1 (#400) | fit/tune raise sites filter on `severity="error"`; warning-only configs no longer 422 | #400 |
| 2026-05-05 | PR-C2 (#399) | `_workspace_metric_compatibility_errors` auto-disables `mape`/`rmsle`/`r2` via severity=warning + suggested_fix | #399 |
| 2026-05-05 | LizyML 0.11.0 bump | adopt sMAPE / WAPE (zero-tolerant MAPE alternatives) | #398 |
| 2026-05-05 | PR-C1 (#397) | hide redundant SHAP Summary tab in Workspace Plot panel | #397 |
| 2026-05-05 | **v0.4.0 release** | Wide DataFrame — data/preview & importance payload caps, chunked CSV fail-fast | (multiple, #395 release merge) |
| 2026-05-05 | P-0098 | `load_dataframe` chunk-based fail-fast memory guard (PR-B3) | (in v0.4.0) |
| 2026-05-05 | P-0097 | Wide DataFrame data/preview + importance payload caps (#361 / R-5.1) | (in v0.4.0) |
| 2026-05-04 | P-0096 | 業務利用 (business-use) 定義の確定と v0.4 Exit Criteria への反映 | (docs) |
| 2026-05-03 | P-0095 | Backend fit→load round-trip integration test as required CI gate (#346 Phase C) | #348..#354 |
| 2026-05-01 | BLUEPRINT audit | P-0086..P-0094 の Decisions を BLUEPRINT.md §3.3/§3.4/§5.2/§5.5/§6.1/§8.1 に反映 | #335 |
| 2026-05-01 | P-0094 (impl) | pytest-benchmark perf baseline (`tests/bench/` + nightly job) | #334 |
| 2026-05-01 | P-0094 (proposal) | pytest-benchmark introduction Proposal-only | #333 |
| 2026-05-01 | Tier 3 docs sync | architecture / api / adapter-guide drift 是正 + drift gate | #332 |
| 2026-05-01 | ROADMAP/PLAN cleanup | post-P-0093 drift 整理 (Issue #304 close ほか) | #331 |
| 2026-05-01 | #328 | execution.log redirect | #330 |
| 2026-05-01 | P-0093 | WebSocket terminal-replay（Issue #327） | #329 |
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

> **状態サマリ**: 直近のアクティブ Proposal はすべて Decision 確定 + 着地済（P-0099 / P-0102 / P-0103 = v0.5.0、P-0104 / P-0105 / P-0106 = Tune workflow & metric-compat）。新規 Proposal は **P-0107 以降**を採番。

### 3.-1 v0.5 R-1 / R-2 / R-4 Proposal 群（P-0099, P-0102, P-0103 — すべて着地済）

- **P-0099**: Job state machine invariants（INV-1〜INV-7）+ `paused` state（R-1 全体の Change Gate）— Approved 2026-05-06、**v3-17〜v3-22 で実装完了 (v0.5.0)**。BLUEPRINT §3.4 / §5.3 / §5.5 / §6.1 に反映済（#453）
- **P-0102**: ブラウザリロード後の workspace state 自動復元（v3-24 / R-2.2）— Approved 2026-05-07、**v3-24 で実装完了 (v0.5.0)**
- **P-0103**: 古い format_version の workspace を read-only で保護（`LegacyFormatProtectionError` + `format-version-matrix` CI gate、v3-25 / R-4.1）— Approved 2026-05-07、**v3-25 で実装完了 (v0.5.0)**
- **P-0100 / P-0101**（v0.4.1 で確立、#406 で Decision 記録）: severity envelope formalization / metric-compat watchlist。`_blocking_errors` セマンティクス + auto-disable ルール
- **P-0104**: Tune workflow 全面整備（Re-tune UX + canonical defaults + validation guardrails + LizyML v0.15 SSOT 連動）— Decision 確定、ほぼ着地（残: #474 deferred parse_space validation）
- **P-0105**: Residuals plot に kind selector（#457）— 着地済
- **P-0106**: metric 不適合判定を `BackendCore` capability の裏へ（Change Gate、#403）— 着地済（`BackendCore.get_incompatible_metrics`）。完全な 2nd-backend 移行は §3.3 後
- **P-0109**: Tune 派生デフォルトの backend SSOT 化 + intent/effective 分離（Change Gate）— ✅ Approved & shipped (Option B, 2026-05-15〜2026-05-16, 全 9 PR 着地)。Tune タブ初回マウントで catalog defaults が Fixed 表示になるバグ（[2026-05-14 確認](HISTORY.md)）の根本治療が **PR-5 (#521) で構造的に解消**。`BackendCore.get_tuning_defaults` + `compute_effective_tuning` を Protocol に追加 (#517)、`LizyMLAdapter` 実装 (#518)、追加エンドポイント `GET /config/tuning-snapshot` / `PUT /config/tuning-overrides` (#519)、`WorkspaceState.tuning_overrides` 一級フィールド化 + INV-T6 snapshot 凍結 (#520)、frontend 3 useEffect 物理削除 + render-time fallbacks (#521)、docs reconcile + HISTORY Decision flip (#522)、`compute_effective_tuning` direction 派生 refine + `_prepare_tune_config` hardcoded `maximize_metrics` set 削除 (#523)、`useTuningSnapshot` hook + `SearchSpaceRow` "Modified" badge + `TASK_DEFAULT_METRICS` frontend 定数削除 + snapshot レスポンスへ `tuning_overrides` 追加 (#524)。Option B として実施しなかったもの: (a) `STUDIO_FORMAT_VERSION` 2 → 3 bump（on-disk `WorkspaceConfig.tuning` block は v2 シェイプのまま、`absorb_legacy_tuning` / `get_legacy_config_view` 双方向 shim で吸収）。残存フォローアップ: A-1 `_assert_inv_t3` 再有効化（`tune-resume.spec.ts:185` の pause-timing race 解消後、helper は #523 で残存）、A-2 Tune タブ write path を `PUT /config/tuning-overrides` (sparse) へ移行（現状は legacy `PUT /config` 経由で `absorb_legacy_tuning` shim 吸収）。

### 3.0 P-0094 (済)：pytest-benchmark performance baseline（Issue #27 (a)）

- **状態**: ✅ 完了（Proposal #333 + 実装 #334 ともに merged 2026-05-01）— `tests/bench/test_bench_lizyml_fit.py` で 100k 行 fit を nightly 計測、JSON artefact upload。LizyML fit baseline mean ≈ 13.5 s / stddev ≈ 1.5 s（local 3 rounds, n_estimators=50）
- **後続候補**: regression auto-detection（`--benchmark-compare`）、stress harness (Issue #27 (b))、frontend perf benches。いずれも別 Proposal で起票

### 3.1 P-0093 (済)：WebSocket terminal-message replay for late subscribers（Issue #327）

- **状態**: ✅ 完了（PR #329 merged 2026-05-01）— `tests/test_progress.py::TestTerminalReplay` 7 ケース緑、`lizystudio_progress_terminal_replayed_total` メトリクスで運用観察可能

### 3.2 P-0087 Phase 3：`cv_strategy_fields` を Pydantic から自動派生

- **状態**: 🟡 未着手（HISTORY.md:2418 で「Phase 3 PR で別途検討」と記載）
- **動機**: 現在 `lizystudio/backends/lizyml_ui_schema.py` で hand-coded。lizyml 側の Pydantic model から生成すれば drift が原理的に消える
- **ブロッカー**: lizyml 側に構造化フィールドメタデータの export を頼む必要あり（リポジトリ間調整）
- **優先度**: 中（P-0087 Phase 1+2 で contract test が drift を検出可能なので、緊急ではないが残課題）
- **着手手順**: HISTORY に P-0107 以降として Proposal 起票 → lizyml 側に構造化フィールドメタデータ export を依頼（リポジトリ間調整）→ PLAN.md に `v3-27` 以降として登録 → 実装

### 3.3 ML Backend 抽象の 2nd 実装による検証

- **状態**: 🟡 未着手（`docs/coupling-analysis.md:283` に flag、Issue 未起票）
- **動機**: A-1〜A-6 で `BackendAdapter` Protocol を整備したが、実装が lizyml 1 件のみ。第 2 実装で抽象の妥当性を検証したい
- **ブロッカー**: 第 2 backend の選定が未決（候補: scikit-learn `Pipeline` 直接 / `xgboost` Native API / 他）
- **優先度**: 低〜中（戦略タスク、次の四半期で計画したい）

---

## 4. GUI E2E カバレッジ強化（gui-e2e-plan.md Phase D — 概ね完了）

`docs/gui-e2e-plan.md` の段階実装プラン。**Phase A の Config field × E2E カバレッジは約 55%（22/40+）** — Phase B-1〜B-8 + Phase C generator + wave 1〜8 が着地済。残りは UI 露出無し / 隠しフィールド / 複合 UI で §4.2 末尾「カバー困難」表に分類（B-3b funnel state 問題 / GLOBALLY_HIDDEN フィールド / KeyValueEditor 動的 dict 等）。新規追加が必要なのは v3-22c（Playwright server-restart spec）と #444 deferred（Inference Results の Prediction Distribution / Score アサーション）程度。

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

Wave 6 完了後の Open Issue は **4 件**（#451 / #453 は 2026-05-13 close 済、#27 / #28 / #125 は 2026-05-04 close 済、#360 / #384 / #403 / #404 / #405 も close 済）。

| Issue | タイトル | priority | 推奨アクション |
|---|---|---|---|
| **#452** | refactor(backend): reduce 5 over-50-line functions | tier-3 / low | **Wave 6.3** — 完了: `_workspace_metric_compatibility_errors`（P-0106 で obsolete）/ `workspace_reset`（#492）/ `_run_job_core`（#493）/ `run_job_in_subprocess`（#498）。残り 1 件: `backends/lizyml/lifecycle_mixin.py::tune`（167 行）— 「2nd-adapter 議論（§3.3）後」に gated |
| **#474** | validation: surface inverted-range / log+low≤0 search-space errors early (deferred from P-0104 Wave 3.1a) | tier-3 / medium | backend `validate_config` で `parse_space()` に通して `search_space_invalid` を早期 surface |
| **#488** | Migrate frontend to Vite 8 (Rolldown) — e2e `/api/ws` proxy regression blocks the bump | priority-low / area-frontend | vite は v6 据え置き、dependabot.yml で semver-major ignore（PR #489）。Vite 8 dev server が e2e proxy を壊す（`project_vite8_migration_held`） |
| **#495** | chore(ops): weekly stale-doc audit cron (#456 L5, deferred follow-up) | tier-3 / low | `scripts/audit_stale_docs.py` + `.github/workflows/audit-stale-docs.yml`（cron weekly）+ tracking issue 自動更新 |
| **#513** | observability(api): log every StudioError in `studio_error_handler` (R-3.1 precursor) | enhancement / small | `api/errors.py::studio_error_handler` に WARNING-level log を 1 行追加（`code` / `status_code` / method / path、PII なし）。R-3.1 typed-error 体系（v0.6+ deferred）への precursor。**v0.6.0 検証中に発見した観測性ギャップ**: 4xx 系 StudioError は uvicorn access log のみで `code` が grep できないため、ユーザ報告のエラーが事後追跡不能 |

---

## 6. ドキュメントドリフト（要メンテナンス）

| 対象 | 最終更新 | リスク | 対応 |
|---|---|---|---|
| `BLUEPRINT.md` | ✅ 2026-05-12 reconciled (Issue #453) | — | P-0099（`paused` state + INV-1〜7 + pause/unpause API + `WsPaused` + startup reconcile）/ P-0102（reload restoration）/ P-0103（`LegacyFormatProtectionError` + format-version matrix）/ P-0104〜P-0106 を §3.4 / §5.3 / §5.5 / §6.1 に反映。`tune(storage, study_name)` を §3.3.2 に追記 |
| `HISTORY.md` Decision 記録 | ✅ 2026-05-12 P-0106 まで | — | v0.5.0 の P-0099〜P-0103、Tune workflow の P-0104〜P-0106 まで Decision 記録済 |
| `PLAN.md` v3-N | ✅ 2026-05-13 v3-26 完了 | — | v3-16〜v3-26 全て着地（v3-26: P-0107 envelope + nightly pickle-compat matrix） |
| `docs/architecture.md` / `api.md` / `adapter-guide.md` | ✅ 2026-05-01 reconciled | — | 棚卸し完了。`tests/contract/test_adapter_guide_method_names.py` で adapter-guide.md ↔ Protocol の drift を gating |
| `docs/architecture-as-implemented.md` | ✅ 2026-05-13 reconciled (Issue #453 / S-4 / #451) | — | `paused` state + INV-1〜7 を state diagram に反映、§5 を #451 後の `JobStore` → `_job_metadata`/`_job_active_slot`/`_job_control_flags`/`_job_lineage` 4-module 構成に更新 |
| `docs/v0.4-business-readiness-plan.md` | ✅ 2026-05-13 (R-4.2 done) | — | R-1 / R-2 / R-4.1 / R-4.2 全て着地（R-4.2 は P-0107 envelope + nightly matrix）。残るは R-3.1〜R-3.3 (v0.6+ deferred) のみ。Tier 5 相当（ファイル移動はしない） |
| `docs/issue-cleanup-plan-2026-05-10.md` | 🟡 2026-05-13 | 低 | Wave 1〜6 完了。残るは #452-b（2nd-adapter gated）+ #495（deferred tier-3）のみ。それらが片付いたら header に `Status: ✅ shipped` を付けて Tier 5 へ |
| `MEMORY.md` 古いノート | 🟡 要更新 | 低 | `project_2026_05_12_wave6_progress` まで反映済だが v0.5.0 release / v3-20〜v3-25 着地 + #451 JobStore 分割 + #453 reconcile が memory 未記録（次セッションで反映） |
| `analysis/` 削除済み | 2026-04 期間 | `python-analyst` ↔ `lizystudio-analyst` パイプライン成果物の置き場が無い | 🟡 意図的削除か要確認、別 issue 検討 |

---

## 7. 推奨 Next Action（ROI 順 / 1 PR 単位）

> v0.5.0 リリース完了 (2026-05-07)。`issue-cleanup-plan-2026-05-10.md` Wave 1〜6 完了 (2026-05-13)。残るバックログは少数。

### Tier 1：直近の着手候補（ROI 順）

1. **A-1 / A-2 — P-0109 follow-up（v0.6.1 後に起票）** — A-1: `_assert_inv_t3` warn-only helper の再有効化（PR #523 で導入 + 一時 disable、`tune-resume.spec.ts:185` の pause-timing race と相互作用、helper 自体は src に残存）。A-2: Tune タブ mutation を legacy `PUT /config` → 新 `PUT /config/tuning-overrides` (sparse REPLACE) へ移行。両者とも tech-debt / low priority、機能影響なし
2. **#495** — #456 L5: weekly stale-doc audit cron（`scripts/audit_stale_docs.py` + `.github/workflows/audit-stale-docs.yml` cron weekly、tracking issue 自動更新。tier-3/low、deferred）
3. **#452-b `lifecycle_mixin.tune` 分割** — 🔒 2nd-adapter 議論（§3.3）後に解禁。それまで着手しない

> ~~P-0109 PR-6 残作業~~ ✅ 完了 (#522 / #523 / #524、2026-05-16 着地。全 9 PR (#516〜#524) develop に着地、INV-T3 が `LizyMLAdapter.compute_effective_tuning` の SSOT で enforce、`useTuningSnapshot` hook + "Modified" badge 経由で frontend read path 完成、`TASK_DEFAULT_METRICS` frontend 定数削除、HISTORY Decision flip + ROADMAP / BLUEPRINT / architecture-as-implemented reconcile 完了)
>
> ~~#513 (StudioError observability / R-3.1 precursor)~~ ✅ 完了 (PR #515、2026-05-14。`api/errors.py::studio_error_handler` で全 StudioError を WARNING level で log、`code` / `status_code` / method / path、PII なし、`details` は意図的に除外)

> ~~v3-26 (R-4.2 Pickle compat nightly CI)~~ ✅ 完了 (PR #506 / P-0107 envelope + `scripts/pickle_compat_matrix.sh` + `.github/workflows/nightly.yml::pickle-compat` job) — v0.5 Exit Criteria の format/pickle 互換が完全に gating された。残る Exit #5 = 業務利用 KPI のみ要 verify
>
> ~~#474 (P-0104 deferred — search-space 早期 validate)~~ ✅ 着地 (PR #507 / P-0108) — `BackendCore.validate_search_space` 追加 + `POST /tune` run-gate で 422、`PUT /config` は引き続き permissive。

### Tier 2：v0.6 候補（要長期計画）

- **第 2 ML backend 実装** — `BackendAdapter` 抽象の妥当性検証（候補: scikit-learn `Pipeline` / xgboost Native API / 他、未決 — §3.3）。これが見えてから #403 の `get_incompatible_metrics` 完全移行 + #452-b `lifecycle_mixin.tune` 分割が解禁される
- **R-3.1〜R-3.3** — typed error 体系（`StudioError` に `code` / `recovery_hint` / `is_user_error` 必須化）— `docs/v0.4-business-readiness-plan.md` §4。本計画で残る唯一の未着手スコープ
- **P-0087 Phase 3** — `cv_strategy_fields` を LizyML Pydantic から自動派生（LizyML 構造化 export 待ち）
- **Tailwind v4 移行**（旧 #125、close 済）— `Button` で spike → 専用 sprint。即着手は推奨しない
- **#488 Vite 8 (Rolldown) 移行** — e2e `/api/ws` proxy regression で hold（`project_vite8_migration_held`）
- **load / stress / offline tests**（旧 #27 (b) / #28、close 済）— 並行 fit stress harness は実機要件あり。offline / during-run reload は P-0102 (v3-24) でカバー済

### v0.5 phase 進捗（`PLAN.md` v3-17〜v3-26）

| Phase | 内容 | 状態 |
|---|---|---|
| v3-17 | R-1.1 Slot release 6 経路 invariant (INV-1/INV-5) | ✅ 完了 (PR #412 + #413) |
| v3-18 | R-1.2 Cancel + completion interleaving (INV-5 write-side, rescoped) | ✅ 完了 (PR #414) |
| v3-19 | R-1.3 INV-2 fsync durability + INV-6 crash recovery (rescoped) | ✅ 完了 (PR #415) |
| v3-20 | R-1.4 Tune resume (INV-3/INV-4 / #360) — 7 sub-phase | ✅ 完了 (PR #416〜#424) |
| ~~v3-21~~ | ~~R-1.5 #359 job-num drift~~ | ❌ subsumed by PR #366、欠番 |
| v3-22 | R-1.5b Server Restart Recovery (INV-7 / #384) | ✅ 完了 (PR #425 + #426)。v3-22c (Playwright server-restart spec) は 🟡 残（DoD は v3-22a/b で満了、#384 close 済） |
| v3-23 | R-2.1 WS 再接続 (5min ceiling + indefinite retry + jitter) | ✅ 完了 (PR #427) |
| v3-24 | R-2.2 ブラウザリロード復元 (P-0102) | ✅ 完了 (PR #429 + #430 + #435) |
| v3-25 | R-4.1 format_version migration matrix CI gate (P-0103) | ✅ 完了 (PR #432 + #434 + #436 + #438) |
| v3-26 | R-4.2 Pickle compatibility nightly CI | ✅ 完了 (feat/v3-26-pickle-compat-nightly / P-0107) |

直近の next: **v0.6.1 patch release**（P-0109 chain bundle + #513 observability、リリース直前）。その後は上記 Tier 1 の A-1 / A-2 follow-up Issue。v0.6 候補は上記 Tier 2 を参照。

---

## 8. 運用メモ

- 新規 Proposal を起票するときは **P-0110 から採番**（P-0107 = `PICKLE_INCOMPATIBLE` structured envelope / v3-26、P-0108 = search-space run-gate / #474、いずれも 2026-05-13 着地。P-0109 = 2026-05-14 起票 → 2026-05-16 Approved & shipped (Option B, 全 9 PR 着地)、Tune 派生 SSOT 化）。`H-XXXX` 採番は終了。
- 新規 PLAN フェーズは **v3-27 以降**を採番（v3-26 = R-4.2 Pickle compat、2026-05-13 着地で v0.5 phase 完全消化）。
- E2E 単独追加（仕様変更なし）は HISTORY 起票不要、本 ROADMAP の §3 を更新するだけで OK。
- 本 ROADMAP はステータス変更時に都度更新。タスク完了時は §1 へ移動、新規着手時は §2/§3/§4 へ追加する。
- 古い ID（B-N coupling、A.M Phase A など）は履歴参照のためそのまま残す。検索性のため改名はしない。
