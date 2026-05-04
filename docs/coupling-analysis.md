# LizyStudio 疎結合化 改善提案

**作成日**: 2026-04-17
**最終更新**: 2026-04-22 — **全 26 項目 shipped** (バックログ完全クローズ)
**目的**: 今後のメンテナンス・保守・運用・機能追加をスムーズにするための結合度改善の解析。
**前提**: [docs/architecture-as-implemented.md](./architecture-as-implemented.md) で把握した現行アーキテクチャを基準。
**Issue 化方針**: 本文書のみ（C案）。Issue 化は後日判断。

---

## 🎉 Status: 全項目完了 (2026-04-22)

2026-04-17 に立案した 26 項目 (A-1..A-10, B-1..B-10, C-1..C-12、加えて B-9 Part 2 follow-up) は 2026-04-18 〜 2026-04-22 の約 5 日間で全て実装・マージされた。**本文書は今後「歴史的記録」としてのみ参照される**。次の coupling 改善テーマは別ドキュメントで立案する想定。

各 section の entry には ✅ マーカーと shipped PR 番号 / HISTORY entry (H-NNNN) を追記済み。

## 🎯 Executive Summary — 最優先 Top 7

| # | 改善 | 効果 | 工数 | Status |
|---|---|---|---|---|
| 1 | Backend: BackendAdapter を capability 別に分割 + lizyml 具体 import を API/Service から排除 | 2nd backend 追加の工数 5日→1日 | 1.5日 | ✅ PR #192 (H-0068) |
| 2 | Backend: `services/_training_core.py` 抽出 + `WorkspaceState` メソッド化 | 循環的 import と 12箇所の `ws._lock` 外部アクセス除去 | 1日 | ✅ PR #191 |
| 3 | Backend: Subprocess 契約を Pydantic discriminated union で SSOT 化 | parent/child/WS の3重定義を1箇所に | 1.5日 | ✅ PR #193 (H-0069) |
| 4 | Frontend: Query key factory + query hook 層 (`api/queries/useJob.ts` 等) | invalidate抜け / mock散在を根絶、50+ 箇所の文字列キー撲滅 | 2日 | ✅ PR #195, #200, #201 |
| 5 | Frontend: `useJobLifecycle` / `useJobProgress` 抽出 + Results 描画の単一化 | ResultsPanel(368L) と JobDetail(480L) の二重状態機械を解消 | 2日 | ✅ PR #196, #198 |
| 6 | Cross: `pnpm generate:api` を CI ゲート化 + `response_model` 完全化 | `parent_job_id` 欠落のような契約 drift を再発防止 | 0.5日 | ✅ PR #190 |
| 7 | Cross: WebSocket schema を Pydantic discriminated union 化 | backend / frontend / JSONL の3経路を1型で統一 | 1日 | ✅ PR #193 (H-0069) |

合計 ~10 working days 想定 → 実績は約 5 日 (並列 merge と既存コードへの上積み効果)。

---

## 1. Backend 結合

### ✅ A-1. Adapter specific import のリーク
- **場所**: `src/lizystudio/api/retune.py:126-131`, `services/training.py:388-392`
- **結合**: HTTP ルーターが `PickleIncompatibleError` / `verify_pickle_compatibility` を `backends.lizyml` から直接 import。`model_meta.json` の存在とフォーマットまで知っている。
- **影響**: 2nd backend は `BackendAdapter` を満たすだけでなく、この pickle-meta sidecar までサポートしないと動かない。
- **対策**: `BackendAdapter.verify_checkpoint_compatibility(path) -> None` を追加、`CheckpointIncompatibleError` を `backends/types.py` に宣言。API は backend 名を知らずに済む。
- **Shipped**: PR #192 (H-0068, 2026-04-18) — `backends/exceptions.py` 新設、API layer の backend-specific import 除去。

### ✅ A-2. adapter → service の逆向き依存
- **場所**: `backends/lizyml/lifecycle_mixin.py:95` — `from lizystudio.services.training import CancelledError`
- **結合**: Adapter が service 層の例外型を import。`base.py:34-37` の「adapter は persistence/HTTP/session を知らない」という documented contract 違反。
- **対策**: `CancelledError` を `backends/types.py`（または新規 `backends/exceptions.py`）へ移動し、`services.training` は re-export のみ。
- **Shipped**: PR #192 (H-0068, 2026-04-18) — `CancelledError` を `backends/exceptions.py` に移動。

### ✅ A-3. `training.py` ⇄ `training_retune.py` の循環的 import
- **場所**: `services/training.py:653-660` が `training_retune` から re-export、`training_retune.py:28-34` が `training` から 5 つの private symbol を import、`:171` で lazy 再 import。
- **結合**: 論理的に 1 モジュールを 2 ファイルに分割した状態で、循環 import を lazy import で回避している。
- **対策**: `services/_training_core.py`（または `JobRunner` クラス）を抽出し、`_run_job_core`, `_join_previous_thread`, `_prepare_autofit_config`, `_save_tuning_plot`, `_run_pickle_preflight` を移動。両側は core からのみ import。
- **Shipped**: PR #191 (2026-04-18) — `services/_training_core.py` 新設、循環 import 解消。

### ✅ A-4. `WorkspaceState` の private 属性を外から触る
- **場所**: `services/training.py:465,518,543,593,600,633,640`, `training_retune.py:146,267,293,333` — 合計 12箇所で `with ws._lock: ... ws._job_thread = t`
- **結合**: `_lock` / `_job_thread` は private 命名だが、唯一の書き手が外部。encapsulation が形骸化。
- **対策**: `WorkspaceState.register_job_thread(t)`, `previous_job_thread()`, `record_completion(fit, tune, job_id)`, `note_current_job(id)` をメソッド化し、外部 `with ws._lock` を削除。
- **Shipped**: PR #191 (2026-04-18) — `WorkspaceState` のメソッド化で 12 箇所全て削除、encapsulation 回復。

### ✅ A-5. BackendAdapter Protocol が広すぎる（22メソッド）
- **場所**: `backends/base.py:31-201`
- **結合**: 2nd backend 実装時に `export_code` / `confusion_matrix` / `importance_kinds` / `learning_curve_metrics` / `get_ui_schema` まで全部必要。
- **対策**: `BackendAdapter` (lifecycle + types) + `Evaluator` + `Plotter` + `CodeExporter` + `Checkpointer` に分割、capability 判定は `hasattr` または明示的な `adapter.evaluator()` で。Phase 1 は Protocol 宣言の分割のみで可。
- **Shipped**: PR #192 (H-0068, 2026-04-18) — `@runtime_checkable` Protocol 5 分割。

### ✅ A-6. `_ADAPTERS` レジストリがハードコード
- **場所**: `backends/registry.py:8-10`
- **結合**: dict の値型が `type[LizyMLAdapter]` なので新バックエンド追加は型エラー。plugin discovery なし。
- **対策**: 型を `dict[str, Callable[[], BackendAdapter]]` に緩和、`register_backend(name, factory)` 公開、将来 `importlib.metadata.entry_points("lizystudio.backends")` 対応。
- **Shipped**: PR #192 (H-0068, 2026-04-18) — `register_backend()` factory 公開、型緩和。

### ✅ A-7. `services/jobs.py` が 661行の God Module
- **場所**: `services/jobs.py:574-661` に persistence と adapter-dispatch helper が混在。
- **対策**: `services/job_results.py` に `load_job_model`, `get_metrics_table`, `get_importance` 等を移動。model load を LRU キャッシュ化。
- **Shipped**: PR #194 (H-0070, 2026-04-19) — `services/jobs.py` 751→695 行、`services/job_results.py` に thread-safe LRU + `JobStore.delete` cascade invalidation。

### ✅ A-8. 隠れたシングルトン アクセスが不統一
- **場所**:
  - Depends 経由: `services/workspace.py:87` の `get_workspace`
  - 直接 attribute peek: `api/backends.py:17,25` / `api/health.py:45`
  - `ProgressBroadcaster`: `api/workspace.py:507`, `api/retune.py:159` にそれぞれ `_get_broadcaster(request)` 重複定義、`server.py:205` で直接読み
- **対策**: `get_workspace`, `get_backend`, `get_broadcaster`, `get_inference_store`, `get_job_store` を `Depends()` に統一。3 つの重複ヘルパを削除。
- **Shipped**: PR #189 (2026-04-18) — `api/deps.py` 新設、5 つの `get_*` を一元化。

### ✅ A-9. Prometheus メトリクスが module-level global
- **場所**: `metrics.py:24-77`
- **結合**: pytest で 2 つの app を同 process 内で作れない（Counter 再登録エラー）。`ACTIVE_JOBS.set(0)` が process-wide。
- **対策**: `MetricsRegistry` を `app.state.metrics` にぶら下げ、test fixture で fresh registry。
- **Shipped**: PR #211 (H-0075, 2026-04-20) — `MetricsRegistry` を `app.state.metrics` へ、per-app `CollectorRegistry`、pytest で 2 app 同時生成可。

### ✅ A-10. Service が disk path を文字列で生成
- **場所**: `training.py:190,216,413,427,435`, `jobs.py:628` — `jobs_dir / job_id / "tuning_plot.json"` を別モジュールで独立に組み立て。
- **対策**: `JobStore.path_for(job_id, kind: Literal["model","log","tuning_plot","checkpoint"])` を追加。
- **Shipped**: PR #205 (H-0073, 2026-04-19) — `JobStore.path_for(kind)` + module-level `ARTIFACT_FILENAMES`。

---

## 2. Frontend 結合

### ✅ B-1. ResultsCompletedView と CompletedContent の二重実装
- **場所**: `components/workspace/ResultsCompletedView.tsx` (365行) と `components/jobs/CompletedContent.tsx` (264行)
- **結合**: ほぼ同一の 8-10 個 useQuery (`job-plots`, `job-plot/learning-curve`, `job-importance-kinds`, `job-importance`, `job-split-summary`, `job-plot/tuning`)、`lcMetric` / `importanceKind` state、`annotateMetric` ヘルパを独立保持。既に drift 発生（LC metrics 取得元が違う、lineage は ResultsCompletedView にしかない）。
- さらに `jobs/ExportDialog.tsx:14`, `inference/{SetupPanel,ResultsPredOnly,ResultsWithGT}.tsx` が `@/components/workspace/{FileBrowser,PlotlyChart}` を直接 import — `jobs/` / `inference/` → `workspace/` の逆向き依存。
- **対策**: `components/shared/JobResultsView` + `useJobResultData(jobId)` フック抽出。`FileBrowser` / `PlotlyChart` / `PlotSection` を `components/shared/` へ物理移動。
- **Shipped**: PR #196 (2026-04-18) — `useJobResultData` + `JobResultsBody` 抽出、ResultsCompletedView 365→131、CompletedContent 265→36。

### ✅ B-2. ResultsPanel と JobDetail で状態機械二重実装
- **場所**: `components/workspace/ResultsPanel.tsx:35-320` (368行), `components/jobs/JobDetail.tsx:44-310` (480行)
- **結合**: 両者が `useState<ProgressMessage>`, `connectJobProgress` useEffect, `prevStatusRef` polling fallback, `cancelJob` handler を別実装。terminal-state 検出ロジックすら微妙に違う（ResultsPanel は `prev === undefined` も拾うが JobDetail は `prev === 'running'` のみ）。
- `_computeRemainingTrials` (ResultsPanel.tsx:352) と `_defaultRetuneTrials` (ResultsCompletedView.tsx:354) は同じ `config.tuning.optuna.params.n_trials` パスを掘る双子。
- **対策**: `useJobLifecycle(jobId)` フック（status + cancel + invalidate）と `useJobProgress(jobId)` フック（WebSocket 接続共有、`Map<jobId, Subject>` で多重購読防止）を抽出。`config` から trials を取り出すヘルパは `lib/job-config.ts` に統合。
- **Shipped**: PR #198 (2026-04-18) — `useJob` / `useJobProgress` / `useJobLifecycle` 抽出、`terminalFiredRef` guard で invalidate + polling fallback の double-fire 防止。

### ✅ B-3. ModelPanel が God Component (476行)
- **場所**: `components/workspace/ModelPanel.tsx:58-476`
- **結合**: 5 個の useQuery, debounce validation, history (undo/redo), preset save/load, import/export, tuneEnabled 計算 (`tuning.optuna.space` を 5 段ネスト掘る `:222-228`), sticky ヘッダ/footer JSX を全て 1 関数に。
- **対策**: `useModelPanelData()` + `ModelPanelHeader` + `ModelPanelActions` + `ConfigEditorBody` に分割。
- **Shipped**: PR #197 (2026-04-18) — ModelPanel 484→106、orchestrator split パターンで 4 コンポーネント分割。

### ✅ B-4. Hook → Component の逆向き import
- **場所**: `hooks/useConfigSync.ts:8-14` が `@/components/workspace/CvSection` から `applyCvDataFields`, `buildSplitConfig`, `recommendedInnerValid` を import
- **結合**: hook が component に依存。component 側改修で hook テストが折れる。
- **対策**: `cv-state.ts`（既存）を SSOT 化し、hook も component もここから import。
- **Shipped**: PR #204 (2026-04-19) — hook も component も `cv-state` から直接 import。

### ✅ B-5. `useDataPanel` メガフック化
- **場所**: `hooks/useDataPanel.ts:41-201`（26 戻り値）
- **結合**: `useColumnOverrides` / `useDataLoad` / `useConfigSync` 統括に加え、`handleTargetChange` で fetch + state + suppress flag + `requestAnimationFrame` blur 操作まで。
- **対策**: orchestration のみに削り、target 変更時ロジックは `useTargetSelection` mutation hook に分離。
- **Shipped**: PR #218 (H-0077, 2026-04-20) — `useDataPanel` 217→143、`useTargetSelection` hook 抽出、`cv-state.getEffectiveCvStrategy` helper。

### ✅ B-6. Query key factory 不在、invalidate 散在
- **場所**: `["jobs"]`, `["job", id]`, `["job-plot", id, type]` など 50+ 箇所に文字列直書き。`invalidateQueries` は 16 箇所に散在。
- **影響**: RetuneActionButton は invalidate するが他のいくつかは未対応。新 endpoint 追加時に「何を invalidate するか」が散らばる。
- **対策**: `api/queryKeys.ts` factory（`jobKeys.list()`, `jobKeys.detail(id)`, `jobKeys.plot(id, kind)`）と `api/queries/useJob.ts` thin wrapper hook を導入。component は `useJob(id)` のみ呼ぶ。
- **Shipped**: PR #195 (2026-04-18) — `src/api/queryKeys.ts` factory、65 inline queryKeys 移行。

### ✅ B-7. Component が `api/*` を直接呼ぶ (19ファイル)
- **場所**: `ModelPanel.tsx:17-26`, `ResultsCompletedView.tsx:4-13`, `CompletedContent.tsx:3-9`, `JobDetail.tsx:13`, `inference/*.tsx` 等
- **結合**: Mock しづらい。MSW handlers は `test/mocks/handlers.ts` に 39 行（3 endpoint）のみ、代わりに **40 ファイルで 110回 `vi.mock`**。
- **対策**: B-6 の query hook 層を経由すれば、test では QueryClient seed か MSW だけで済む。
- **Shipped**: PR #200 Phase 1 (2026-04-19, 7 hook) + PR #201 Phase 2 (2026-04-19, 13 hook) — `src/hooks` と `src/api/queries` 外で直接 `useQuery`/`useMutation` 呼び出しゼロ。

### ✅ B-8. `?job_id=` URL param の読み書きが 2 ページで重複
- **場所**: 読み: `WorkspacePage.tsx:35-71`, `InferencePage.tsx:20-48`。書き: `InferencePage.tsx:102`, `JobDetail.tsx:138-143`
- **結合**: Workspace は意図的に書かない（reload で過去 job に戻る UX を防ぐため）が、race mitigation のため両ページで `running` フラグガードを手書き。
- **対策**: `useJobIdParam({ writeOnNavigate: true })` フックに集約、SearchParam 正規化 (`""` → `null`) と URL sync 戦略を統一。
- **Shipped**: PR #206 (2026-04-19) — `useJobIdParam` shared URL param flow。

### ✅ B-9. design-tokens.css がほぼ未活用
- **場所**: `components/ui/design-tokens.css` (185行, 48トークン) の import は 5 ファイルのみ。残りは `bg-blue-50 dark:bg-blue-950` をハードコード（例: `ResultsPanel.tsx:313`）。
- **対策**: Tailwind plugin で semantic class (`bg-info`, `text-success`) 整備、生 color class は Biome rule で禁止。
- **Shipped**: PR #219 Part 1 (H-0078, 2026-04-20) — semantic status tokens + 18 components migrated。 PR #220 (2026-04-21) — Nightly-generated visual goldens committed。 PR #221 Part 2 (H-0079, 2026-04-21) — `scripts/check-raw-colors.sh` + `raw-color-guard` CI job (grep-based、Biome に Tailwind plugin がないため採用)。

### ✅ B-10. `JobDetail.config: Record<string, unknown>` の deep cast 多発
- **場所**: `ResultsPanel.tsx:74,353-367`, `ResultsCompletedView.tsx:197,355-364`, `JobDetail.tsx:68`, `InferencePage.tsx:147-151` で `(job.config?.model as Record<string, unknown>)?.name` を 6+ 箇所で repeat。
- **対策**: backend に `JobConfig` Pydantic を追加、generated schema に出して `JobDetail.config` を strong type 化。
- **Shipped**: PR #207 (2026-04-19) — typed `JobDetail.config` accessors。

---

## 3. Cross-cutting 結合

### ✅ C-1. 型契約 drift が CI で検出されない
- **場所**: `frontend/scripts/check-api-types.sh` は存在するが CI (`ci.yml`) / pre-commit (`.pre-commit-config.yaml`) どちらでも呼ばれていない。
- **実例**: `api/models.py:144` の `JobDetailResponse.parent_job_id` が generated `schema.d.ts:1052-1124` に欠落。
- **対策**: CI に「backend 起動 → `pnpm check:api-types`」ジョブ追加、または Pydantic → OpenAPI ダンプ → コミット済み schema.d.ts と diff する pytest を作成（低コスト）。
- **Shipped**: PR #190 (2026-04-18) — `api-types-drift` CI job + 9 inference handler に `response_model=` 付与 (C-1 + C-2 合同)。

### ✅ C-2. Inference API 9 ハンドラ全部に `response_model=` が無い
- **場所**: `src/lizystudio/api/inference.py:74-260`
- **結合**: OpenAPI に型情報が一切出ず、フロント (`frontend/src/api/inference.ts:5-32`) 完全手書き。`data_ref.source_type` は TS で `string` だが backend は Literal。
- **対策**: `InferenceRecordResponse`, `PredictionsResponseModel`, `ComparisonStatsResponse` を `api/models.py` に追加し全 9 ハンドラに `response_model=` 付与。
- **Shipped**: PR #190 (2026-04-18) — 9 handler 全て `response_model=` 付与、Pydantic models `InferenceRecordResponse` / `PredictionsResponse` / `ComparisonStatsResponse` 等追加。

### ✅ C-3. WebSocket schema を 3 経路で別定義
- **場所**:
  - 送信: `ws/progress.py:64-106`
  - 受信: `frontend/src/api/types.ts:191-212`
  - JSONL parse: `services/subprocess_runner.py:362-382`
- **結合**: `progress` メッセージに backend は `current/total/message/job_id/fold_results/trial_results` を入れるが、TS は `elapsed?` と `metrics?` を持つ代わりに `job_id` がない。`ping` は backend 送出、TS ユニオンに無く try-catch 黙殺。`code` は backend error にあるが TS 型無し。
- **対策**: `ws_messages.py` に `Annotated[Union[WsProgress, WsCompleted, WsError, WsPing], Field(discriminator="type")]` Pydantic union、3経路とも `model_validate_json()` で統一。
- **Shipped**: PR #193 (H-0069, 2026-04-18) — WS Pydantic discriminated union、OpenAPI injection、frontend re-export。

### ✅ C-4. `JobSummary` / `JobDetail` が 3 箇所で重複定義
- **場所**: `api/models.py:131-150` (Pydantic) → `schema.d.ts:1052-1124` (auto) → `frontend/src/api/types.ts:105-128` (手書き)
- **結合**: 手書き側コメントは「optional `?` → required + null 化」説明だが、実は `parent_job_id` が生成 schema に無い（C-1 参照）。再生成忘れ + 手書き放置で静かに壊れる。
- **対策**: `NonNullable<T>` ヘルパで包めば JobSummary/JobDetail を手書きする必要なし。`FitResult` / `TuneResult` / `JobDetail.data_ref/model_path/config` は backend 側で `FitSummaryModel`, `TuneSummaryModel` を作り `dict[str, Any] | None` 逃げを廃止。
- **Shipped**: PR #202 (H-0071, 2026-04-19) — SSOT `JobSummary`/`JobDetail` contract、`extra="allow"` 廃止、4 types 再 export。

### ✅ C-5. UiSchema が `dict[str, Any]` で素通し
- **場所**: `backends/lizyml_ui_schema.py:build_ui_schema` → `api/backends.py:23` (`response_model` 無し) → `frontend/src/api/types.ts:262-283` (手書き)
- **結合**: 14 キー全てが TS で再表現、backend はキー名すら型で守られていない。`components/workspace/constants.ts:13-90` にフォールバック定数（`METRICS_BY_TASK`, `CV_STRATEGY_FIELDS`）があり、UiSchema とダブル真実。
- **対策**: backend に `UiSchemaResponse` Pydantic、TS は生成から re-export。`constants.ts` のフォールバックは廃止、loading state はスケルトン表示。
- **Shipped**: PR #203 Part A (H-0072, 2026-04-19) — SSOT `UiSchema` contract、22-line 手書き types 削除。 PR #210 Part B-1 (H-0074, 2026-04-20) — `METRICS_BY_TASK` 退役、`useDataPanel` が `uiSchema.capabilities.cv_default_strategy` 使用。 PR #217 Part B-2 (H-0076, 2026-04-20) — backend `cv_strategy_fields` が LizyConfig schema SSOT、frontend は `UiSchema` 経由。

### ✅ C-6. URL パスが完全手書き、prefix 変更追跡なし
- **場所**: `frontend/src/api/{jobs,inference,workspace,files}.ts` 全てで `/jobs/${id}/...` を文字列結合。`server.py:184-200` の prefix を変えても TS は無検出。
- **対策**: `openapi-fetch` など `paths` 型に基づく URL ビルダーを採用（response 型も自動同期）。
- **計画**: [docs/c6-openapi-fetch-plan.md](./c6-openapi-fetch-plan.md) に Phase 分割 (6 PR)・採用技術比較・リスク緩和策を記載（H-0080, 2026-04-21 proposal）。
- **Shipped**: PR #223 Phase 0 (plan doc) → #224 Phase 1 (files.ts) → #225 Phase 2 (inference.ts) → #226 Phase 3 (workspace.ts) → #227 Phase 4 (jobs.ts) → #228 Phase 5 (apiFetch 退役 + `no-apifetch-guard` CI + MSW typing), 2026-04-21〜22。累計 bundle +2.59 KB gzip（budget +5 KB 内）、全 5 Acceptance Criteria 達成。

### ✅ C-7. Job status 表記ゆれ `canceled` vs `cancelled`
- **場所**: backend 7 ファイル、frontend 8 ファイルに散在。`metrics.py` は `canceled`、他は `cancelled`。
- **影響**: Prometheus ラベル不一致で集計欠損の可能性。
- **対策**: `backends/types.py` に `JobStatus = Literal[...]` を一元化、grep で表記ゆれ根絶。
- **Shipped**: C-4 (PR #202) の `JobStatus = Literal["pending","running","completed","failed","cancelled"]` 統一で連鎖解消、`metrics.py:TerminalStatus = Literal["completed","failed","cancelled"]` も `cancelled` に一致。2026-04-22 verification: `grep -rn 'canceled' src frontend/src tests` = 0 件。

### ✅ C-8. SPA 404 だけ素のテキスト error
- **場所**: `server.py:218` が `HTTPException(detail="Not found")` を投げ、FastAPI 既定の `{detail:"..."}` 形式。
- **結合**: フロント `getErrorMessage` は `isStudioError` ガードを通らず `"API error 404"` になる。
- **対策**: `StudioError("NOT_FOUND", ..., 404)` に置換。`HTTPException` 使用禁止を PR レビュー規約か Ruff rule で強制。
- **Shipped**: PR #199 (2026-04-18) — `StudioError("NOT_FOUND", f"Route not found: /{full_path}", 404)` で envelope 統一。

### ✅ C-9. Format version fields 不在
- **場所**: `backends/lizyml/pickle_compat.py:30` の `PICKLE_SCHEMA_VERSION = 1` だけ。`meta.json` / config JSON にはバージョンフィールドなし。
- **対策**: 各保存物に `format_version: int` 埋め込み、`migrate_v1_to_v2` パターン準備。
- **Proposal + Shipped**: PR #229 Proposal (H-0081, 2026-04-22) → PR #230 implementation (2026-04-22) — `src/lizystudio/storage/` 新パッケージ (`STUDIO_FORMAT_VERSION = 1`, `write_versioned_json` / `read_versioned_json`, `MIGRATIONS` chain, `IncompatibleFormatVersionError`)。4 artefacts versioned (meta / fit_result / tune_result / inference/meta); `inference/metrics.json` は backend-dependent flat shape のため scope 外として明示。`model_meta.json` は H-0068 の `pickle_schema` 契約を保持。

### ✅ C-10. WS Origin allowlist ハードコード
- **場所**: `ws/progress.py:117-122` に `localhost:5173|8501`, `127.0.0.1:5173|8501` 直書き。
- **対策**: env 変数または `settings.py` 集約。
- **Shipped**: PR #199 (2026-04-18) — `LIZYSTUDIO_WS_ALLOWED_ORIGINS` env override (comma-separated) 追加。デフォルトは dev 用 hardcode 値を fallback として継続。

### ✅ C-11. CHANGELOG / API バージョンがレスポンスに無い
- `BackendInfoResponse` に backend version はあるが LizyStudio 自体のバージョンが不可視。
- **対策**: `/api/health` に `app_version` を含める。
- **Shipped**: PR #148 / #149 (Ops endpoints landing 2026-04-17) — `/api/health` が `{"status": "ok", "version": __version__}` を返す。

### ✅ C-12. `pnpm build` 出力先が backend 直書き
- `vite.config.*` → `src/lizystudio/static/`、`server.py:209-224` がそこを mount。`STATIC_DIR.is_dir()` を実行時判定のため空デプロイで 404 が無声化。
- **対策**: startup-time sanity check を追加。
- **Shipped**: PR #199 (2026-04-18) — `STATIC_DIR` startup warning 追加 (空 deploy で明示的な log 出力、silent 404 防止)。

---

## 📋 実績: Phased ロードマップ → 全完了（2026-04-17 〜 2026-04-22）

計画では 4-5 週間を想定していたが、実績は約 5 日で完了。各 Phase のデリバラブルと shipped PR:

### ✅ Phase 1 — 契約の明確化（2026-04-18 完了）
- P1-1: BackendAdapter 具体 import 排除 → PR #189 + #192 (A-1 / A-2 / A-8)
- P1-2: `training_core.py` 抽出 → PR #191 (A-3 / A-4)
- P1-3: `api-types-drift` CI ゲート化 → PR #190 (C-1)
- P1-4: Depends 統一 → PR #189 (A-8)

### ✅ Phase 2 — 契約の SSOT 化（2026-04-18〜19 完了）
- P2-1: Subprocess 契約 Pydantic 化 → PR #192 (H-0068, A-5 Protocol split も同時)
- P2-2: WebSocket schema union 化 → PR #193 (H-0069, C-3)
- P2-3: `response_model` 完全化 → PR #190 (C-2, 9 inference handler)

### ✅ Phase 3 — Frontend refactor（2026-04-18〜20 完了）
- P3-1: Query key factory + query hook 層 → PR #195 / #200 / #201 (B-6 / B-7)
- P3-2: `useJobLifecycle` / `useJobProgress` → PR #198 (B-2)
- P3-3: `useJobResultData` + `JobResultsBody` 抽出 → PR #196 (B-1)
- P3-4: ModelPanel 分割 → PR #197 (B-3)

### ✅ Phase 4 — 品質補強（2026-04-19〜22 完了）
- UiSchema Pydantic 化 → PR #203 / #210 / #217 (C-5 + B-1/B-2)
- Job status 表記統一 → PR #202 (C-4 連鎖で C-7 も解消)
- design-tokens 活用 → PR #219 / #220 / #221 (B-9 Part 1/goldens/Part 2 guard)
- format_version 導入 → PR #229 / #230 (C-9, H-0081)
- Prometheus instance-scoped → PR #211 (A-9, H-0075)
- `path_for` API → PR #205 (A-10, H-0073)

### ✅ Phase 5 — openapi-fetch 導入（2026-04-21〜22 完了）
計画当初は含まれていなかったが、C-6 追加スコープとして 6 PR (#223〜#228) で完遂:
- Plan doc + 各 fetcher の openapi-fetch 移行 + apiFetch 退役 + `no-apifetch-guard` CI (H-0080)

### その他 fold-in されたタスク
- C-8 (SPA 404 envelope) / C-10 (WS Origin env override) / C-11 (app_version in /api/health) / C-12 (STATIC_DIR startup warning): PR #148 / #149 / #199 でまとめて解消。
- B-5 (useDataPanel メガフック): PR #218 (H-0077) で `useTargetSelection` 抽出。
- A11y follow-up (outside coupling-analysis.md): PR #222 — `FeatureWeightsEditor` Switch `aria-label` 追加。

---

## 🎯 次のテーマに向けて

2026-04-17 提案分は完了。今後の coupling/quality 改善は別ドキュメントで立案する:

- **C-7 系の拡張**（仕様）: `metrics.json` に `response_model` を導入して C-9 の versioning layer に取り込めるようにする（H-0081 Implemented Decision で revisit 条件として明記済）。
- **ComparisonStats の整合**: backend `ComparisonGroupStats` 構造体 vs frontend 動的 key access の乖離は H-0080 Phase 2 Decision で scope 外として deferred。独立タスク化候補。
- **2nd ML backend 追加トライアル**: A-1..A-6 の改善効果を検証する最良の実験台。

---

## 参考: 関連 Issue

本文書で扱った結合度改善は、既存の以下 Issue とは独立した refactor 系テーマ:

- #150-#157: bugs (subprocess / WebSocket / security)
- #158: BLUEPRINT sync (docs drift)
- #159: Re-tune UI placement 決定
- #160-#163: test gaps

