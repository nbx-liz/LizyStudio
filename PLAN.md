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
