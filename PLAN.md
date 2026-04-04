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

### v3 機能拡張フェーズ（H-0035〜H-0053）

バックエンド基盤強化 → API 拡張 → フロントエンド UX 改善の順序で実施する。

| Phase | 名前 | 対象 Proposal | 依存 | 状態 |
|-------|------|--------------|------|------|
| v3-1 | バックエンド基盤強化（スレッド管理 + セキュリティ） | H-0038, H-0039, H-0040, H-0042 | — | ✅ |
| v3-2 | OpenMP デーモンスレッド劣化対策 | H-0036 | v3-1 | ✅ |
| v3-3 | API 拡張（Config パッチ + エラーコード） | H-0037, H-0041 | v3-1 | ✅ |
| v3-4 | WebSocket 再接続 + Fold 進捗表示 | H-0035, H-0047 | v3-1 | ✅ |
| v3-5 | openapi-typescript 生成型の実活用 | H-0043 | v3-3 | 🔲 |
| v3-6 | Workspace UX 改善（Config ロック + セグメントボタン） | H-0048, H-0049 | v3-4 | 🔲 |
| v3-7 | カラム値分布バー + CV Fold Preview | H-0044, H-0046 | v3-5 | 🔲 |
| v3-8 | BlockedGroupKFold 専用 2軸エディタ | H-0045 | v3-7 | 🔲 |
| v3-9 | Jobs 詳細画面の統一（KPI + LC フィルター + Importance） | H-0050, H-0051, H-0052 | v3-5 | 🔲 |
| v3-10 | Search Space デフォルト Range 自動ポピュレート | H-0053 | v3-3 | 🔲 |

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

---

# v3 機能拡張フェーズ

v2 で構築した基盤の上に、Widget 運用知見の移植・UX 改善・セキュリティ強化を行う。

---

## Phase v3-1: バックエンド基盤強化（スレッド管理 + セキュリティ）

**対象:** H-0038, H-0039, H-0040, H-0042

**依存:** なし（v2 完了が前提）

**方針:** 後続フェーズの土台となるバックエンド品質改善をまとめて実施。スレッド管理の安定化、メモリ保護、HTTP セキュリティヘッダー、セキュリティ方針文書化の 4 本を並行で進める。

**成果物:**
- `WorkspaceState._job_thread` によるスレッド join 保証（H-0040）
- DataFrame メモリ上限チェック（H-0038）
- CSP / X-Content-Type-Options / X-Frame-Options ミドルウェア（H-0039）
- BLUEPRINT.md §7 セキュリティ方針セクション（H-0042）

**タスク:**
1. **H-0040: ワーカースレッド join 漏れ対策**
   1. `WorkspaceState` に `_job_thread: threading.Thread | None` フィールドを追加
   2. `start_fit_async` / `start_tune_async` の冒頭で `_job_thread.join(timeout=5)` を実行
   3. join タイムアウト時のログ警告を追加
   4. `cancel_requested` 時にもスレッド参照を保持
   5. テスト: 連続 Fit でスレッドリソースが蓄積しないことを検証
2. **H-0038: DataFrame メモリ上限チェック**
   1. `security.py` に `check_dataframe_memory(df, max_bytes)` を追加
   2. `load_dataframe` 後に `df.memory_usage(deep=True).sum()` でチェック
   3. 環境変数 `LIZYSTUDIO_MAX_DF_MEMORY` 対応（デフォルト 2GB）
   4. 上限超過時は `FileInvalidError` を raise（ファイルサイズ + メモリ使用量をメッセージに含む）
   5. `/api/workspace/data/load` レスポンスに `memory_usage_bytes` を追加
   6. テスト: 上限超過データと正常データの両方を検証
3. **H-0039: CSP ヘッダー追加**
   1. `server.py` に CSP ミドルウェアを追加
   2. 本番モード CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:*; img-src 'self' data: blob:; font-src 'self'`
   3. `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY` を同時追加
   4. 開発モード（`--reload`）では CSP を緩和（HMR 対応）
   5. テスト: レスポンスヘッダーの検証 + Plotly レンダリングが CSP でブロックされないことを確認
4. **H-0042: セキュリティ方針文書化**
   1. BLUEPRINT.md に §7 セキュリティ方針セクションを追加
   2. YAML パース方針、ファイルアップロード手順、入力バリデーション、HTTP ヘッダー、localhost 前提の制限緩和を記載
5. 品質ゲート通過（`uv run pytest` + `uv run ruff check .` + `uv run mypy src/lizystudio/`）

**DoD:**
- [ ] 連続 Fit でスレッドが蓄積しない（`threading.active_count()` が安定）
- [ ] メモリ上限超過データで `FileInvalidError` が返る
- [ ] 本番モードで CSP / X-Content-Type-Options / X-Frame-Options ヘッダーが付与される
- [ ] 開発モードで HMR が正常動作する
- [ ] BLUEPRINT.md §7 にセキュリティ方針が記載されている
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-2: OpenMP デーモンスレッド劣化対策

**対象:** H-0036

**依存:** v3-1（H-0040 のスレッド join 基盤が前提）

**方針:** OpenMP 検出時にサブプロセスベースのジョブワーカーにフォールバック。Widget の `subprocess_runner.py` パターンを移植する。

**成果物:**
- OpenMP 検出ユーティリティ（`services/openmp_detect.py`）
- サブプロセスジョブワーカー（`services/subprocess_runner.py`）
- `LIZYSTUDIO_FORCE_SUBPROCESS` 環境変数サポート

**タスク:**
1. `services/openmp_detect.py` を新規作成: `libomp.so` / `libgomp.so` の存在チェック関数
2. `services/subprocess_runner.py` を新規作成: テンポラリファイル経由で結果を返却するサブプロセスワーカー
3. `services/training.py` の `start_fit_async` / `start_tune_async` を修正: OpenMP 検出時または `LIZYSTUDIO_FORCE_SUBPROCESS=1` 時にサブプロセスワーカーを使用
4. サブプロセスワーカーの進捗コールバック統合（WebSocket への進捗転送）
5. テスト: `LIZYSTUDIO_FORCE_SUBPROCESS=1` でのフルフロー検証
6. 品質ゲート通過

**DoD:**
- [ ] `LIZYSTUDIO_FORCE_SUBPROCESS=1` でサブプロセスモードが強制される
- [ ] サブプロセスモードで Fit/Tune が正常完了する
- [ ] 進捗が WebSocket に転送される
- [ ] 非 OpenMP 環境で既存動作が維持される
- [ ] 既存テストが全パス

---

## Phase v3-3: API 拡張（Config パッチ + エラーコード）

**対象:** H-0037, H-0041

**依存:** v3-1（セキュリティ基盤が前提）

**方針:** API の表現力を拡張する。Config パッチプロトコル（PATCH エンドポイント）とエラーコード拡充を実施。

**成果物:**
- `PATCH /api/workspace/config` エンドポイント（set / unset / merge op）
- `CONFIG_BUILD_ERROR`、`CONFIG_IMPORT_ERROR`、`EXPORT_ERROR` エラーコード

**タスク:**
1. **H-0037: Config パッチプロトコル**
   1. `services/workspace.py` にパッチ適用ロジックを追加（`apply_config_patch`）
   2. パスバリデーション: 正規表現 + dunder 拒否
   3. `api/workspace.py` に `PATCH /api/workspace/config` エンドポイントを追加
   4. リクエストボディ: `{ "ops": [{ "op": "set"|"unset"|"merge", "path": "...", "value": ... }] }`
   5. エラーレスポンス: `INVALID_PATCH` (HTTP 422)
   6. テスト: 正常パッチ、不正パス、不正 op の検証
2. **H-0041: エラーコード拡充**
   1. `api/errors.py` に `ConfigBuildError`（400）、`ConfigImportError`（400）、`ExportError`（500）を追加
   2. `api/workspace.py` の config 関連エンドポイントで新エラーコードを使用
   3. `api/jobs.py` の export エンドポイントで `ExportError` を使用
   4. テスト: 各エラーコードが正しい HTTP ステータスとレスポンスを返すことを検証
3. OpenAPI スキーマ再生成（`pnpm generate:api`）
4. 品質ゲート通過

**DoD:**
- [ ] `PATCH /api/workspace/config` が正しく Config を部分更新する
- [ ] 不正パス/op で 422 が返る
- [ ] 新エラーコード 3 種が正しい HTTP ステータスで返る
- [ ] 既存 `PUT /api/workspace/config` が引き続き動作する
- [ ] OpenAPI スキーマが更新されている
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-4: WebSocket 再接続 + Fold 進捗表示

**対象:** H-0035, H-0047

**依存:** v3-1（スレッド管理基盤が前提）

**方針:** WebSocket の信頼性向上と、Fold ごとのリアルタイムスコア表示を同時に実装。両方とも WebSocket + ResultsPanel に関わるため一括で進める。

**成果物:**
- WebSocket 指数バックオフ再接続ロジック
- `FoldProgressList` コンポーネント
- WebSocket 進捗メッセージの `fold_results` フィールド

**タスク:**
1. **H-0035: WebSocket 再接続**
   1. `frontend/src/api/websocket.ts` に指数バックオフ再接続を追加（1s → 2s → 4s → 8s → max 30s、最大 10 回）
   2. 再接続成功後に `GET /api/jobs/{job_id}` でジョブ状態を復元
   3. `onReconnect` コールバックを追加
   4. 最大リトライ超過時にトースト通知
   5. テスト: 再接続シーケンスの単体テスト
2. **H-0047: Fold 進捗リアルタイムスコア表示**
   1. `services/training.py` の進捗コールバックで fold 完了時に `fold_results` を含める
   2. `ws/progress.py` の WebSocket メッセージに `fold_results` フィールドを追加
   3. `frontend/src/components/workspace/FoldProgressList.tsx` を新規作成
   4. `ResultsPanel.tsx` の Running 状態に `FoldProgressList` を組み込み
   5. Storybook ストーリー追加
   6. テスト: fold_results の逐次更新を検証
3. 品質ゲート通過（バックエンド + フロントエンド）

**DoD:**
- [ ] WebSocket 切断後に自動再接続が発火する
- [ ] 再接続成功後にジョブ状態が正しく復元される
- [ ] Fold 完了時にスコアがリアルタイム表示される
- [ ] 最大リトライ超過時にユーザー通知が表示される
- [ ] Storybook に FoldProgressList ストーリーが存在する
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-5: openapi-typescript 生成型の実活用

**対象:** H-0043

**依存:** v3-3（API 拡張後の最新 OpenAPI スキーマが前提）

**方針:** 手書き型（`types.ts`）から `generated/schema.d.ts` への段階的移行。API 関数の import 先を変更し、手書き型を削減する。

**成果物:**
- API 関数が `generated/schema.d.ts` を直接参照
- `types.ts` が re-export のみに
- CI に型生成一致チェック追加

**タスク:**
1. `pnpm generate:api` で最新の `generated/schema.d.ts` を生成
2. `frontend/src/api/workspace.ts` の型を `generated/schema.d.ts` に移行
3. `frontend/src/api/jobs.ts` の型を移行
4. `frontend/src/api/inference.ts` の型を移行
5. `frontend/src/api/types.ts` から手書き API レスポンス型を削除（re-export のみ残す）
6. コンポーネント側の import パスを必要に応じて調整
7. CI に `pnpm generate:api && git diff --exit-code frontend/src/api/generated/` チェックを追加
8. `pnpm check` + `pnpm test` 通過確認

**DoD:**
- [ ] API 関数が `generated/schema.d.ts` の型を直接参照している
- [ ] `types.ts` に手書きの API レスポンス型が存在しない
- [ ] `pnpm check` が全パス
- [ ] `pnpm test` が全パス

---

## Phase v3-6: Workspace UX 改善（Config ロック + セグメントボタン）

**対象:** H-0048, H-0049

**依存:** v3-4（WebSocket 再接続基盤が前提。Running 状態の正確な検出に必要）

**方針:** Workspace の操作性改善。Running 中の Config 編集ロック（誤操作防止）と Search Space の固定値エディタ改善を実施。

**成果物:**
- Running 中の Config フォーム操作ロック + インフォバー
- Search Space Fixed モードの少数 enum セグメントボタン化

**タスク:**
1. **H-0049: Running 中の Config 編集ロック**
   1. `ModelPanel.tsx` / `TuneTab.tsx` に Running 状態検出を追加
   2. Running 中: `pointer-events: none` + `opacity: 0.6` を Config フォームに適用
   3. フォーム上部にインフォバー（shadcn Alert, info variant）を表示
   4. Fit/Tune ボタンを "Running..." + disabled に変更
   5. Cancel ボタンのみ操作可能に維持
   6. テスト: Running 状態でのフォーム操作不可を検証
2. **H-0048: Search Space Fixed セグメントボタン**
   1. `SearchSpaceTable.tsx` の `FixedValueEditor` に分岐ロジックを追加
   2. enum 4 個以下 → shadcn ToggleGroup (`size="sm"`)
   3. enum 5 個以上 → Select ドロップダウン（現状維持）
   4. 閾値 `MAX_SEGMENT_OPTIONS = 4` を定数として抽出
   5. Storybook ストーリー追加
   6. テスト: 各パターンの表示切替を検証
3. 品質ゲート通過

**DoD:**
- [ ] Running 中に Config フォームが操作不可になる
- [ ] Cancel ボタンは操作可能
- [ ] 4 個以下の enum がセグメントボタンで表示される
- [ ] 5 個以上の enum は Select のまま
- [ ] Storybook にストーリーが追加されている
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-7: カラム値分布バー + CV Fold Preview

**対象:** H-0044, H-0046

**依存:** v3-5（型生成の実活用が前提。API レスポンス型の整合性確保）

**方針:** CV 設定の視覚化コンポーネント群を構築。分布バーと Fold プレビューは後続の BlockedGroupKFold エディタ（v3-8）の部品となる。

**成果物:**
- `DistributionBar` コンポーネント（カテゴリ / 数値対応）
- `FoldPreview` コンポーネント（Train/Valid/Unused 色分け + テーブル）
- `GET /api/workspace/data/column-stats/{col}` レスポンスに `value_counts` 追加

**タスク:**
1. **H-0046: カラム値分布バー**
   1. `services/data.py` に `get_column_value_counts(col, top_n=20)` を追加
   2. `api/workspace.py` の `column-stats/{col}` レスポンスに `value_counts` を追加
   3. `frontend/src/components/workspace/DistributionBar.tsx` を新規作成
   4. カテゴリカル: 上位 N 値 + "other" セグメント（色分け）
   5. 数値: ヒストグラム風バー（ビン分割）
   6. ホバーツールチップ（値 + 件数）
   7. `DataPanel.tsx` の Column Settings テーブルに行展開（Accordion）で表示
   8. Storybook ストーリー追加
2. **H-0044: CV Fold Preview**
   1. split-preview エンドポイントのレスポンス確認（または新設）
   2. `frontend/src/components/workspace/FoldPreview.tsx` を新規作成
   3. サマリーバッジ: `"Total: {N} folds ({T} time × {G} groups)"`
   4. 期間フロー図: Train（青）/ Valid（橙）/ Unused（灰）カラーブロック
   5. 詳細テーブル: Fold #、構造、Train サイズ、Valid サイズ
   6. CvSection 下部に配置、CV 設定変更時に debounce 500ms でリフレッシュ
   7. Storybook ストーリー追加
3. 品質ゲート通過

**DoD:**
- [ ] カラム選択時に分布バーが表示される
- [ ] ホバーで値と件数が確認できる
- [ ] CV 設定後に Fold プレビューが表示される
- [ ] Train/Valid/Unused が色分けされている
- [ ] Storybook に両コンポーネントのストーリーが存在する
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-8: BlockedGroupKFold 専用 2軸エディタ

**対象:** H-0045

**依存:** v3-7（FoldPreview + DistributionBar が部品として必要）

**方針:** Widget の `BlockedGroupKFold.tsx` パターンを移植。Blocks（時間軸）× Groups（エンティティ軸）の 2 軸設定を直感的に行えるエディタを構築する。

**成果物:**
- `BlockedGroupKFoldEditor` コンポーネント
- CvSection での条件分岐（strategy === `blocked_group_kfold` 時にエディタ切替）

**タスク:**
1. `frontend/src/components/workspace/BlockedGroupKFoldEditor.tsx` を新規作成
2. **Blocks サブセクション:**
   - カラム選択（Select）
   - ユニーク値分布バー（v3-7 の DistributionBar を使用）
   - カットオフ値チップ選択（クリックトグル、最終値は常に ON + disabled）
   - 結果の期間一覧（P0〜Pn）と各期間行数
   - モード切替: Expanding / Sliding（SegmentGroup）
   - Train Window: NumberInput（Sliding 時のみ表示）
3. **Groups サブセクション:**
   - カラム選択（Blocks カラムを除外）
   - n_splits: NumberInput (2-10)
   - stratify: SegmentGroup (auto / on / off)
   - shuffle: Switch
4. **Min Rows サブセクション:**
   - Min Train Rows / Min Valid Rows: NumberInput（nullable）
5. v3-7 の FoldPreview を統合（エディタ下部に表示）
6. `CvSection.tsx` に条件分岐を追加
7. Storybook ストーリー追加
8. テスト: 各サブセクションの操作と Config 出力の検証
9. 品質ゲート通過

**DoD:**
- [ ] BlockedGroupKFold 選択時に専用エディタが表示される
- [ ] カットオフ地点をチップで視覚的に選択できる
- [ ] Expanding/Sliding モードの切替が機能する
- [ ] Groups カラム選択で Blocks カラムが除外される
- [ ] FoldPreview と統合されている
- [ ] Storybook にストーリーが追加されている
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-9: Jobs 詳細画面の統一（KPI + LC フィルター + Importance）

**対象:** H-0050, H-0051, H-0052

**依存:** v3-5（型生成の実活用が前提）

**方針:** Jobs 詳細画面と Workspace ResultsPanel の表示コンポーネントを共通化。KPI カード、LC メトリクスフィルター、Importance Kind セレクターの 3 点を一括で実装する。

**成果物:**
- `shared/MetricCards.tsx` 共通コンポーネント
- Jobs 詳細画面の KPI カード表示
- Jobs 詳細画面の LC メトリクスフィルター
- Jobs 詳細画面の Importance Kind セレクター

**タスク:**
1. **H-0050: KPI カード表示統一**
   1. `frontend/src/components/shared/MetricCards.tsx` を新規作成（ResultsPanel から抽出）
   2. `ResultsPanel.tsx` を `MetricCards` 使用に変更
   3. `CompletedContent.tsx` に `MetricCards` を追加
   4. ScoreSection をアコーディオン内に移動（"View Details" で展開）
   5. Storybook ストーリー追加
2. **H-0051: LC メトリクスフィルター**
   1. `CompletedContent.tsx` の PlotSection に `lcMetrics` state を追加
   2. Learning Curve 選択時にメトリクス chip フィルターを表示
   3. ResultsPanel と同じフィルター UI を共用
   4. テスト: chip 選択でプロットが更新されることを検証
3. **H-0052: Importance Kind セレクター**
   1. `CompletedContent.tsx` に `importanceKind` state を追加
   2. Importance 選択時に Kind セレクター（Segment group: Split / Gain / SHAP）を表示
   3. ResultsPanel と同じセレクター UI を共用
   4. テスト: Kind 切替でプロットが更新されることを検証
4. 品質ゲート通過

**DoD:**
- [ ] Jobs 詳細画面で KPI カードが表示される
- [ ] ResultsPanel と同じ `MetricCards` コンポーネントを使用している
- [ ] LC メトリクスフィルターが機能する
- [ ] Importance Kind セレクターが機能する
- [ ] Storybook に MetricCards ストーリーが追加されている
- [ ] 既存テストが全パス + 新規テスト追加

---

## Phase v3-10: Search Space デフォルト Range 自動ポピュレート

**対象:** H-0053

**依存:** v3-3（API 拡張完了が前提。CatalogEntry 型拡張が必要）

**方針:** Studio のハードコード `RANGE_DEFAULTS` を廃止し、Adapter 契約（`search_space_catalog`）から Range デフォルトを取得するよう変更。将来の Adapter 追加時に Studio 側のコード変更を不要にする。

**成果物:**
- `CatalogEntry` 型に `default_mode` / `default_range` フィールド追加
- LizyML Adapter に主要パラメータの Range デフォルト設定
- Studio の `RANGE_DEFAULTS` ハードコード削除

**タスク:**
1. `backends/types.py` の `CatalogEntry` に `default_mode: Literal["fixed", "range", "choice"] = "fixed"` と `default_range: RangeDefault | None = None` を追加
2. `backends/lizyml.py` の `search_space_catalog` に主要パラメータの Range デフォルトを設定:
   - `learning_rate`: `{ low: 0.01, high: 0.3, log: true }`
   - `num_leaves`: `{ low: 15, high: 127, log: false }`
   - `n_estimators`: `{ low: 50, high: 500, log: false }`
   - `max_depth`: `{ low: 3, high: 12, log: false }`
3. OpenAPI スキーマ再生成
4. `frontend/src/components/workspace/SearchSpaceTable.tsx` の `RANGE_DEFAULTS` / `KNOWN_PARAMS` を廃止
5. Adapter 契約の `default_mode` / `default_range` を参照するように変更
6. テスト: Adapter からのデフォルト取得、Studio のハードコード不在を検証
7. 品質ゲート通過

**DoD:**
- [ ] `search_space_catalog` のエントリに `default_mode` が含まれる
- [ ] Studio の SearchSpaceTable が Adapter 契約から Range デフォルトを取得する
- [ ] Studio の `RANGE_DEFAULTS` ハードコードが削除されている
- [ ] 既存テストが全パス + 新規テスト追加
