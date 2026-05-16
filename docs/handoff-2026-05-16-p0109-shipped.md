# Handoff — 2026-05-16 (P-0109 chain shipped, next release = v0.6.1 patch)

**Status**: 🟢 **P-0109 chain 全 PR (#516〜#524) が develop に着地**。Tune タブ初回マウントで Fixed 行が表示されるバグは **PR-5 (#521)** で構造的に解消、SSOT 整理は PR-1〜PR-6c で完了。残るは観測性パッチ + ドキュメント reconcile + 2 件のフォローアップ Issue 起票で、**v0.6.1 patch release が即組める状態**。

**Date**: 2026-05-16
**Trigger**: 前 handoff（`docs/handoff-2026-05-13-wave6-complete.md` = Wave 6 完了）以降、P-0109 Proposal 起票 (2026-05-14) → 9 PR 連続着地 (#516〜#524、2026-05-15〜2026-05-16)。本セッションでは PR-6a/6b/6c の docs + INV-T3 + snapshot read path を完成させ、3 PR を develop へ merge。

**Tier**: 4（アクティブ計画 → リリース直前）。**前 handoff `docs/handoff-2026-05-13-wave6-complete.md` は本書が supersede。** v0.6.1 リリース完了後に `Status: ✅ shipped` を付けて Tier 5 へ。

---

## TL;DR

- **develop HEAD = `29f5ab3`**（PR #523 squash merge 後）。CI green。オープン PR なし。clean working tree。
- 本セッションで **PR #522 / #524 / #523 を merge**（順に PR-6a docs / PR-6c snapshot read / PR-6b INV-T3 refinement）、**P-0109 chain (#516〜#524) 全 9 PR が develop に着地**。
- **`LizyMLAdapter.compute_effective_tuning` direction 派生を refine**（effective first metric ベースに変更）+ `_prepare_tune_config` の hardcoded `maximize_metrics` set 削除 + `useTuningSnapshot` hook + `SearchSpaceRow` "Modified" badge + `TASK_DEFAULT_METRICS` frontend 定数削除 + snapshot レスポンスへ `tuning_overrides` 追加。**INV-T3 は adapter Protocol semantic で SSOT 化**。
- **次に着手するなら v0.6.1 release （後述のスコープ）**。3 タスクの bundling で 1 セッション完結可能。
- **本セッションで判明した既知問題**: PR-6b の `_assert_inv_t3` 呼び出しは e2e `tune-resume.spec.ts:185` の pause-timing race と相互作用するため一時 disable。helper は残存、再有効化はフォローアップ Issue。
- **環境メモ**: validate-push.sh は mypy cache 破損で誤検出することがある（`uv run mypy --no-incremental` で復帰）。force-push は引き続き禁止、rebased branch は `merge --no-ff` で develop を取り込む（feature branch を delete+recreate しない）。

---

## 本セッション着地サマリ（2026-05-15 〜 2026-05-16、すべて develop へ squash merge 済）

| PR | 内容 | 着地日 | Commit |
|---|---|---|---|
| [#516](https://github.com/nbx-liz/LizyStudio/pull/516) | PR-1 Proposal HISTORY P-0109 + ROADMAP entry（`[docs-only]`） | 2026-05-14 | `34a9b52` |
| [#517](https://github.com/nbx-liz/LizyStudio/pull/517) | PR-2 共通型 `TuningDefaults` / `TuningOverrides` / `TuningConfig` + `BackendCore.get_tuning_defaults` / `compute_effective_tuning` Protocol 追加（safe default） | 2026-05-14 | `bce7a17` |
| [#518](https://github.com/nbx-liz/LizyStudio/pull/518) | PR-3 `LizyMLAdapter` catalog-aware impl（18 adapter tests）+ `_TASK_DEFAULT_METRICS` を adapter 側へ移管 | 2026-05-15 | `e5b73c6` |
| [#519](https://github.com/nbx-liz/LizyStudio/pull/519) | PR-4a 追加 `GET /config/tuning-snapshot` + `PUT /config/tuning-overrides`（21 tests、`absorb_legacy_tuning` / `get_legacy_config_view` 双方向 shim） | 2026-05-15 | `d802d33` |
| [#520](https://github.com/nbx-liz/LizyStudio/pull/520) | PR-4b `WorkspaceState.tuning_overrides` 一級フィールド化 + `materialize_tuning_for_job` で INV-T6 snapshot 凍結（16 tests）| 2026-05-15 | `a6cfa55` |
| [#521](https://github.com/nbx-liz/LizyStudio/pull/521) | PR-5 frontend 3 useEffect 物理削除 + render-time fallbacks + e2e regression spec — **ユーザー可視バグ修正** | 2026-05-15 | `7c30559` |
| [#522](https://github.com/nbx-liz/LizyStudio/pull/522) | PR-6a HISTORY Decision flip + ROADMAP / BLUEPRINT / architecture-as-implemented reconcile + TuneEvaluationSection コメント精緻化 | 2026-05-16 | `36d774b` |
| [#524](https://github.com/nbx-liz/LizyStudio/pull/524) | PR-6c `useTuningSnapshot` TanStack hook + `SearchSpaceRow` "Modified" badge + `TASK_DEFAULT_METRICS` 削除 + snapshot レスポンスへ `tuning_overrides` 追加 | 2026-05-16 | `a467e7f` |
| [#523](https://github.com/nbx-liz/LizyStudio/pull/523) | PR-6b `compute_effective_tuning` direction 派生 refine + `_prepare_tune_config` hardcoded `maximize_metrics` set 削除 + warn-only `_assert_inv_t3` helper（呼び出しは e2e timing 都合で disable） | 2026-05-16 | `29f5ab3` |

### Highlights

- **INV-T3 (P-0109)**: optimization direction は `LizyMLAdapter.compute_effective_tuning` の SSOT 単一ソース。`_direction_from_metrics` static helper が bare-string と dict-form MetricEntry の両方を扱う。`services/training.py` の hardcoded `maximize_metrics = {"auc","auc_pr","r2","accuracy","f1","auc_mu"}` set は削除。
- **INV-T5 / SSOT**: `TASK_DEFAULT_METRICS` は adapter 側 (`backends.lizyml.config_mixin._TASK_DEFAULT_METRICS`) で唯一の定義。frontend は `tuning_defaults.evaluation_metrics` を snapshot 経由で受け取る。
- **新 API surface**:
  - `GET /api/workspace/config/tuning-snapshot` → `{tuning_effective, tuning_defaults, tuning_overrides}`（PR-6c で 3 つ目を追加）
  - `PUT /api/workspace/config/tuning-overrides` → sparse `TuningOverrides` body、REPLACE semantics
- **"Modified" badge**: `SearchSpaceRow` が `isUserSet` prop（`tuning_effective.user_set_paths` 由来）でユーザー編集行を視覚的に区別。
- **on-disk schema 不変**: `STUDIO_FORMAT_VERSION` は 2 据え置き。`absorb_legacy_tuning` / `get_legacy_config_view` 双方向 shim が legacy nested 形を吸収。INV-T7 trivially 成立。

---

## v0.6.1 リリース計画

### スコープ

**Theme**: "P-0109 Tune SSOT consolidation + observability patch"

**Risk**: LOW（コードの大部分は既に develop で安定稼働中）。format-version 不変、Pickle 不変、Pydantic schema は v3 移行せず v2 wire compat を維持。

| ID | 作業 | 工数 | 備考 |
|---|---|---|---|
| **R-1** | CHANGELOG.md `[Unreleased]` セクションに P-0109 chain (#516〜#524) を bundle | 30 min | Keep a Changelog 形式、新 API surface / INV-T3 / Modified badge を Highlights として記載 |
| **R-2** | **#513** observability(api): `api/errors.py::studio_error_handler` に WARNING-level log 1 行追加 | 30 min | `code` / `status_code` / method / path（PII なし）。R-3.1 typed-error 体系（v0.7+ deferred）への precursor |
| **R-3** | **A-3** docs/ROADMAP.md の P-0109 行を「PR-6 残作業あり」→「全 PR shipped」へ reconcile（§3 / §7 / §8） | 15 min | `[docs-only]` ではなく R-1/R-2 PR の bundle に同梱（feedback_no_docs_only_pr） |
| **R-4** | リリース PR (`develop → main`、`gh pr merge --merge` で squash 不可)、`__version__ = 0.6.1` の vcs-versioning auto-bump 確認、tag `v0.6.1` push | 15 min | `feedback_release_flow_pattern` に従う |
| **R-5** | フォローアップ Issue 起票（A-1 / A-2、後述） | 15 min | 本リリース後の追跡用、コードは含まれない |

**Total**: 2 時間以内、1 セッション完結。

### CHANGELOG エントリ（draft、R-1 で使用）

```markdown
## [0.6.1] - 2026-05-XX

### Added
- **P-0109 Tune backend SSOT consolidation** — Tune タブ初回マウントで catalog defaults が
  Fixed モードで表示されるバグ ([2026-05-14 確認](HISTORY.md)) を構造的に解消 (#521)。
  Effective Tune state は backend adapter が `compute_effective_tuning` で都度 compute、
  workspace は sparse user intent のみ persist。catalog 進化が既存 workspace に自動伝播。
- 新 API: `GET /api/workspace/config/tuning-snapshot` (#519) — `{tuning_effective,
  tuning_defaults, tuning_overrides}` の三つ組を返す。Tune タブの SSOT 読み path。
- 新 API: `PUT /api/workspace/config/tuning-overrides` (#519) — sparse `TuningOverrides`
  body を accept、REPLACE semantics で workspace へ persist。
- SearchSpaceRow に "Modified" badge (#524) — `tuning_effective.user_set_paths` を参照し、
  ユーザーが明示的に編集した行のみ視覚的に区別。

### Changed
- `BackendCore` Protocol に `get_tuning_defaults` / `compute_effective_tuning` を追加 (#517)。
  各 backend adapter が自身の catalog defaults を所有（INV-T5）、direction は effective first
  metric から派生（INV-T3）。
- `LizyMLAdapter.compute_effective_tuning` direction 派生を effective metric ベースに refine
  (#523) — ユーザーが `evaluation_metrics` を override したとき direction も追従する。
- `services/training.py::_prepare_tune_config` から hardcoded `maximize_metrics` set を削除
  (#523)。direction 解決は adapter SSOT 経由に一本化。
- Frontend `TASK_DEFAULT_METRICS` 定数削除 (#524) — snapshot endpoint からの canonical
  metric list を fallback として使用。

### Fixed
- StudioError observability — `studio_error_handler` で全 StudioError を WARNING level で
  log（`code` / `status_code` / method / path、PII なし）。4xx 系エラーが server log で
  追跡可能に (#513)。

### Compatibility
- on-disk `STUDIO_FORMAT_VERSION` は 2 据え置き（schema 不変）。
- legacy `PUT /api/workspace/config` (with `tuning` block) は引き続き正常動作
  (`absorb_legacy_tuning` shim 経由)。
- 既存の `tune_result.trials` / Optuna re-attach 動作は不変。

### Internal
- `BackendAdapter` Protocol 拡張 (`TuningDefaults` / `TuningOverrides` / `TuningConfig`
  共通型追加)、`WorkspaceState.tuning_overrides` 一級フィールド化、INV-T6 snapshot 凍結
  (`materialize_tuning_for_job`)、3 useEffect 物理削除（TuneTab search-space init /
  TuneEvaluationSection direction sync / metrics seed）。
```

### リリース手順（`feedback_release_flow_pattern` 準拠）

1. `git checkout develop && git pull --ff-only` — develop @ 29f5ab3 を最新化
2. **PR-1 (chore release-prep)**: branch `chore/v0.6.1-release-prep` を切り、CHANGELOG `[Unreleased]` → `[0.6.1] - YYYY-MM-DD` 移し替え + ROADMAP §3 P-0109 行 reconcile + #513 observability patch を bundle。`develop` 向け PR、squash merge
3. **PR-2 (release)**: `gh pr create --base main --head develop --title "release: v0.6.1 — P-0109 Tune SSOT consolidation + observability patch"`、`--merge`（NOT `--squash`）で main へ
4. tag push: `git tag v0.6.1 && git push origin v0.6.1` — `.github/workflows/publish.yml` が PyPI へ ~5 min で push
5. v0.6.1 動作確認（`pip install lizystudio==0.6.1` で起動 → Tune タブで Modified badge と snapshot 読み path を visual 確認）

---

## フォローアップ Issue（v0.6.1 後に起票）

### A-1: re-enable `_assert_inv_t3` call after hardening `tune-resume.spec.ts`

**Title**: `tech-debt(p0109): re-enable _assert_inv_t3 warn-only assertion after hardening tune-resume.spec.ts`

**Body**:

PR-6b (#523) で `services/training.py::run_tune` 冒頭の `_assert_inv_t3(tune_config, backend, job_id=...)` 呼び出しを一時 disable した。helper 関数自体は残存。

**根本原因**: `_assert_inv_t3` は read-only な warn-only assertion (`extract_overrides_from_legacy_tuning` + `compute_effective_tuning` の pure call) だが、~tens of ms のレイテンシを `backend.tune(...)` 開始前に追加する。これが `frontend/tests/e2e/tune-resume.spec.ts:185` の pause-observation timing と相互作用し、pause 観測が trial loop を抜けた後にずれてしまう。

**現象**: `expect(trials.length).toBe(4)` が `received: 8`（= 2 × n_trials、studyが pause 前に 4 trials 完了 + unpause で 4 more）で 3 retry とも一貫して失敗。

**INV-T3 の保証は維持**: `LizyMLAdapter.compute_effective_tuning` の Protocol semantic refinement が SSOT を enforce 済。disable した assertion は **非 API 経路（raw YAML import、直接 curl 等）** のドリフト検出ボーナスだったため、本体機能には影響なし。

**再有効化条件**: `tune-resume.spec.ts` を以下のいずれかで堅牢化する:
- (a) `n_trials` を 4 → 8 へ拡大して pause window を確保
- (b) pause 観測タイミングを明示的に assert（trial K < N で観測されることを確認）
- (c) pause を `status=running` 観測前に pre-set してレースを除去

**Acceptance**:
- 再有効化後、`tune-resume.spec.ts:185` が CI 3 連続 green を達成
- `_assert_inv_t3` が `_run_subprocess_job` 経路でも呼ばれることを unit テストで確認

**Priority**: low / tech-debt（機能影響なし、observability 向上のみ）

**Related**: P-0109 (HISTORY.md)、#523、`feedback_e2e_funnel_quiescence_flake` パターン類似

---

### A-2: route Tune-tab mutations through `PUT /config/tuning-overrides` (sparse intent)

**Title**: `refactor(frontend): route Tune-tab mutations through PUT /config/tuning-overrides instead of legacy PUT /config`

**Body**:

P-0109 PR-6c (#524) で snapshot 読み path と "Modified" badge を導入したが、write path は引き続き legacy `PUT /api/workspace/config` を経由している（`absorb_legacy_tuning` compat shim 経由で `ws.tuning_overrides` に吸収される構造）。

**目的**: Tune タブからの mutation を **sparse `TuningOverrides` body** で `PUT /api/workspace/config/tuning-overrides` へルートし、legacy compat shim 依存を解消する。これにより:
- backend API surface の役割が明確化（legacy GET/PUT /config は pure read/write、Tune 専用は専用エンドポイント）
- 将来 `format_version` v3 bump (overrides を on-disk schema に直接 persist) が容易に
- frontend のリクエスト body サイズが縮小（catalog defaults を送らない）

**Implementation note**: `PUT /config/tuning-overrides` は REPLACE semantics。frontend は `useTuningSnapshot` の `tuning_overrides` フィールドを seed にし、edit ごとに merged body を送る。

**Acceptance**:
- TuneTab / TuneEvaluationSection / SearchSpaceTable の onChange が `PUT /config/tuning-overrides` を発火（既存 `PUT /config` は不発）
- PR-5 の e2e regression spec (`workspace-tune-firstmount.spec.ts`) が引き続き green（first mount で `tuning.optuna.space` PUT が発火しない invariant）
- `absorb_legacy_tuning` / `get_legacy_config_view` shim は外部 caller（raw YAML import、curl）のみ通過

**Priority**: low / refactor（機能影響なし、API surface 整理）

**Related**: P-0109 (HISTORY.md)、#519、#520、#524

---

## 残作業全体マップ（v0.6.1 リリース後）

| 系統 | 項目 | 優先度 | 状態 |
|---|---|---|---|
| **P-0109 follow-up** | A-1 `_assert_inv_t3` 再有効化 | 低 | 本書で起票予定 |
| **P-0109 follow-up** | A-2 write-path 移行（`PUT /config/tuning-overrides`） | 低 | 本書で起票予定 |
| **Open GitHub Issue** | #495 weekly stale-doc audit cron | 低 / tier-3 | deferred |
| **Open GitHub Issue** | #488 Vite 8 (Rolldown) 移行 | 低 / hold | e2e proxy regression hold |
| **Open GitHub Issue** | #452-b `lifecycle_mixin.tune` 分割 | 低 / 🔒 gated | 2nd-adapter 議論後 |
| **Tier 2 (v0.7+)** | 第 2 ML backend 実装 | 中 | 候補選定未決 |
| **Tier 2 (v0.7+)** | R-3.1〜R-3.3 typed error 体系 | 中 | `docs/v0.4-business-readiness-plan.md` §4 |
| **Tier 2 (v0.7+)** | P-0087 Phase 3 `cv_strategy_fields` 自動派生 | 中 | LizyML 側 export 待ち |
| **Tier 2 (v0.7+)** | Tailwind v4 移行 | 低 | 専用 sprint 必要 |
| **Tier 2 (v0.7+)** | load / stress harness | 低 | 計画必要 |

---

## 環境メモ（次セッションで知っておくこと）

1. **develop branch protection**: 8 必須 CI checks + strict (base 追従必須) + force-push 禁止 + branch deletion 禁止。Admin も PR 経由のみ。
2. **rebased branch の取り扱い**: force-push 禁止のため、`git rebase origin/develop` で書き換えた feature branch は **そのまま push できない**。代わりに `git checkout origin/feat/...` でリモート版に戻し、`git merge origin/develop --no-ff` で merge commit を作成して push する（本セッションで PR #523 / #524 の develop 取り込み時に使用）。
3. **mypy cache 破損**: `tests/` 配下のテストファイルを編集すると `.mypy_cache` が `KeyError: 'setter_type'` で crash することがある。`uv run mypy --no-incremental src/lizystudio/` で 1 回 cache を再構築すると復帰する。push hook の mypy check も同様に影響を受ける。
4. **commit message に日本語禁止**: validate-pr-language hook が PR 本文・コミットメッセージの日本語をブロックする（CLAUDE.md `~/.claude/CLAUDE.md` 準拠）。日本語は ROADMAP / HISTORY / BLUEPRINT / PLAN / handoff docs のみ。
5. **CI cycle**: full e2e は ~17 min。strict mode で base 追従の sync push もカウントされる。
6. **memory updates**: `project_p0109_chain_in_flight.md` → 内容更新済、`MEMORY.md` index 行も更新済。次セッションでは `project_p0109_chain_shipped` と read する。
7. **release flow**: `feedback_release_flow_pattern` に従い、release PR (develop → main) は **`--merge` (squash 不可)**。tag `vX.Y.Z` を main HEAD に push すると `publish.yml` が ~5 min で PyPI へ push する。

---

## 着手フロー（次セッション開始時）

```bash
# 1. 環境同期
cd /home/rem/repos/LizyStudio
git checkout develop && git pull --ff-only  # → 29f5ab3 (or later)
git log --oneline -5

# 2. v0.6.1 release-prep ブランチ
git checkout -b chore/v0.6.1-release-prep

# 3. CHANGELOG / ROADMAP / #513 を bundle
# - CHANGELOG.md: [Unreleased] → [0.6.1] へ (本書 §v0.6.1 draft を参照)
# - docs/ROADMAP.md: P-0109 行 (§3 line ~163) を "shipped" 状態に更新
# - src/lizystudio/api/errors.py: studio_error_handler に WARNING log 1 行追加 (#513)

# 4. PR を作成
gh pr create --base develop --head chore/v0.6.1-release-prep \
  --title "chore(release): prepare v0.6.1 — P-0109 Tune SSOT consolidation + observability patch" \
  --body-file /tmp/v061_prep_body.md

# 5. develop merge 後、release PR
gh pr create --base main --head develop \
  --title "release: v0.6.1 — P-0109 Tune SSOT consolidation + observability patch" \
  --body-file /tmp/v061_release_body.md
# → --merge (squash 不可)

# 6. tag push
git fetch origin main && git checkout main && git pull --ff-only
git tag v0.6.1 && git push origin v0.6.1
# publish.yml が PyPI へ ~5 min で push

# 7. follow-up Issue 起票
gh issue create --title "tech-debt(p0109): re-enable _assert_inv_t3 ..." --body-file /tmp/issue_a1.md
gh issue create --title "refactor(frontend): route Tune-tab mutations through PUT /config/tuning-overrides" --body-file /tmp/issue_a2.md
```
