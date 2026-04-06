## フェーズ一覧

### v1（完了）

Phase 0〜30 は v1 で完了済み。バックエンド（Python / FastAPI / Adapter 層）は BLUEPRINT 準拠で実装済み（commit `77470cf`）。

### v2 再開発フェーズ（テックスタック刷新）

バックエンドは v1 から復元して維持。フロントエンドのみ Tailwind + shadcn/ui + Biome で再構築する。

| Phase | 名前 | 依存 | 状態 |
|-------|------|------|------|
| v2-0 | v2 ドキュメント整備 | — | ✅ |
| v2-1 | バックエンド復元 + 開発環境 | v2-0 | ✅ |
| v2-2 | フロントエンド基盤（Tailwind + shadcn/ui + Biome） | v2-1 | ✅ |
| v2-3 | API 型生成（openapi-typescript） | v2-2 | ✅ |
| v2-4 | Workspace 画面 — Data Panel | v2-3 | ✅ |
| v2-5 | Workspace 画面 — Model Panel | v2-4 | ✅ |
| v2-6 | Workspace 画面 — Results Panel + WebSocket | v2-5 | ✅ |
| v2-7 | テスト基盤（Vitest + Storybook + MSW） | v2-2 | ✅ |
| v2-8 | pre-commit + CI/CD（GitHub Actions + gh-action-pypi-publish） | v2-2 | ✅ |
| v2-9 | Jobs 画面再実装 | v2-6 | ✅ |
| v2-10 | Inference 画面再実装 | v2-9 | ✅ |
| v2-11 | E2E テスト（Playwright）+ 最終監査 | v2-10, v2-7, v2-8 | ✅ |
| v2-12 | Workspace 仕様差分是正 | v2-6 | ✅ |
| v2-13 | API 契約整合（Workspace / Jobs / Inference） | v2-12 | ✅ |
| v2-14 | Jobs 画面実装（§4.3 フル準拠） | v2-13, v2-9 | ✅ |
| v2-15 | Inference 画面実装（§4.4 フル準拠） | v2-14, v2-10 | ✅ |
| v2-16 | API 型生成・テスト基盤の実運用化 | v2-15, v2-7 | ✅ |
| v2-17 | 最終統合監査（requirements-audit 再実施） | v2-16, v2-11 | ✅ |
| v2-18 | LizyML-Widget 画面仕様統合 + LizyML v0.4.0 対応 | v2-5 | ✅ |
| v2-19 | LizyML v0.4.0 対応 — export_code API（H-0027） | v2-14 | ✅ |
| v2-20 | LizyML v0.4.0 対応 — Tune 進捗コールバック（H-0028） | v2-6 | ✅ |

---

## Phase v2-0: v2 ドキュメント整備 ✅

**成果物:**
- HISTORY.md に H-0017〜H-0022（テックスタック変更 Proposal）を起票・accepted
- BLUEPRINT.md / CLAUDE.md のテックスタック記載を更新
- PLAN.md に v2 フェーズを追加

---

## Phase v2-1: バックエンド復元 + 開発環境

**依存:** v2-0

**方針:** v1 最終コミット（`77470cf`）からバックエンド Python コードを復元する。バックエンドは BLUEPRINT 準拠済みのため、コード変更は行わない。

**成果物:**
- `pyproject.toml`（v1 から復元 + pre-commit を dev deps に追加）
- `src/lizystudio/` 全ファイル（v1 から復元）
- `tests/` 全ファイル（v1 から復元）
- `uv sync` 完了
- `.pre-commit-config.yaml`（Ruff + Biome フック）

**タスク:**
1. `git checkout 77470cf -- pyproject.toml src/ tests/` でバックエンド復元
2. `pyproject.toml` に `pre-commit` を dev deps 追加
3. `uv sync` で依存解決
4. `uv run pytest` でバックエンドテスト通過確認
5. `uv run ruff check .` / `uv run mypy src/lizystudio/` 通過確認

**DoD:**
- [ ] `uv run pytest` パス
- [ ] `uv run ruff check .` パス
- [ ] `uv run mypy src/lizystudio/` パス
- [ ] `uv run lizystudio --help` が動作する

---

## Phase v2-2: フロントエンド基盤（Tailwind + shadcn/ui + Biome）

**依存:** v2-1

**成果物:**
- Vite + React 19 + TypeScript スキャフォールド
- Tailwind CSS v4 + shadcn/ui 初期化
- Biome 設定
- react-hook-form + zod
- lucide-react（アイコン）
- sonner（トースト）
- @tanstack/react-query
- react-router-dom
- react-plotly.js + plotly.js-dist-min
- 基本レイアウト（AppLayout + Sidebar）
- API クライアント基盤（`apiFetch`）

**タスク:**
1. `pnpm create vite frontend -- --template react-ts`
2. Tailwind CSS v4 セットアップ（`@tailwindcss/vite`）
3. `pnpm dlx shadcn@latest init` → 基本コンポーネント追加
   - button, input, select, checkbox, switch, dialog, accordion, tabs, table, badge, card, label, separator, dropdown-menu, progress, toast(sonner), tooltip, scroll-area, popover, command
4. `biome.json` 作成、`pnpm check` / `pnpm format` スクリプト定義
5. 依存追加: react-hook-form, zod, @hookform/resolvers, @tanstack/react-query, react-router-dom, react-plotly.js, plotly.js-dist-min, lucide-react, sonner
6. `frontend/src/lib/utils.ts`（cn ユーティリティ — shadcn/ui 標準）
7. `frontend/src/components/layout/AppLayout.tsx` — Sidebar + メインコンテンツ
8. `frontend/src/components/layout/Sidebar.tsx` — 3画面ナビゲーション
9. `frontend/src/App.tsx` — React Router + QueryClientProvider + ルーティング
10. `frontend/src/api/client.ts` — apiFetch ラッパー
11. `frontend/src/pages/WorkspacePage.tsx` — 空ページ（プレースホルダ）
12. `frontend/src/pages/JobsPage.tsx` — 空ページ
13. `frontend/src/pages/InferencePage.tsx` — 空ページ
14. Vite config に proxy 設定（`/api` → `localhost:8501`）

**DoD:**
- [ ] `pnpm build` 成功
- [ ] `pnpm check` が Biome で実行され成功
- [ ] Sidebar + 空ページのレイアウトがブラウザで確認できる
- [ ] ESLint / Mantine 関連ファイルが存在しない

---

## Phase v2-3: API 型生成（openapi-typescript）

**依存:** v2-2

**成果物:**
- openapi-typescript による型自動生成
- 生成型を使用する型安全な API クライアント

**タスク:**
1. `openapi-typescript` を devDependencies に追加
2. `pnpm generate:api` スクリプト定義
   - バックエンドサーバーを一時起動 → `/openapi.json` 取得 → 型生成 → サーバー停止
   - 生成先: `frontend/src/api/generated/schema.d.ts`
3. 型安全な API クライアント関数を生成型ベースで実装
   - `frontend/src/api/workspace.ts` — Workspace / Data API
   - `frontend/src/api/config.ts` — Config API
   - `frontend/src/api/jobs.ts` — Jobs API
   - `frontend/src/api/websocket.ts` — WebSocket クライアント
4. React Query カスタムフック（`frontend/src/hooks/`）
   - `useWorkspaceStatus`, `useDataColumns`, `useDataPreview`
   - `useConfig`, `useConfigSchema`, `useConfigValidation`
   - `useJob`, `useJobs`

**DoD:**
- [ ] `pnpm generate:api` で TypeScript 型が生成される
- [ ] API クライアントが生成型を参照している
- [ ] `pnpm build` 成功（型エラーなし）

---

## Phase v2-4: Workspace 画面 — Data Panel

**依存:** v2-3

**成果物:**
- Data Panel（BLUEPRINT §4.2.1 準拠）
  - Data Source（パス / アップロード）
  - Target / Task（自動検出 + 手動変更）
  - Column Settings テーブル（Excl + Type）
  - Cross Validation 設定
  - Feature Summary

**タスク:**
1. `frontend/src/components/workspace/DataPanel.tsx`
   - 5 セクション（Accordion 形式）
   - Data Source: Path 入力 + Load ボタン / ファイルアップロード（ドラッグ&ドロップ）
   - Target / Task: Select + 自動判定表示
   - Column Settings: shadcn Table（Checkbox + Select）
   - Cross Validation: Select（Strategy）+ Input（Folds）+ Select（Group column）
   - Feature Summary: 常時表示（数値・カテゴリ・除外の内訳）
2. Data Panel → Config 自動反映ロジック
   - Target 選択時: Task 自動判定、Column Settings 自動設定、CV デフォルト設定
   - Config フィールドへのマッピング（`data.path`, `data.target`, `data.task`, `features.*`, `split.*`）
3. `frontend/src/pages/WorkspacePage.tsx` に 3 パネルレイアウト + Data Panel 組込み

**DoD:**
- [ ] CSV パス指定 + Load でデータが読み込まれる
- [ ] Target 選択時に Task / Column Settings / CV が自動設定される
- [ ] Column Settings で Excl / Type の手動変更ができる
- [ ] Feature Summary がリアルタイム更新される
- [ ] Data Panel の設定が Config に自動反映される
- [ ] `pnpm build` + `pnpm check` 成功

---

## Phase v2-5: Workspace 画面 — Model Panel

**依存:** v2-4

**成果物:**
- Model Panel（BLUEPRINT §4.2.2 準拠）
  - Sticky ヘッダー（Fit/Tune タブ + 実行ボタン + Backend バッジ）
  - Fit タブ（JSON Schema 動的フォーム: Model / Training / Evaluation / Calibration）
  - Tune タブ（Model + Settings + Search Space）
  - Config Import / Export / Raw Config

**タスク:**
1. `frontend/src/components/workspace/ModelPanel.tsx`
   - Sticky ヘッダー: Tabs + Button + Badge
   - Backend 名・バージョンバッジ（`/api/backends` から取得）
2. `frontend/src/components/workspace/ConfigForm.tsx`
   - JSON Schema → フォーム動的生成（react-hook-form + zod）
   - 型マッピング: number→Input, boolean→Switch, enum→Select, string→Input, array→TagsInput
   - Accordion セクション（Model / Training / Evaluation / Calibration）
   - Calibration は binary 時のみ表示
3. `frontend/src/components/workspace/SearchSpace.tsx`
   - パラメータ型別 Mode（Fixed / Range / Choice）
   - Range: min/max/distribution/step
   - Choice: チップグループ
4. Config Import（YAML/JSON）/ Export（YAML）/ Raw Config（YAML モーダル）
5. Fit/Tune ボタン有効条件の実装

**DoD:**
- [ ] JSON Schema からフォームが動的生成される
- [ ] Fit タブの全セクションが動作する
- [ ] Tune タブの Search Space で Mode 切替が動作する
- [ ] Calibration が binary 時のみ表示される
- [ ] Config Import / Export / Raw Config が動作する
- [ ] Fit/Tune ボタンの有効条件が仕様通り
- [ ] `pnpm build` + `pnpm check` 成功

---

## Phase v2-6: Workspace 画面 — Results Panel + WebSocket

**依存:** v2-5

**成果物:**
- Results Panel（BLUEPRINT §4.2.3 準拠）
  - 初期状態（ガイドテキスト）
  - 実行中（プログレスバー + Fold/Trial ログ + Cancel）
  - Fit 完了（Score + Learning Curve + Plots + Accordion）
  - Tune 完了（Optimization History + Best Params + Score + Plots + Accordion）
  - エラー（エラーコード + View Full Log）
- WebSocket 進捗連携
- Workspace 3 パネルレイアウト完成

**タスク:**
1. `frontend/src/components/workspace/ResultsPanel.tsx`
   - 4 状態の切替表示
   - ヘッダー: `Fit/Tune #N — {model} — Status`
2. `frontend/src/components/workspace/ScoreTable.tsx` — IS / OOS / OOS Std
3. `frontend/src/components/workspace/PlotlyChart.tsx` — Plotly JSON ラッパー
4. `frontend/src/components/workspace/PlotSelector.tsx` — プロットセレクタ
5. Accordion セクション: Feature Importance / Fold Details / Parameters / Trial Results
6. `frontend/src/api/websocket.ts` — WebSocket 接続 + メッセージハンドリング
7. Running 状態: プログレスバー + Elapsed + Fold/Trial ログ + Cancel
8. Tune: Apply to Fit → Fit タブ切替
9. Workspace 状態ルール: ブラウザ再アクセス時は Results 空

**DoD:**
- [ ] Fit 実行 → Running → 完了 → 結果表示が動作する
- [ ] Tune 実行 → 完了 → Best Params + Apply to Fit が動作する
- [ ] WebSocket で進捗がリアルタイム更新される
- [ ] エラー時にエラーコード + View Full Log が表示される
- [ ] Cancel が動作する
- [ ] ブラウザ再アクセスで Results が空になる
- [ ] `pnpm build` + `pnpm check` 成功
- [ ] `uv run lizystudio` 起動 → ブラウザで Workspace の全操作が完結する

---

## Phase v2-7: テスト基盤（Vitest + Storybook + MSW）

**依存:** v2-2（v2-6 と並行可能）

**成果物:**
- Vitest 設定 + @testing-library/react
- Storybook 設定 + 主要コンポーネントのストーリー
- MSW ハンドラー設定

**DoD:**
- [ ] `pnpm test` が Vitest で実行され成功する
- [ ] `pnpm storybook` で Storybook が起動する
- [ ] MSW でモック API が動作する

---

## Phase v2-8: pre-commit + CI/CD

**依存:** v2-2（v2-6 と並行可能）

**成果物:**
- `.pre-commit-config.yaml`（Ruff + Biome）
- `.github/workflows/ci.yml`
- `.github/workflows/publish.yml`（pypa/gh-action-pypi-publish）

**DoD:**
- [ ] `uv run pre-commit run --all-files` 成功
- [ ] CI ワークフローが全ステップを定義
- [ ] publish ワークフローが gh-action-pypi-publish を使用

---

## Phase v2-9: Jobs 画面再実装

**依存:** v2-6

**成果物:**
- Jobs 画面（BLUEPRINT §4.3 準拠）
- Workspace Results Panel コンポーネントの再利用

**DoD:**
- [ ] BLUEPRINT §4.3 の全要素が実装されている
- [ ] フィルタ・ソート・Export・Re-fit・Delete が動作する

---

## Phase v2-10: Inference 画面再実装

**依存:** v2-9

**成果物:**
- Inference 画面（BLUEPRINT §4.4 準拠）

**DoD:**
- [ ] BLUEPRINT §4.4 の全要素が実装されている
- [ ] GT あり/なしの表示分岐が動作する

---

## Phase v2-11: E2E テスト + 最終監査

**依存:** v2-10, v2-7, v2-8

**成果物:**
- Playwright E2E テスト（主要導線 3 本）
- requirements-audit 再実行と乖離ゼロ確認
- 全品質ゲート通過

**DoD:**
- [ ] Playwright E2E テストが 3 導線で成功する
- [ ] `pnpm test` / `pnpm build` / `pnpm check` 成功
- [ ] `uv run pytest` / `uv run ruff check .` / `uv run mypy src/lizystudio/` 成功
- [ ] requirements-audit で P0/P1 差分 0 件

---

## Phase v2-12: Workspace 仕様差分是正（requirements-audit 2026-03-11）

**依存:** v2-6

**監査で確認した主な不足:**
- Data Panel の Path 入力が `TextInput + Browse` 仕様でなく `Browse` のみ
- Task が編集可能な Select ではなく Badge 表示のみ
- CV Folds が NumberInput ではなく Slider
- Model Panel ヘッダーに Backend 名/Version バッジがない
- Tune タブがプレースホルダー（Search Space UI 未実装）
- Raw Config が YAML ではなく JSON 表示
- Results Running 表示に Fold/Trial ログが不足
- `cancelled` 状態の表示分岐がない（Running 表示のまま残るケースあり）

**成果物:**
- BLUEPRINT §4.2.1 / §4.2.2 / §4.2.3 準拠の Workspace UI

**タスク:**
1. `frontend/src/components/workspace/DataPanel.tsx` を仕様準拠に修正
   - Path: `TextInput + Browse` の両方を提供
   - Task: `Select` で手動変更可能にする
   - CV Folds: `NumberInput` に置換
2. `frontend/src/components/workspace/ModelPanel.tsx` を仕様準拠に修正
   - Sticky Header に Backend badge（`lizyml vX.Y.Z`）を追加
   - Tune タブ Search Space Editor（Mode=Fixed/Range/Choice）を実装
   - Raw Config を YAML 表示に変更
3. `frontend/src/components/workspace/ResultsPanel.tsx` を仕様準拠に修正
   - Running: Fold/Trial の進捗ログ表示
   - `cancelled` 状態の明示表示（Running から遷移）
4. `frontend/src/pages/WorkspacePage.tsx` に Workspace 状態復元方針を実装
   - `workspace/status` を使った表示初期化（仕様に合わせて復元または空表示を統一）

**DoD:**
- [ ] Data Panel が §4.2.1 の入力仕様（Path/Task/Folds）を満たす
- [ ] Model Panel が §4.2.2 の Tune UI と Backend badge を満たす
- [ ] Results Panel が Running/Cancelled 表示要件を満たす
- [ ] Raw Config が YAML 表示で確認できる

---

## Phase v2-13: API 契約整合（Workspace / Jobs / Inference）

**依存:** v2-12

**注意（変更ゲート）:**
- API 変更を含むため、実装前に `HISTORY.md` へ Proposal を追加する

**監査で確認した主な不足:**
- Inference API が `job_id` query 必須（BLUEPRINT §5.4 は `{inf_id}` 単独参照）
- `DELETE /api/jobs/{job_id}` が Running でも実行可能
- `POST /api/jobs/{job_id}/export` の `report` が出力先未作成で 500 になる
- Cancel リクエスト後に `running` が長時間継続するケースあり
- `frontend/src/api/jobs.ts` が `split_summary`（underscore）を呼び 404
- `GET /api/workspace/data/describe` が `include=\"all\"` で非数値列も返す

**成果物:**
- BLUEPRINT §5.2 / §5.3 / §5.4 に準拠した API 契約

**タスク:**
1. Inference 参照系 API を `{inf_id}` 単独で解決可能にする（`job_id` query を不要化）
2. Running Job の Delete を 400 で拒否
3. Export report で出力ディレクトリを自動作成し 200 応答を保証
4. Cancel 実行後の状態遷移を保証（`running` -> `cancelled`）
5. `frontend/src/api/jobs.ts` の `split-summary` パス修正
6. `data/describe` を数値カラム統計に限定

**DoD:**
- [ ] Inference API が BLUEPRINT §5.4 のパス定義で動作する
- [ ] Running Job の Delete が拒否される
- [ ] Model / Report Export がどちらも成功する
- [ ] Cancel 後に Job が `cancelled` へ遷移する
- [ ] Jobs 画面側で Fold Details API が 404 にならない

---

## Phase v2-14: Jobs 画面実装（§4.3 フル準拠）

**依存:** v2-13, v2-9

**成果物:**
- `frontend/src/pages/JobsPage.tsx` を BLUEPRINT §4.3 準拠で実装

**タスク:**
1. 左パネル（360px 固定）: ステータス/タイプフィルタ + ジョブリスト
2. 右パネル: Workspace Results 相当 + Jobs 固有 Accordion（Config / Execution Log）
3. アクションバー: Inference / Export / Re-fit / Delete / Cancel の条件分岐
4. Export ダイアログ（Model/Report + Output Path）
5. 初回アクセス時の最新 Job 自動選択と未選択プレースホルダー

**DoD:**
- [ ] §4.3.1〜§4.3.4 の画面要素が実装される
- [ ] Running/Completed/Failed ごとの表示・操作条件が仕様通り
- [ ] Re-fit で Workspace に Config を引き継げる

---

## Phase v2-15: Inference 画面実装（§4.4 フル準拠）

**依存:** v2-14, v2-10

**成果物:**
- `frontend/src/pages/InferencePage.tsx` を BLUEPRINT §4.4 準拠で実装

**タスク:**
1. Setup Panel: Job Select / Data Source(Path+Upload) / Evaluation / SHAP / Run / History
2. Results Panel（GT あり）: Score(IS/OOS/Inf) / Plots / Predictions / SHAP / Warnings
3. Results Panel（GT なし）: Predictions / Distribution / Comparison / Download
4. History クリックで結果切替、Jobs 画面からの遷移パラメータ反映

**DoD:**
- [ ] GT あり/なしの2モードが仕様通り表示切替される
- [ ] Comparison と Download CSV が動作する
- [ ] History の表示条件（0件時は非表示）を満たす

---

## Phase v2-16: API 型生成・テスト基盤の実運用化

**依存:** v2-15, v2-7

**監査で確認した主な不足:**
- `frontend/src/api/types.ts` の手書き型を利用しており生成型を未使用
- `pnpm test` / `pnpm storybook` がプレースホルダー
- `vitest` / `storybook` / `msw` が `package.json` に未導入

**成果物:**
- 生成型ベース API クライアント + 実運用テスト基盤

**タスク:**
1. `frontend/src/api/generated/schema.d.ts` を参照する API 型へ移行
2. 手書き型（`frontend/src/api/types.ts`）を段階的に廃止
3. Vitest + MSW + Storybook の依存・設定・実行スクリプトを実装
4. API 契約テスト（Inference/job_id query 不要化、split-summary など）を追加

**DoD:**
- [ ] API クライアントが生成型を参照してビルド成功する
- [x] `pnpm test` が Vitest で実行される（89 tests passing）
- [ ] `pnpm storybook` が実際に起動する
- [x] API 契約テストで主要エンドポイントを検証できる（api-contract.test.ts）
- [x] `generate:api` スクリプトが正しい URL を参照する
- [x] CvSection 純関数テスト（cv-section.test.ts）が通過する

---

## Phase v2-17: 最終統合監査（requirements-audit 再実施）

**依存:** v2-16, v2-11

**成果物:**
- BLUEPRINT / HISTORY / AGENTS 準拠の監査完了レポート

**DoD:**
- [ ] requirements-audit で **未実装 0 / 重大乖離 0**
- [ ] Playwright 目視検証（Workspace / Jobs / Inference）を再実施
- [ ] API 実動検証（正常系/エラー系）ログを残す

---

## Phase v2-18: LizyML-Widget 画面仕様統合 + LizyML v0.4.0 対応（H-0029〜H-0032）

**依存:** v2-5（Model Panel 実装済み）
**変更ゲート:** H-0029〜H-0032（全 accepted）

**背景:** LizyML v0.4.0 対応 + LizyML-Widget の画面仕様を踏襲して BLUEPRINT を更新済み。

**成果物:**
- `pyproject.toml` のバージョン制約更新（`>=0.4.0,<0.5.0`）✅ 実施済み
- BLUEPRINT 更新 ✅ 実施済み（§4.2.1 CV, §4.2.2 Fit/Tune, §5.6 UI Schema）
- HISTORY Proposal H-0029〜H-0032 ✅ 起票・accepted 済み
- Backend: `lizyml_ui_schema.py` に capabilities, additional_params, calibration_methods, group 追加
- Frontend: Widget 準拠の全 UI コンポーネント更新

**タスク（Backend）:**
1. `lizyml_ui_schema.py` に `capabilities` セクション追加（`cv_strategies` 8種, `tune.allow_empty_space`）
2. `lizyml_ui_schema.py` に `additional_params`, `calibration_methods` リスト追加
3. `search_space_catalog` に `group` フィールド追加
4. `conditional_visibility` に `early_stopping.*` 連動条件追加
5. `calibration.n_splits` 非推奨の注記対応

**タスク（Frontend — Data Panel）:**
6. CV Strategy を 8 種 Segment buttons に拡張（`capabilities.cv_strategies` から動的）
7. Strategy ごとの条件付きフィールド実装（time_col, purge_gap, embargo, blocks/groups 等）
8. Folds を NumberInput（stepper）に変更

**タスク（Frontend — Fit タブ）:**
9. Model セクションを Smart Params / Model Params / Additional Params の3グループに分離
10. Feature Weights Editor 実装（Toggle + Multi-row editor）
11. Inner Validation の Select 表示（Training セクション内、enabled=ON 時）
12. Objective を Segment buttons に変更
13. Additional Params をカタログドロップダウン選択に変更
14. Evaluation / Calibration を `ui_schema` から動的取得に統一

**タスク（Frontend — Tune タブ）:**
15. Search Space テーブルのグループ分け表示
16. Tune 専用 Evaluation セクション追加（Optimization Metric + Additional Metrics）
17. direction 自動判定（`metric_direction` マップ）
18. Empty space 許可（Tune ボタン条件変更）
19. Fixed 値の Fit config 取り込み

**タスク（テスト）:**
20. Backend: UI schema の新フィールドテスト
21. Frontend: 新コンポーネントの Vitest テスト
22. 品質ゲート通過: `uv run pytest` + `uv run mypy` + `pnpm build` + `pnpm check`

**DoD:**
- [ ] Data Panel の CV が 8 種対応し条件付きフィールドが動的表示される
- [ ] Fit タブが Widget 準拠の3グループ構成
- [ ] Feature Weights Editor が動作する
- [ ] Tune タブが Widget 準拠の Evaluation + グループ分け
- [ ] `GET /api/backends/ui-schema` が capabilities 等を含む
- [ ] 全品質ゲート通過

---

## Phase v2-19: LizyML v0.4.0 対応 — export_code API（H-0027）

**依存:** v2-14（Jobs 画面実装後）
**変更ゲート:** H-0027（accepted 後に実装開始）

**背景:** LizyML v0.3.0 の `Model.export_code(path)` で LizyML 非依存のコードを生成可能になった。Jobs 画面から ZIP ダウンロードとして提供する。

**成果物:**
- `BackendAdapter` Protocol に `export_code()` メソッド追加
- `POST /api/jobs/{job_id}/export-code` エンドポイント
- Jobs 画面 Export セクションに「Export Code」ボタン

**タスク:**
1. `src/lizystudio/backends/base.py` — `export_code(model, path) -> str` メソッド追加
2. `src/lizystudio/backends/lizyml.py` — `model.export_code(path)` 呼び出し実装
3. `src/lizystudio/services/export.py` — `export_code_as_zip()` サービス関数
4. `src/lizystudio/api/jobs.py` — `POST /api/jobs/{job_id}/export-code` エンドポイント（ZIP レスポンス）
5. Frontend: Jobs 画面 Export ダイアログに「Export Code」オプション追加
6. テスト: Adapter / API / Service 各層のテスト
7. 品質ゲート通過

**DoD:**
- [ ] `POST /api/jobs/{job_id}/export-code` が ZIP を返す
- [ ] ZIP に `train.py`, `predict.py`, `requirements.txt` が含まれる
- [ ] Jobs 画面から Export Code がダウンロードできる
- [ ] `uv run pytest` + `uv run mypy` + `pnpm build` 通過

---

## Phase v2-20: LizyML v0.4.0 対応 — Tune 進捗コールバック（H-0028）

**依存:** v2-6（Results Panel + WebSocket 実装後）
**変更ゲート:** H-0028（accepted 後に実装開始）

**背景:** LizyML v0.1.3 の `TuneProgressInfo` を使い、Trial 単位の進捗をリアルタイムで WebSocket に配信する。

**成果物:**
- `LizyMLAdapter.tune()` が Trial 単位で `on_progress` を呼び出す

**タスク:**
1. `src/lizystudio/backends/lizyml.py` の `tune()` 内で `model.tune(progress_callback=fn)` を使用
2. `TuneProgressInfo.current_trial` / `total_trials` を `ProgressCallback` の `current` / `total` にマッピング
3. `message` に `best_score`, `latest_score`, `latest_state` を含める
4. テスト: モック `TuneProgressInfo` で `on_progress` 呼び出し回数を検証
5. 品質ゲート通過

**DoD:**
- [ ] Tune 実行中に Trial 単位の進捗が WebSocket に送信される
- [ ] Results Panel のプログレスバーが Trial 単位で更新される
- [ ] 既存テストが壊れない
