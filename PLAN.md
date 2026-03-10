## フェーズ一覧

### v1（完了）

Phase 0〜30 は v1 で完了済み。バックエンド（Python / FastAPI / Adapter 層）は BLUEPRINT 準拠で実装済み（commit `77470cf`）。

### v2 再開発フェーズ（テックスタック刷新）

バックエンドは v1 から復元して維持。フロントエンドのみ Tailwind + shadcn/ui + Biome で再構築する。

| Phase | 名前 | 依存 | 状態 |
|-------|------|------|------|
| v2-0 | v2 ドキュメント整備 | — | ✅ |
| v2-1 | バックエンド復元 + 開発環境 | v2-0 | 🔧 |
| v2-2 | フロントエンド基盤（Tailwind + shadcn/ui + Biome） | v2-1 | 🔧 |
| v2-3 | API 型生成（openapi-typescript） | v2-2 | 🔧 |
| v2-4 | Workspace 画面 — Data Panel | v2-3 | 🔧 |
| v2-5 | Workspace 画面 — Model Panel | v2-4 | 🔧 |
| v2-6 | Workspace 画面 — Results Panel + WebSocket | v2-5 | 🔧 |
| v2-7 | テスト基盤（Vitest + Storybook + MSW） | v2-2 | 🔧 |
| v2-8 | pre-commit + CI/CD（GitHub Actions + gh-action-pypi-publish） | v2-2 | 🔧 |
| v2-9 | Jobs 画面再実装 | v2-6 | 🔧 |
| v2-10 | Inference 画面再実装 | v2-9 | 🔧 |
| v2-11 | E2E テスト（Playwright）+ 最終監査 | v2-10, v2-7, v2-8 | 🔧 |

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
