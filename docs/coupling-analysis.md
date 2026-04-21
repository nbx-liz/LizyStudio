# LizyStudio 疎結合化 改善提案

**作成日**: 2026-04-17
**目的**: 今後のメンテナンス・保守・運用・機能追加をスムーズにするための結合度改善の解析。
**前提**: [docs/architecture-as-implemented.md](./architecture-as-implemented.md) で把握した現行アーキテクチャを基準。
**Issue 化方針**: 本文書のみ（C案）。Issue 化は後日判断。

---

## 🎯 Executive Summary — 最優先 Top 7

| # | 改善 | 効果 | 工数 |
|---|---|---|---|
| 1 | Backend: BackendAdapter を capability 別に分割 + lizyml 具体 import を API/Service から排除 | 2nd backend 追加の工数 5日→1日 | 1.5日 |
| 2 | Backend: `services/_training_core.py` 抽出 + `WorkspaceState` メソッド化 | 循環的 import と 12箇所の `ws._lock` 外部アクセス除去 | 1日 |
| 3 | Backend: Subprocess 契約を Pydantic discriminated union で SSOT 化 | parent/child/WS の3重定義を1箇所に | 1.5日 |
| 4 | Frontend: Query key factory + query hook 層 (`api/queries/useJob.ts` 等) | invalidate抜け / mock散在を根絶、50+ 箇所の文字列キー撲滅 | 2日 |
| 5 | Frontend: `useJobLifecycle` / `useJobProgress` 抽出 + Results 描画の単一化 | ResultsPanel(368L) と JobDetail(480L) の二重状態機械を解消 | 2日 |
| 6 | Cross: `pnpm generate:api` を CI ゲート化 + `response_model` 完全化 | `parent_job_id` 欠落のような契約 drift を再発防止 | 0.5日 |
| 7 | Cross: WebSocket schema を Pydantic discriminated union 化 | backend / frontend / JSONL の3経路を1型で統一 | 1日 |

合計 ~10 working days、各 1-2 PR で独立リリース可。

---

## 1. Backend 結合

### 🔴 A-1. Adapter specific import のリーク
- **場所**: `src/lizystudio/api/retune.py:126-131`, `services/training.py:388-392`
- **結合**: HTTP ルーターが `PickleIncompatibleError` / `verify_pickle_compatibility` を `backends.lizyml` から直接 import。`model_meta.json` の存在とフォーマットまで知っている。
- **影響**: 2nd backend は `BackendAdapter` を満たすだけでなく、この pickle-meta sidecar までサポートしないと動かない。
- **対策**: `BackendAdapter.verify_checkpoint_compatibility(path) -> None` を追加、`CheckpointIncompatibleError` を `backends/types.py` に宣言。API は backend 名を知らずに済む。

### 🔴 A-2. adapter → service の逆向き依存
- **場所**: `backends/lizyml/lifecycle_mixin.py:95` — `from lizystudio.services.training import CancelledError`
- **結合**: Adapter が service 層の例外型を import。`base.py:34-37` の「adapter は persistence/HTTP/session を知らない」という documented contract 違反。
- **対策**: `CancelledError` を `backends/types.py`（または新規 `backends/exceptions.py`）へ移動し、`services.training` は re-export のみ。

### 🟠 A-3. `training.py` ⇄ `training_retune.py` の循環的 import
- **場所**: `services/training.py:653-660` が `training_retune` から re-export、`training_retune.py:28-34` が `training` から 5 つの private symbol を import、`:171` で lazy 再 import。
- **結合**: 論理的に 1 モジュールを 2 ファイルに分割した状態で、循環 import を lazy import で回避している。
- **対策**: `services/_training_core.py`（または `JobRunner` クラス）を抽出し、`_run_job_core`, `_join_previous_thread`, `_prepare_autofit_config`, `_save_tuning_plot`, `_run_pickle_preflight` を移動。両側は core からのみ import。

### 🟠 A-4. `WorkspaceState` の private 属性を外から触る
- **場所**: `services/training.py:465,518,543,593,600,633,640`, `training_retune.py:146,267,293,333` — 合計 12箇所で `with ws._lock: ... ws._job_thread = t`
- **結合**: `_lock` / `_job_thread` は private 命名だが、唯一の書き手が外部。encapsulation が形骸化。
- **対策**: `WorkspaceState.register_job_thread(t)`, `previous_job_thread()`, `record_completion(fit, tune, job_id)`, `note_current_job(id)` をメソッド化し、外部 `with ws._lock` を削除。

### 🟡 A-5. BackendAdapter Protocol が広すぎる（22メソッド）
- **場所**: `backends/base.py:31-201`
- **結合**: 2nd backend 実装時に `export_code` / `confusion_matrix` / `importance_kinds` / `learning_curve_metrics` / `get_ui_schema` まで全部必要。
- **対策**: `BackendAdapter` (lifecycle + types) + `Evaluator` + `Plotter` + `CodeExporter` + `Checkpointer` に分割、capability 判定は `hasattr` または明示的な `adapter.evaluator()` で。Phase 1 は Protocol 宣言の分割のみで可。

### 🟡 A-6. `_ADAPTERS` レジストリがハードコード
- **場所**: `backends/registry.py:8-10`
- **結合**: dict の値型が `type[LizyMLAdapter]` なので新バックエンド追加は型エラー。plugin discovery なし。
- **対策**: 型を `dict[str, Callable[[], BackendAdapter]]` に緩和、`register_backend(name, factory)` 公開、将来 `importlib.metadata.entry_points("lizystudio.backends")` 対応。

### 🟡 A-7. `services/jobs.py` が 661行の God Module
- **場所**: `services/jobs.py:574-661` に persistence と adapter-dispatch helper が混在。
- **対策**: `services/job_results.py` に `load_job_model`, `get_metrics_table`, `get_importance` 等を移動。model load を LRU キャッシュ化。

### 🟡 A-8. 隠れたシングルトン アクセスが不統一
- **場所**:
  - Depends 経由: `services/workspace.py:87` の `get_workspace`
  - 直接 attribute peek: `api/backends.py:17,25` / `api/health.py:45`
  - `ProgressBroadcaster`: `api/workspace.py:507`, `api/retune.py:159` にそれぞれ `_get_broadcaster(request)` 重複定義、`server.py:205` で直接読み
- **対策**: `get_workspace`, `get_backend`, `get_broadcaster`, `get_inference_store`, `get_job_store` を `Depends()` に統一。3 つの重複ヘルパを削除。

### 🟡 A-9. Prometheus メトリクスが module-level global
- **場所**: `metrics.py:24-77`
- **結合**: pytest で 2 つの app を同 process 内で作れない（Counter 再登録エラー）。`ACTIVE_JOBS.set(0)` が process-wide。
- **対策**: `MetricsRegistry` を `app.state.metrics` にぶら下げ、test fixture で fresh registry。

### 🟡 A-10. Service が disk path を文字列で生成
- **場所**: `training.py:190,216,413,427,435`, `jobs.py:628` — `jobs_dir / job_id / "tuning_plot.json"` を別モジュールで独立に組み立て。
- **対策**: `JobStore.path_for(job_id, kind: Literal["model","log","tuning_plot","checkpoint"])` を追加。

---

## 2. Frontend 結合

### 🔴 B-1. ResultsCompletedView と CompletedContent の二重実装
- **場所**: `components/workspace/ResultsCompletedView.tsx` (365行) と `components/jobs/CompletedContent.tsx` (264行)
- **結合**: ほぼ同一の 8-10 個 useQuery (`job-plots`, `job-plot/learning-curve`, `job-importance-kinds`, `job-importance`, `job-split-summary`, `job-plot/tuning`)、`lcMetric` / `importanceKind` state、`annotateMetric` ヘルパを独立保持。既に drift 発生（LC metrics 取得元が違う、lineage は ResultsCompletedView にしかない）。
- さらに `jobs/ExportDialog.tsx:14`, `inference/{SetupPanel,ResultsPredOnly,ResultsWithGT}.tsx` が `@/components/workspace/{FileBrowser,PlotlyChart}` を直接 import — `jobs/` / `inference/` → `workspace/` の逆向き依存。
- **対策**: `components/shared/JobResultsView` + `useJobResultData(jobId)` フック抽出。`FileBrowser` / `PlotlyChart` / `PlotSection` を `components/shared/` へ物理移動。

### 🔴 B-2. ResultsPanel と JobDetail で状態機械二重実装
- **場所**: `components/workspace/ResultsPanel.tsx:35-320` (368行), `components/jobs/JobDetail.tsx:44-310` (480行)
- **結合**: 両者が `useState<ProgressMessage>`, `connectJobProgress` useEffect, `prevStatusRef` polling fallback, `cancelJob` handler を別実装。terminal-state 検出ロジックすら微妙に違う（ResultsPanel は `prev === undefined` も拾うが JobDetail は `prev === 'running'` のみ）。
- `_computeRemainingTrials` (ResultsPanel.tsx:352) と `_defaultRetuneTrials` (ResultsCompletedView.tsx:354) は同じ `config.tuning.optuna.params.n_trials` パスを掘る双子。
- **対策**: `useJobLifecycle(jobId)` フック（status + cancel + invalidate）と `useJobProgress(jobId)` フック（WebSocket 接続共有、`Map<jobId, Subject>` で多重購読防止）を抽出。`config` から trials を取り出すヘルパは `lib/job-config.ts` に統合。

### 🟠 B-3. ModelPanel が God Component (476行)
- **場所**: `components/workspace/ModelPanel.tsx:58-476`
- **結合**: 5 個の useQuery, debounce validation, history (undo/redo), preset save/load, import/export, tuneEnabled 計算 (`tuning.optuna.space` を 5 段ネスト掘る `:222-228`), sticky ヘッダ/footer JSX を全て 1 関数に。
- **対策**: `useModelPanelData()` + `ModelPanelHeader` + `ModelPanelActions` + `ConfigEditorBody` に分割。

### 🟠 B-4. Hook → Component の逆向き import
- **場所**: `hooks/useConfigSync.ts:8-14` が `@/components/workspace/CvSection` から `applyCvDataFields`, `buildSplitConfig`, `recommendedInnerValid` を import
- **結合**: hook が component に依存。component 側改修で hook テストが折れる。
- **対策**: `cv-state.ts`（既存）を SSOT 化し、hook も component もここから import。

### 🟠 B-5. `useDataPanel` メガフック化
- **場所**: `hooks/useDataPanel.ts:41-201`（26 戻り値）
- **結合**: `useColumnOverrides` / `useDataLoad` / `useConfigSync` 統括に加え、`handleTargetChange` で fetch + state + suppress flag + `requestAnimationFrame` blur 操作まで。
- **対策**: orchestration のみに削り、target 変更時ロジックは `useTargetSelection` mutation hook に分離。

### 🟠 B-6. Query key factory 不在、invalidate 散在
- **場所**: `["jobs"]`, `["job", id]`, `["job-plot", id, type]` など 50+ 箇所に文字列直書き。`invalidateQueries` は 16 箇所に散在。
- **影響**: RetuneActionButton は invalidate するが他のいくつかは未対応。新 endpoint 追加時に「何を invalidate するか」が散らばる。
- **対策**: `api/queryKeys.ts` factory（`jobKeys.list()`, `jobKeys.detail(id)`, `jobKeys.plot(id, kind)`）と `api/queries/useJob.ts` thin wrapper hook を導入。component は `useJob(id)` のみ呼ぶ。

### 🟡 B-7. Component が `api/*` を直接呼ぶ (19ファイル)
- **場所**: `ModelPanel.tsx:17-26`, `ResultsCompletedView.tsx:4-13`, `CompletedContent.tsx:3-9`, `JobDetail.tsx:13`, `inference/*.tsx` 等
- **結合**: Mock しづらい。MSW handlers は `test/mocks/handlers.ts` に 39 行（3 endpoint）のみ、代わりに **40 ファイルで 110回 `vi.mock`**。
- **対策**: B-6 の query hook 層を経由すれば、test では QueryClient seed か MSW だけで済む。

### 🟡 B-8. `?job_id=` URL param の読み書きが 2 ページで重複
- **場所**: 読み: `WorkspacePage.tsx:35-71`, `InferencePage.tsx:20-48`。書き: `InferencePage.tsx:102`, `JobDetail.tsx:138-143`
- **結合**: Workspace は意図的に書かない（reload で過去 job に戻る UX を防ぐため）が、race mitigation のため両ページで `running` フラグガードを手書き。
- **対策**: `useJobIdParam({ writeOnNavigate: true })` フックに集約、SearchParam 正規化 (`""` → `null`) と URL sync 戦略を統一。

### 🟡 B-9. design-tokens.css がほぼ未活用
- **場所**: `components/ui/design-tokens.css` (185行, 48トークン) の import は 5 ファイルのみ。残りは `bg-blue-50 dark:bg-blue-950` をハードコード（例: `ResultsPanel.tsx:313`）。
- **対策**: Tailwind plugin で semantic class (`bg-info`, `text-success`) 整備、生 color class は Biome rule で禁止。

### 🟡 B-10. `JobDetail.config: Record<string, unknown>` の deep cast 多発
- **場所**: `ResultsPanel.tsx:74,353-367`, `ResultsCompletedView.tsx:197,355-364`, `JobDetail.tsx:68`, `InferencePage.tsx:147-151` で `(job.config?.model as Record<string, unknown>)?.name` を 6+ 箇所で repeat。
- **対策**: backend に `JobConfig` Pydantic を追加、generated schema に出して `JobDetail.config` を strong type 化。

---

## 3. Cross-cutting 結合

### 🔴 C-1. 型契約 drift が CI で検出されない
- **場所**: `frontend/scripts/check-api-types.sh` は存在するが CI (`ci.yml`) / pre-commit (`.pre-commit-config.yaml`) どちらでも呼ばれていない。
- **実例**: `api/models.py:144` の `JobDetailResponse.parent_job_id` が generated `schema.d.ts:1052-1124` に欠落。
- **対策**: CI に「backend 起動 → `pnpm check:api-types`」ジョブ追加、または Pydantic → OpenAPI ダンプ → コミット済み schema.d.ts と diff する pytest を作成（低コスト）。

### 🔴 C-2. Inference API 9 ハンドラ全部に `response_model=` が無い
- **場所**: `src/lizystudio/api/inference.py:74-260`
- **結合**: OpenAPI に型情報が一切出ず、フロント (`frontend/src/api/inference.ts:5-32`) 完全手書き。`data_ref.source_type` は TS で `string` だが backend は Literal。
- **対策**: `InferenceRecordResponse`, `PredictionsResponseModel`, `ComparisonStatsResponse` を `api/models.py` に追加し全 9 ハンドラに `response_model=` 付与。

### 🔴 C-3. WebSocket schema を 3 経路で別定義
- **場所**:
  - 送信: `ws/progress.py:64-106`
  - 受信: `frontend/src/api/types.ts:191-212`
  - JSONL parse: `services/subprocess_runner.py:362-382`
- **結合**: `progress` メッセージに backend は `current/total/message/job_id/fold_results/trial_results` を入れるが、TS は `elapsed?` と `metrics?` を持つ代わりに `job_id` がない。`ping` は backend 送出、TS ユニオンに無く try-catch 黙殺。`code` は backend error にあるが TS 型無し。
- **対策**: `ws_messages.py` に `Annotated[Union[WsProgress, WsCompleted, WsError, WsPing], Field(discriminator="type")]` Pydantic union、3経路とも `model_validate_json()` で統一。

### 🟠 C-4. `JobSummary` / `JobDetail` が 3 箇所で重複定義
- **場所**: `api/models.py:131-150` (Pydantic) → `schema.d.ts:1052-1124` (auto) → `frontend/src/api/types.ts:105-128` (手書き)
- **結合**: 手書き側コメントは「optional `?` → required + null 化」説明だが、実は `parent_job_id` が生成 schema に無い（C-1 参照）。再生成忘れ + 手書き放置で静かに壊れる。
- **対策**: `NonNullable<T>` ヘルパで包めば JobSummary/JobDetail を手書きする必要なし。`FitResult` / `TuneResult` / `JobDetail.data_ref/model_path/config` は backend 側で `FitSummaryModel`, `TuneSummaryModel` を作り `dict[str, Any] | None` 逃げを廃止。

### 🟠 C-5. UiSchema が `dict[str, Any]` で素通し
- **場所**: `backends/lizyml_ui_schema.py:build_ui_schema` → `api/backends.py:23` (`response_model` 無し) → `frontend/src/api/types.ts:262-283` (手書き)
- **結合**: 14 キー全てが TS で再表現、backend はキー名すら型で守られていない。`components/workspace/constants.ts:13-90` にフォールバック定数（`METRICS_BY_TASK`, `CV_STRATEGY_FIELDS`）があり、UiSchema とダブル真実。
- **対策**: backend に `UiSchemaResponse` Pydantic、TS は生成から re-export。`constants.ts` のフォールバックは廃止、loading state はスケルトン表示。

### 🟠 C-6. URL パスが完全手書き、prefix 変更追跡なし
- **場所**: `frontend/src/api/{jobs,inference,workspace,files}.ts` 全てで `/jobs/${id}/...` を文字列結合。`server.py:184-200` の prefix を変えても TS は無検出。
- **対策**: `openapi-fetch` など `paths` 型に基づく URL ビルダーを採用（response 型も自動同期）。
- **計画**: [docs/c6-openapi-fetch-plan.md](./c6-openapi-fetch-plan.md) に Phase 分割 (6 PR)・採用技術比較・リスク緩和策を記載（H-0080, 2026-04-21 proposal）。

### 🟠 C-7. Job status 表記ゆれ `canceled` vs `cancelled`
- **場所**: backend 7 ファイル、frontend 8 ファイルに散在。`metrics.py` は `canceled`、他は `cancelled`。
- **影響**: Prometheus ラベル不一致で集計欠損の可能性。
- **対策**: `backends/types.py` に `JobStatus = Literal[...]` を一元化、grep で表記ゆれ根絶。

### 🟡 C-8. SPA 404 だけ素のテキスト error
- **場所**: `server.py:218` が `HTTPException(detail="Not found")` を投げ、FastAPI 既定の `{detail:"..."}` 形式。
- **結合**: フロント `getErrorMessage` は `isStudioError` ガードを通らず `"API error 404"` になる。
- **対策**: `StudioError("NOT_FOUND", ..., 404)` に置換。`HTTPException` 使用禁止を PR レビュー規約か Ruff rule で強制。

### 🟡 C-9. Format version fields 不在
- **場所**: `backends/lizyml/pickle_compat.py:30` の `PICKLE_SCHEMA_VERSION = 1` だけ。`meta.json` / config JSON にはバージョンフィールドなし。
- **対策**: 各保存物に `format_version: int` 埋め込み、`migrate_v1_to_v2` パターン準備。

### 🟡 C-10. WS Origin allowlist ハードコード
- **場所**: `ws/progress.py:117-122` に `localhost:5173|8501`, `127.0.0.1:5173|8501` 直書き。
- **対策**: env 変数または `settings.py` 集約。

### 🟡 C-11. CHANGELOG / API バージョンがレスポンスに無い
- `BackendInfoResponse` に backend version はあるが LizyStudio 自体のバージョンが不可視。
- **対策**: `/api/health` に `app_version` を含める。

### 🟡 C-12. `pnpm build` 出力先が backend 直書き
- `vite.config.*` → `src/lizystudio/static/`、`server.py:209-224` がそこを mount。`STATIC_DIR.is_dir()` を実行時判定のため空デプロイで 404 が無声化。
- **対策**: startup-time sanity check を追加。

---

## 📋 段階的ロードマップ

### Phase 1（1週間） — 契約の明確化
- P1-1: BackendAdapter 具体 import 排除（A-1 / A-2）
- P1-2: `training_core.py` 抽出（A-3 / A-4）
- P1-3: `pnpm check:api-types` を CI ゲート化（C-1）
- P1-4: Depends 統一（A-8 の下準備）

### Phase 2（1週間） — 契約の SSOT 化
- P2-1: Subprocess 契約 Pydantic 化（Top 3）
- P2-2: WebSocket schema union 化（C-3）
- P2-3: `InferenceRecordResponse` など `response_model` 完全化（C-2）

### Phase 3（1-2週間） — Frontend refactor
- P3-1: Query key factory + query hook 層（B-6）
- P3-2: `useJobLifecycle` / `useJobProgress`（B-2）
- P3-3: `shared/JobResultsView` 抽出（B-1）
- P3-4: ModelPanel 分割（B-3）

### Phase 4（継続的） — 品質補強
- UiSchema Pydantic 化（C-5）
- status 表記統一（C-7）
- design-tokens 活用（B-9）
- format version 導入（C-9）
- Prometheus instance-scoped（A-9）
- path_for API（A-10）

---

## 参考: 関連 Issue

本文書で扱った結合度改善は、既存の以下 Issue とは独立した refactor 系テーマ:

- #150-#157: bugs (subprocess / WebSocket / security)
- #158: BLUEPRINT sync (docs drift)
- #159: Re-tune UI placement 決定
- #160-#163: test gaps

