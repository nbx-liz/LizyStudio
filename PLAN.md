## フェーズ一覧

| Phase | 名前 | 依存 | 状態 |
|-------|------|------|------|
| 0 | 開発環境 | — | ✅ |
| 1 | ドキュメント整備 | 0 | ✅ |
| 2 | バックエンド基盤 | 0 | ✅ |
| 3 | Data API + Workspace Data Panel | 2 | ✅ |
| 4 | Config API + Workspace Model Panel | 2 | ✅ |
| 5 | Fit/Tune 実行 + Workspace Results Panel | 3, 4 | ✅ |
| 6 | Jobs 画面 | 5 | ✅ |
| 7 | Inference 画面 | 6 | ✅ |
| 8 | WebSocket プログレス | 5 | ✅ |
| 9 | ビルド・テスト・リリース準備 | 6〜8 | ✅ |
| 10 | 監査差分ゲート整理 | 9 | ✅ |
| 11 | P0: API契約・Adapter致命不具合修正 | 10 | ✅ |
| 12 | P1: Workspace 仕様準拠 | 11 | ✅ |
| 13 | P1: Jobs 仕様準拠 | 11 | ✅ |
| 14 | P1: Inference 仕様準拠 | 11, 13 | ✅ |
| 15 | 監査クローズ（回帰テスト/E2E） | 12〜14 | ✅ |
| 16 | 再監査P0: Workspace 実行不能差分修正 | 15 | ⏳ |
| 17 | 再監査P0: API契約再整合（Jobs/Inference） | 16 | ⏳ |
| 18 | 再監査P1: 画面導線・状態遷移修正 | 17 | ⏳ |
| 19 | 再監査P1: WebSocket進捗・Cancel整備 | 17, 18 | ⏳ |
| 20 | 再監査クローズ（責務分離・回帰監査） | 19 | ⏳ |

---

## Phase 0: 開発環境 ✅

**成果物:**
- git リポジトリ初期化（develop ブランチ）
- pyproject.toml（hatchling + hatch-vcs）
- uv sync 完了
- Vite + React + TypeScript スキャフォールド
- Mantine, react-plotly.js, react-router-dom インストール
- FastAPI サーバー基本構成
- フロントエンドビルド → static 配信確認

**DoD:**
- [x] `uv run pytest` パス
- [x] `pnpm build` 成功
- [x] FastAPI が SPA + API 両方を配信できる

---

## Phase 1: ドキュメント整備 🔧

**成果物:**
- BLUEPRINT.md（画面仕様・API仕様・設計原則）
- PLAN.md（本ドキュメント）
- HISTORY.md（初期化 + 仕様不明点の Proposal）
- CLAUDE.md / AGENTS.md 更新
- skills/ 全スキルファイル配置

**DoD:**
- [ ] BLUEPRINT.md が全画面（Workspace / Jobs / Inference）・全API・設計原則を定義している
- [ ] BLUEPRINT.md の仕様不明点が HISTORY.md に Proposal として登録されている
- [ ] PLAN.md が全フェーズの依存関係・DoD を定義している
- [ ] CLAUDE.md / AGENTS.md が同一内容で、テックスタック・レイヤー責務が BLUEPRINT と整合している
- [ ] skills/ に全スキルファイルが配置されている

---

## Phase 2: バックエンド基盤

**依存:** Phase 0

**成果物:**
- Backend Adapter Protocol + 共通型（BLUEPRINT §3.3）
- LizyML Adapter 実装
- Adapter Registry
- Workspace 状態管理（BLUEPRINT §3.4.1）
- Job 状態管理 + ディスク永続化（BLUEPRINT §3.4.2〜3.4.4）
- 共通エラーハンドリング（BLUEPRINT §6）
- Workspace ステータス API（BLUEPRINT §5.2）
- CLI の `--backend` / `--jobs-dir` オプション

**SKILL:** `api-design`, `services`, `backend-adapter`, `dev-environment`

**タスク:**
1. `src/lizystudio/backends/types.py` — 共通型定義
   - `BackendInfo`, `ConfigSchema`, `FitSummary`, `TuningSummary`, `PredictionSummary`, `PlotData`
2. `src/lizystudio/backends/base.py` — `BackendAdapter` Protocol
3. `src/lizystudio/backends/registry.py` — Adapter 登録・取得
4. `src/lizystudio/backends/lizyml.py` — LizyML Adapter 実装
5. `src/lizystudio/services/workspace.py` — Workspace 状態管理
   - backend, config, data_ref, workspace_result
6. `src/lizystudio/services/jobs.py` — Job 管理
   - Job 作成・更新・一覧・詳細・削除
   - ディスク永続化（meta.json / result.json / model/）
7. `src/lizystudio/api/workspace.py` — `GET /api/workspace/status`, `POST /api/workspace/reset`
8. `src/lizystudio/api/errors.py` — 共通エラーハンドラー（BLUEPRINT §6.1）
9. `server.py` にルーターと例外ハンドラーを登録
10. `cli.py` に `--backend`, `--jobs-dir` オプション追加
11. テスト

**DoD:**
- [ ] `BackendAdapter` Protocol が定義されている
- [ ] LizyML Adapter が Protocol を満たしている
- [ ] `GET /api/workspace/status` が正しい状態を返す
- [ ] `POST /api/workspace/reset` で Workspace がクリアされる
- [ ] Job の作成・保存・読み込み・削除が動作する
- [ ] バックエンドエラーが JSON エラーレスポンスに変換される
- [ ] `uv run pytest` / `ruff check` / `mypy` パス

---

## Phase 3: Data API + Workspace Data Panel

**依存:** Phase 2

**成果物:**
- Data API の全エンドポイント（BLUEPRINT §5.2 Data）
- Workspace Data Panel（BLUEPRINT §4.2.1）
  - Data Source（パス / アップロード）
  - Target / Task（自動検出 + 手動変更）
  - Column Settings（Excl チェックボックス + Type ドロップダウン）
  - Cross Validation 設定
  - Feature Summary

**SKILL:** `api-design`, `services`, `frontend-pages`, `frontend-components`

**タスク — バックエンド:**
1. `src/lizystudio/services/data.py` — データ操作 + 自動検出ロジック
   - `load_from_path(path)` / `load_from_upload(file)` — データ読み込み
   - `preview(rows)` — 先頭N行
   - `columns()` — カラム情報（dtype, unique 数, 自動判定結果）
   - `describe()` — 数値カラムの基本統計
   - `auto_detect_task(target_col)` — Task 自動判定（閾値 `max(20, row_count × 0.05)`）
   - `auto_detect_columns(target_col)` — Categorical / ID / Const 自動判定
2. `src/lizystudio/api/workspace.py` に Data エンドポイント追加
3. テスト

**タスク — フロントエンド:**
1. `frontend/src/api/workspace.ts` — Data 系 API クライアント
2. `frontend/src/components/DataPanel.tsx` — Data Panel コンポーネント
   - 5セクション（Data Source / Target・Task / Column Settings / CV / Feature Summary）
   - Column Settings: 単一テーブル（Excl チェックボックス + Type ドロップダウン）
   - Config 自動反映（BLUEPRINT §4.2.1 トリガーフロー）
3. Workspace ページに Data Panel を組み込み

**DoD:**
- [ ] CSV / Parquet のローカルパス指定とアップロードが動作する
- [ ] Target 選択時に Task / Categorical / Excluded が自動検出される
- [ ] Column Settings テーブルで Excl / Type の手動変更ができる
- [ ] CV 設定（Method, Folds, Group column）が動作する
- [ ] Feature Summary に行数・列数・特徴量数が表示される
- [ ] Data Panel の設定変更が Config に自動反映される
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 4: Config API + Workspace Model Panel

**依存:** Phase 2

**成果物:**
- Config API の全エンドポイント（BLUEPRINT §5.2 Config）
- Workspace Model Panel（BLUEPRINT §4.2.2）
  - Sticky ヘッダー（Fit/Tune タブ + 実行ボタン）
  - Fit タブ（Model / Training / Evaluation / Calibration）
  - Tune タブ（Model / Settings / Search Space）
  - JSON Schema からの動的フォーム生成
  - Config Import / Export

**SKILL:** `api-design`, `services`, `frontend-pages`, `frontend-components`

**タスク — バックエンド:**
1. `src/lizystudio/services/config.py` — Config 操作
   - `get_schema()` — JSON Schema 取得
   - `set_config(config_dict)` — バリデーション + 保存
   - `load_from_file(content, filename)` — YAML/JSON パース
   - `export_yaml()` — Config を YAML に変換
2. `src/lizystudio/api/workspace.py` に Config エンドポイント追加
3. テスト

**タスク — フロントエンド:**
1. `frontend/src/api/workspace.ts` — Config 系 API クライアント
2. `frontend/src/components/ModelPanel.tsx` — Model Panel コンポーネント
   - Sticky ヘッダー（SegmentedControl + Action ボタン）
   - Fit タブ: Accordion セクション（Model / Training / Evaluation / Calibration）
   - Tune タブ: Model + Settings + Search Space（Mode: Fixed/Range/Choice）
   - JSON Schema → フォーム動的生成
3. `frontend/src/components/ConfigImportExport.tsx` — Import/Export UI
4. Workspace ページに Model Panel を組み込み

**DoD:**
- [ ] JSON Schema からフォームが動的に生成される
- [ ] Fit タブの全セクション（Model / Training / Evaluation / Calibration）が動作する
- [ ] Tune タブの Search Space で Mode（Fixed/Range/Choice）切替が動作する
- [ ] Calibration セクションが binary 時のみ表示される
- [ ] Config Import（YAML/JSON）/ Export（YAML）が動作する
- [ ] Fit/Tune ボタンの有効/無効条件が仕様通りか
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 5: Fit/Tune 実行 + Workspace Results Panel

**依存:** Phase 3, Phase 4

**成果物:**
- Fit/Tune 実行 API（BLUEPRINT §5.2 Fit + Job 作成）
- バックグラウンドタスク実行
- Workspace Results Panel（BLUEPRINT §4.2.3）
  - 初期状態 / Running / Fit 完了 / Tune 完了 / エラー
  - Score テーブル（IS / OOS / OOS Std）
  - Learning Curve / Plots / Accordion セクション

**SKILL:** `api-design`, `services`, `frontend-pages`, `frontend-components`

**タスク — バックエンド:**
1. `src/lizystudio/services/training.py` — 学習実行
   - `start_fit(config, data_ref)` — Job 作成 + バックグラウンド実行
   - `start_tune(config, data_ref)` — Tune Job 作成 + バックグラウンド実行
2. `src/lizystudio/api/workspace.py` に `POST /api/workspace/fit` 追加
3. Jobs API の結果参照エンドポイント（metrics / plot / importance 等）
4. テスト

**タスク — フロントエンド:**
1. `frontend/src/components/ResultsPanel.tsx` — Results Panel コンポーネント
   - 5つの状態切替（初期 / Running / Fit 完了 / Tune 完了 / エラー）
   - Score テーブル（CV 有無で OOS Std 列の表示/非表示）
   - Plotly チャート表示（Learning Curve / 評価プロット）
   - Accordion セクション（Feature Importance / Fold Details / Parameters）
   - Tune 完了: Optimization History / Best Params / Apply to Fit / Trial Results
2. `frontend/src/components/Plot.tsx` — Plotly ラッパーコンポーネント
3. Workspace ページに Results Panel を組み込み
4. Workspace 3パネルレイアウトの完成

**DoD:**
- [ ] Fit ボタンで Job が作成され、バックグラウンドで実行される
- [ ] 実行中に Results Panel に Running 状態が表示される
- [ ] Fit 完了後に Score / Learning Curve / Plots / Accordion が表示される
- [ ] Tune 完了後に Optimization History / Best Params / Trial Results が表示される
- [ ] Apply to Fit で Best Params が Fit タブに反映される
- [ ] エラー時にエラーメッセージと View Full Log が表示される
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 6: Jobs 画面

**依存:** Phase 5

**成果物:**
- Jobs API の全エンドポイント（BLUEPRINT §5.3）
- Jobs 画面（BLUEPRINT §4.3）
  - 左パネル（360px）: フィルタ + 1行ジョブリスト
  - 右パネル: ジョブ詳細（Fit/Tune 完了 / Running / Failed / 未選択）
  - アクション（Inference / Export / Re-fit / Delete / Cancel）
  - Export ダイアログ

**SKILL:** `api-design`, `services`, `frontend-pages`

**タスク — バックエンド:**
1. `src/lizystudio/api/jobs.py` — Jobs API ルーター
   - 一覧（フィルタ・ソート）、詳細、Config、メトリクス、プロット、削除、Export
2. `src/lizystudio/services/export.py` — Export 操作（Model / Report）
3. テスト

**タスク — フロントエンド:**
1. `frontend/src/api/jobs.ts` — Jobs API クライアント
2. `frontend/src/pages/JobsPage.tsx` — Jobs 画面
   - 左パネル: SegmentedControl フィルタ + Select タイプフィルタ + ジョブリスト
   - 右パネル: Workspace Results Panel のコンポーネントを再利用 + Config / Execution Log Accordion
3. `frontend/src/components/ExportDialog.tsx` — Export ダイアログ
4. `frontend/src/components/DeleteConfirmDialog.tsx` — 削除確認ダイアログ

**DoD:**
- [ ] ジョブ一覧のフィルタ（Status / Type）とソートが動作する
- [ ] ジョブ選択で右パネルに詳細が表示される（Fit/Tune/Running/Failed 全状態）
- [ ] Workspace Results Panel のコンポーネントが再利用されている
- [ ] Jobs 固有の Accordion（Config / Execution Log）が表示される
- [ ] Export（Model / Report）が動作する
- [ ] Re-fit で Config が Workspace にロードされ遷移する
- [ ] Delete で確認後にジョブが削除される
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 7: Inference 画面

**依存:** Phase 6

**成果物:**
- Inference API の全エンドポイント（BLUEPRINT §5.4）
- Inference 画面（BLUEPRINT §4.4）
  - Setup Panel: Model 選択 / Data / 正解ラベル検出 / Options / History
  - Results Panel（正解あり）: Score（IS/OOS/Inf） / Plots / Accordion
  - Results Panel（正解なし）: Predictions / Distribution / Comparison

**SKILL:** `api-design`, `services`, `frontend-pages`

**タスク — バックエンド:**
1. `src/lizystudio/services/inference.py` — 推論操作
   - `run(job_id, data, evaluate)` — 推論実行（正解あり/なし）
   - `get_result(inf_id)` — 推論結果
   - `list_history(job_id)` — 推論履歴一覧
   - `download_csv(inf_id)` — CSV 生成
2. `src/lizystudio/api/inference.py` — Inference API ルーター
3. Inference 履歴の永続化
4. テスト

**タスク — フロントエンド:**
1. `frontend/src/api/inference.ts` — Inference API クライアント
2. `frontend/src/pages/InferencePage.tsx` — Inference 画面
   - Setup Panel（左 360px）: Model Select / Data / Evaluation 検出 / SHAP / History
   - Results Panel（正解あり）: Score（IS/OOS/Inf 3列）/ Plots / Accordion
   - Results Panel（正解なし）: Predictions / Distribution / Comparison セレクタ
3. `frontend/src/components/ComparisonChart.tsx` — 分布比較プロット

**DoD:**
- [ ] Job 選択 + データ指定で推論が実行できる
- [ ] 正解ラベルの自動検出が動作する
- [ ] 正解あり: Score テーブル（IS/OOS/Inf）/ 評価プロットが表示される
- [ ] 正解なし: Predictions / Distribution / Comparison が表示される
- [ ] 推論履歴が左パネルに表示され、クリックで結果が切り替わる
- [ ] CSV ダウンロードが動作する
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 8: WebSocket プログレス

**依存:** Phase 5

**成果物:**
- WebSocket エンドポイント（BLUEPRINT §5.5）
- Workspace Results Panel のリアルタイム進捗表示
- Jobs 画面の Running ジョブ進捗表示

**SKILL:** `services`, `frontend-pages`

**タスク — バックエンド:**
1. `src/lizystudio/ws/progress.py` — WebSocket ハンドラー
   - `/ws/jobs/{job_id}/progress` — Job 進捗メッセージ配信
2. `src/lizystudio/services/training.py` — 進捗コールバック追加
   - Fit: Fold 進捗
   - Tune: Trial 進捗 + Best so far
3. `server.py` に WebSocket ルート登録

**タスク — フロントエンド:**
1. `frontend/src/api/websocket.ts` — WebSocket クライアント
2. Results Panel の Running 状態を WebSocket に切替
   - Fit: プログレスバー + Elapsed
   - Tune: Trial n/total + Best so far + Elapsed
3. Jobs 画面の Running ジョブにリアルタイム進捗反映

**DoD:**
- [ ] Fit/Tune 中にリアルタイムで進捗が表示される
- [ ] Tune で Best so far が更新される
- [ ] 完了・エラー時にメッセージが配信される
- [ ] WebSocket 切断時にポーリングフォールバックが動作する
- [ ] テストパス、Lint/TypeCheck パス

---

## Phase 9: ビルド・テスト・リリース準備

**依存:** Phase 6〜8

**成果物:**
- 全 API テストの網羅
- GitHub Actions CI 設定
- PyPI パッケージング確認

**SKILL:** `build-and-deploy`, `testing`, `release`

**タスク:**
1. テストカバレッジの確認・補完
2. `pnpm build` + `uv build` の自動化スクリプト
3. GitHub Actions CI 設定（lint / typecheck / test / build）
4. PyPI テストアップロード

**DoD:**
- [ ] 全 API エンドポイントにテストがある
- [ ] CI で lint / typecheck / test / build が通る
- [ ] `pip install` → `lizystudio` で起動 → ブラウザ操作が完結する
- [ ] PyPI テストアップロードが成功する

---

## 監査差分修正計画（2026-03-09 版）

本セクションは Requirements Audit（2026-03-09）で検出した乖離の是正計画。
BLUEPRINT を正として、実装を追従させる。

優先度方針:
- **P0:** 実行不能・API契約逸脱（500エラー、契約不一致）
- **P1:** 画面仕様・データフロー乖離
- **P2:** 監査自動化・回帰防止

前提:
- API / Adapter / 共通型 / 画面間データフロー変更は **HISTORY Proposal を先行**（AGENTS §2 準拠）
- `pnpm dev` は Node.js `20.19+` で実行する（現環境は Node 18 のため更新が必要）

---

## Phase 10: 監査差分ゲート整理

**依存:** Phase 9

**成果物:**
- 監査差分の正式トラッキング（P0/P1/P2）
- ゲート対象変更の Proposal 起票（HISTORY.md）
- 実装順序とロールバック方針の確定

**SKILL:** `spec-update`, `history-proposals`

**タスク:**
1. 監査差分を以下カテゴリで棚卸し
   - API 契約差分（`/api/jobs`, `/api/inference/*`）
   - Adapter 実行時不具合（`_config` 依存）
   - 画面仕様差分（Workspace / Jobs / Inference）
   - レイヤー責務差分（Router に業務ロジック混在）
2. HISTORY.md に Proposal を追加（例）
   - H-0006: Inference API 契約を BLUEPRINT §5.4 に合わせる
   - H-0007: Router→Service 責務再分離
   - H-0008: Job Cancel / Execution Log の API 契約補完
3. 各 Proposal の受け入れ基準を PLAN の DoD とリンク

**DoD:**
- [ ] ゲート対象変更が全て HISTORY に起票済み
- [ ] Proposal の Status が accepted になってから実装フェーズへ進む
- [ ] PLAN / BLUEPRINT / HISTORY 間で参照不整合がない

---

## Phase 11: P0 API契約・Adapter致命不具合修正

**依存:** Phase 10

**成果物:**
- `GET /api/jobs/{job_id}/plots` が 500 にならない
- `POST /api/jobs/{job_id}/export`（report）が成功
- `POST /api/inference/run` が成功
- `/api/jobs`（末尾スラッシュなし）で JSON を返す
- バリデーションエラーも共通エラー形式で返す

**SKILL:** `backend-adapter`, `api-design`, `services`, `testing`

**タスク — バックエンド:**
1. `src/lizystudio/backends/lizyml.py`
   - `available_plots()` / `model_info()` の private 属性依存（`_config`）を除去
   - `load_model()` 後でも参照可能な公開情報のみで動作させる
2. `src/lizystudio/services/inference.py`
   - Target 参照を `job.config["data"]["target"]` 起点に修正
   - 推論時のエラーメッセージを `BACKEND_ERROR` に正規化
3. `src/lizystudio/services/export.py`
   - report export 時のモデル情報取得経路を修正
4. `src/lizystudio/server.py`
   - `/api/jobs` と `/api/jobs/` の挙動を統一（常に JSON）
5. `src/lizystudio/api/errors.py`
   - `RequestValidationError` ハンドラを追加し、`{"error": ...}` 形式に統一

**タスク — テスト:**
1. `tests/test_jobs_api.py` に `GET /api/jobs`（末尾スラッシュなし）ケースを追加
2. `tests/test_inference_api.py` に run 正常系を追加
3. `tests/test_export_service.py` に report export 正常系を追加
4. `tests/test_backends_lizyml.py` に load_model 後の `available_plots/model_info` を追加

**DoD:**
- [ ] `GET /api/jobs` / `GET /api/jobs/` の両方が JSON を返す
- [ ] `GET /api/jobs/{job_id}/plots` が 200 を返す
- [ ] `POST /api/jobs/{job_id}/export`（model/report）が 200 を返す
- [ ] `POST /api/inference/run` が 200 を返す
- [ ] 422 系の入力エラーが共通エラー形式で返る

---

## Phase 12: P1 Workspace 仕様準拠

**依存:** Phase 11

**成果物:**
- Workspace が BLUEPRINT §4.2 に準拠
- Data Panel 設定が Config に自動反映
- Model Panel Tune タブが実装され、Fit/Tune ワークフローを分離
- Results Panel が IS/OOS/OOS Std + 詳細セクションを表示

**SKILL:** `frontend-pages`, `frontend-components`, `state-management`, `services`, `testing`

**タスク — フロントエンド:**
1. `frontend/src/components/DataPanel.tsx`
   - Column Settings の編集状態を永続化（`default*` 依存を廃止）
   - `GroupKFold` 選択時の Group column 入力を追加
   - Task 自動判定をフロント独自実装から除去し、API結果を使用
2. `frontend/src/components/ModelPanel.tsx`
   - sticky ヘッダー（タブ + アクション）
   - Tune タブ（Settings / Search Space / Mode: Fixed/Range/Choice）を本実装
3. `frontend/src/components/ResultsPanel.tsx`
   - Running（Fit/Tune別進捗）/ Completed / Failed を仕様通りに整理
   - Score 表を `IS / OOS / OOS Std(CV時)` で表示
   - `View Full Log` / `Cancel` を追加

**タスク — バックエンド:**
1. `src/lizystudio/services/data.py`
   - Task 自動判定閾値を BLUEPRINT ルールで一元化
2. `src/lizystudio/api/workspace.py`
   - Data Panel から Config へ反映する更新フローを追加（必要なら Proposal 後）

**DoD:**
- [ ] Data Panel 編集内容が Config `data/features/split` に反映される
- [ ] Tune タブで探索空間を GUI 操作で定義できる
- [ ] Results Panel が仕様の 4状態（初期/実行中/完了/エラー）を満たす
- [ ] CV あり/なしで Score 列表示が切り替わる

---

## Phase 13: P1 Jobs 仕様準拠

**依存:** Phase 11

**成果物:**
- Jobs 画面が BLUEPRINT §4.3 に準拠
- Running/Failed/Completed の詳細表示が仕様通り
- Re-fit / Delete / Cancel / Export の挙動を仕様に統一

**SKILL:** `frontend-pages`, `services`, `api-design`, `testing`

**タスク — フロントエンド:**
1. `frontend/src/pages/JobsPage.tsx`
   - 左リスト行に `ID / Type / Model / Score` を表示
   - Running 行の pulse と詳細進捗表示を追加
   - Failed 表示を「要約 + Full Log」に変更
2. `frontend/src/components/ExportDialog.tsx`
   - 仕様文言・初期パス・説明文を BLUEPRINT に合わせる
3. 確認ダイアログ
   - Delete / Cancel を Mantine Modal で統一

**タスク — バックエンド:**
1. `src/lizystudio/services/jobs.py`
   - 実行ログ永続化（`execution.log`）を追加
2. `src/lizystudio/api/jobs.py`
   - `GET /api/jobs/{job_id}/log`（必要なら Proposal 後）を追加
3. Re-fit 用に Job Config の Workspace 反映 API を整備（必要なら Proposal 後）

**DoD:**
- [ ] Jobs の詳細表示が状態別（Running/Completed/Failed）で仕様通り
- [ ] `Execution Log` が Accordion で閲覧できる
- [ ] Re-fit で Config を Workspace にロードして遷移する
- [ ] Delete/Cancel が確認ダイアログ経由で実行される

---

## Phase 14: P1 Inference 仕様準拠

**依存:** Phase 11, Phase 13

**成果物:**
- Inference 画面/API が BLUEPRINT §4.4 / §5.4 に準拠
- 正解あり/なしの表示分岐を実装
- 履歴・比較・CSVダウンロードの契約を統一

**SKILL:** `api-design`, `services`, `frontend-pages`, `testing`

**タスク — バックエンド:**
1. `src/lizystudio/api/inference.py`
   - `POST /run` の request body を BLUEPRINT 形式へ統一
   - `GET /history` の `job_id` を optional 化（省略時全件）
   - `GET /{inf_id}` 系から `job_id` query 依存を解消（ID解決方式を統一）
2. `src/lizystudio/services/inference.py`
   - 正解あり時の `IS/OOS/Inf` 3列メトリクス生成
   - 比較統計（Mean/Std/Positive% など）を task 別に整備
   - 評価プロットを inference 文脈で生成

**タスク — フロントエンド:**
1. `frontend/src/pages/InferencePage.tsx`
   - Setup: Path/Upload SegmentedControl、GT 検出表示、Evaluate トグル
   - Results: GT あり（Score 3列 + Plots + Accordion）/ GT なし（Predictions + Distribution + Comparison）
2. `frontend/src/api/inference.ts`
   - 新契約へ合わせてクライアント更新

**DoD:**
- [ ] `POST /api/inference/run` が BLUEPRINT request 形式で動作する
- [ ] `GET /api/inference/history` は `job_id` 省略で全件を返す
- [ ] GT ありで `IS/OOS/Inf` の 3列スコアが表示される
- [ ] GT なしで Comparison（セレクタ + 統計比較）が表示される
- [ ] Download CSV のファイル名/カラムが仕様通り

---

## Phase 15: 監査クローズ（回帰テスト/E2E）

**依存:** Phase 12〜14

**成果物:**
- BLUEPRINT 準拠の回帰テスト群
- 画面/API/責務の再監査レポート（乖離ゼロまたは残課題明示）

**SKILL:** `testing`, `requirements-audit`, `dev-environment`

**タスク:**
1. API 契約テストの追加
   - Workspace / Jobs / Inference の正常系・異常系
2. E2E テストの追加
   - Workspace: Data→Fit→Result
   - Jobs: 一覧→詳細→Export→Re-fit
   - Inference: GTあり/なしの2フロー
3. レイヤー責務監査テスト（静的チェック）
   - Router から backend 呼び出しを禁止
   - Frontend から ML ライブラリ直接参照を禁止
4. 再監査実施
   - `requirements-audit` を再実行し PLAN 完了条件を確認

**DoD:**
- [ ] `uv run pytest` が全通過
- [ ] `uv run ruff check .` / `uv run mypy src/lizystudio/` が通過
- [ ] `cd frontend && pnpm lint && pnpm build` が通過
- [ ] Requirements Audit で重大乖離（P0/P1）が 0 件

---

## 再監査差分修正計画（2026-03-09）

本計画は 2026-03-09 実施の Requirements Audit で確認した差分に対する是正フェーズ。
BLUEPRINT を正として、実装を追従させる。

優先度方針:
- **P0:** 実行不能、契約不一致、500 エラー
- **P1:** 画面仕様・導線・状態遷移の差分
- **P2:** レイヤー責務・再発防止

変更ゲート方針（AGENTS §2）:
- API 追加/変更、共通型変更、画面間データフロー変更は **実装前に HISTORY.md Proposal を先行**
- 本 PLAN 更新自体はゲート不要（ドキュメント更新）

---

## Phase 16: 再監査P0: Workspace 実行不能差分修正

**依存:** Phase 15

**成果物:**
- Data Panel 設定が BLUEPRINT §4.2.1 の `data/features/split` へ正しく反映
- Workspace からの Fit が `CONFIG_INVALID` にならず実行可能
- Target 選択時の Task 自動判定・CV デフォルトが仕様通り

**SKILL:** `spec-update`, `frontend-pages`, `state-management`, `testing`

**タスク:**
1. `frontend/src/components/DataPanel.tsx` を仕様マッピングへ修正
   - `data.target`, `task`, `features.categorical`, `features.exclude`, `split.*`
   - 既存の top-level `target/task/cv` パッチを廃止
2. Target 自動判定ロジックを API レスポンス起点で再実装
3. Workspace Fit 実行フローを E2E 相当で再検証
4. `tests/` に Data→Fit 成功ケースを追加

**DoD:**
- [ ] Data Panel の操作後に `POST /api/workspace/fit` が 200 を返す
- [ ] Target 選択時に Task が期待値で自動設定される
- [ ] CV デフォルト（binary/multiclass: StratifiedKFold, regression: KFold）が適用される
- [ ] 既存の Data Panel 関連テストが全通過する

---

## Phase 17: 再監査P0: API契約再整合（Jobs/Inference）

**依存:** Phase 16

**成果物:**
- Inference API 契約が BLUEPRINT §5.4 と整合
- Jobs Export（report）が 500 にならず成功
- エラー応答が共通フォーマットで一貫

**SKILL:** `spec-update`, `api-design`, `services`, `testing`, `history-proposals`

**タスク:**
1. **HISTORY Proposal 起票（ゲート対象）**
   - Inference API request/response 契約差分
   - 必要なら upload endpoint の責務分離
2. `src/lizystudio/api/inference.py` の契約再整合
   - `POST /run` body 形式（`data.source_type/path`）
   - `GET /history` の `job_id` optional 化
   - `GET /{inf_id}` 系の識別方式統一
3. `src/lizystudio/services/export.py` の report 出力先処理を修正
4. API テストを契約ベースで更新（正常系/異常系）

**DoD:**
- [ ] `POST /api/inference/run` が BLUEPRINT 形式で 200
- [ ] `GET /api/inference/history` が `job_id` 省略で全件返却
- [ ] `POST /api/jobs/{job_id}/export`（report）が 200
- [ ] 共通エラー形式 `{"error":{code,message,details}}` が維持される

---

## Phase 18: 再監査P1: 画面導線・状態遷移修正

**依存:** Phase 17

**成果物:**
- Jobs → Inference 導線で選択 Job が自動反映
- Inference Setup の Evaluate/GT 検出が仕様通り動作
- Jobs/Inference の表示文言・表示条件が BLUEPRINT §4.3/§4.4 と整合

**SKILL:** `frontend-pages`, `frontend-components`, `testing`

**タスク:**
1. Jobs `Inference ▸` から `job_id` を遷移状態へ渡す
2. Inference Page 初期化時に遷移元 `job_id` を自動選択
3. Evaluate トグルを run payload に反映
4. GT 検出表示を「現在入力データ」に対して表示
5. No-GT Comparison に重ね合わせ可視化（分布比較）を追加

**DoD:**
- [ ] Jobs から遷移した直後に対象 Job が選択済み
- [ ] Evaluate ON/OFF が実行結果（metrics 有無）に反映
- [ ] GT あり/なしで右パネル表示が仕様通り分岐
- [ ] No-GT で比較対象選択時に統計と分布比較が表示される

---

## Phase 19: 再監査P1: WebSocket進捗・Cancel整備

**依存:** Phase 17, Phase 18

**成果物:**
- `/ws/jobs/{job_id}/progress` で progress/completed/error が配信される
- Running UI が実データで更新される
- Cancel 操作の契約と挙動が明確化される

**SKILL:** `services`, `api-design`, `frontend-pages`, `history-proposals`, `testing`

**タスク:**
1. Progress 送信タイミングを training 実行経路で保証
2. WS keepalive 時でも completed/error を確実に受信できるようハンドリング改善
3. Cancel 仕様を確定（必要なら HISTORY Proposal 起票後に API 追加）
4. Workspace/Jobs の Running 表示を WS 主体 + polling fallback で再検証

**DoD:**
- [ ] 実行中ジョブで progress メッセージを受信できる
- [ ] ジョブ完了時に completed を受信し UI が遷移する
- [ ] エラー時に error メッセージで UI が失敗状態へ遷移する
- [ ] Cancel の有効条件と API 契約がドキュメントと一致する

---

## Phase 20: 再監査クローズ（責務分離・回帰監査）

**依存:** Phase 19

**成果物:**
- Router/Service/Adapter の責務分離を AGENTS §4/§8 に合わせて是正
- 再発防止テスト（静的 + API/E2E）
- 再監査レポート（P0/P1 差分 0 件）

**SKILL:** `services`, `requirements-audit`, `testing`, `spec-update`

**タスク:**
1. Router から backend 直接呼び出しを排除し Service 層へ移管
2. 責務違反検知テスト（Router import / 呼び出し規約）を追加
3. API 回帰 + 画面回帰（Workspace/Jobs/Inference）を実行
4. `requirements-audit` を再実施し PLAN ステータス更新

**DoD:**
- [ ] Router が backend を直接呼び出さない
- [ ] 回帰テスト一式（pytest/lint/mypy/frontend build）が通過
- [ ] 再監査で P0/P1 差分が 0 件
- [ ] 必要なドキュメント（BLUEPRINT/HISTORY/PLAN）が相互整合する
