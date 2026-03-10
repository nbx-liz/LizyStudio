## 仕様変更ログ

### 形式

各エントリは以下の構造に従う。詳細は `skills/history-proposals/SKILL.md` を参照。

```
### H-XXXX: タイトル
- **Status:** proposed | accepted | rejected | superseded
- **Scope:** API | Frontend | Backend | Adapter | Build | Config
- **Related:** BLUEPRINT.md の該当セクション
- **Context:** なぜこの変更が必要か
- **Proposal:** 提案内容
- **Impact:** 影響を受けるファイル・コンポーネント
- **Compatibility:** 破壊的 / 非破壊的
- **Alternatives:** 検討した代替案
- **Acceptance Criteria:** 受け入れ基準
- **Decision:** 日付 + 結果 + 備考
```

### 変更ゲート対象

以下に該当する変更は、先に本ドキュメントに Proposal を追加してから実装する。

- API エンドポイントの追加・変更・削除
- `BackendAdapter` Protocol の変更
- 共通型（`FitSummary`, `PlotData` 等）の変更
- 画面間のデータフロー変更
- フロントエンドの外部依存ライブラリの追加・削除
- ビルド・配布方式の変更

ゲート不要: 純粋なUI調整（色、レイアウト微修正）、テスト追加、ドキュメント修正

---

### H-0001: POST /api/workspace/tune エンドポイントの追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.2
- **Context:** §4.2.2 で Tune タブと Tune ボタンが定義されており、Workspace から Tune を実行できる設計になっている。しかし §5.2 の Workspace API には `POST /api/workspace/fit` のみが定義されており、Tune 実行用のエンドポイントが存在しない。
- **Proposal:** `POST /api/workspace/tune` エンドポイントを §5.2 に追加する。Fit と同様に現在の Config + Data で Tune Job を作成・実行し、`{ "job_id": "job_042" }` を返す。
- **Impact:** BLUEPRINT.md §5.2、api/workspace.py、services/training.py
- **Compatibility:** 非破壊的（新規エンドポイント追加）
- **Alternatives:** `POST /api/workspace/fit` に `type: "fit" | "tune"` パラメータを追加する案 → Fit と Tune では Config の意味（固定パラメータ vs 探索空間）が異なるため、エンドポイントを分離するほうが明確
- **Acceptance Criteria:** BLUEPRINT §5.2 に Tune エンドポイントが定義されている
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0002: TuningSummary に Best Params モデルの評価情報を含める
- **Status:** accepted
- **Scope:** Adapter
- **Related:** BLUEPRINT.md §3.3.1、§4.2.3
- **Context:** §4.2.3 の Tune 完了画面では、探索結果（Optimization History / Best Params / Trial Results）に加え、Best Params で学習したモデルの Score / Learning Curve / Plots / Feature Importance / Fold Details を表示する。しかし現在の `TuningSummary`（§3.3.1）は `best_params` / `best_score` / `trials` のみで、Best Params モデルの評価情報を取得する手段がない。
- **Proposal:** Tune 実行時に best params で自動的に fit を行い、その評価結果も保存する。具体的には以下のいずれか:
  - 案A: `TuningSummary` に `fit_summary: FitSummary | None` フィールドを追加
  - 案B: Job の result を拡張し `tune_result: TuningSummary` + `fit_result: FitSummary | None` を持つ
  - 案C: `BackendAdapter.tune()` の戻り値を `TuningSummary` から `TuneWithFitSummary` に変更
- **Impact:** backends/types.py、backends/lizyml.py、services/training.py、api/jobs.py、Job 保存形式
- **Compatibility:** 非破壊的（型の拡張）
- **Alternatives:** Tune 完了後にユーザーが手動で「Apply to Fit → Fit 実行」する運用 → UX が大幅に劣化するため不採用
- **Acceptance Criteria:** Tune 完了後に Score / Learning Curve / Plots / Feature Importance が表示可能であること
- **Decision:** 2026-03-09 accepted — 案B を採用。Job の result を `tune_result: TuningSummary` + `fit_result: FitSummary | None` の2フィールドに拡張する

---

### H-0003: Inference API の拡充（履歴・評価・永続化）
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.4、§4.4、§3.4
- **Context:** §4.4 の画面仕様では以下の機能が定義されている:
  - 推論履歴リスト（§4.4.1 History）
  - 履歴クリックによる結果切替
  - 正解ラベルありの評価（IS/OOS/Inf の3列 Score テーブル + 評価プロット）
  - 正解ラベルなしの過去推論との分布比較

  しかし §5.4 の Inference API は `POST /run` / `GET /result` / `GET /download` の3エンドポイントのみで、上記機能を実現するための API が不足している。また §3.4 の状態管理に推論履歴の永続化モデルが定義されていない。
- **Proposal:**
  1. API エンドポイントの追加:
     - `GET /api/inference/history?job_id={job_id}` — 推論履歴一覧
     - `GET /api/inference/{inf_id}` — 特定推論の結果サマリー
     - `GET /api/inference/{inf_id}/predictions` — 予測テーブル（ページネーション: `rows`, `offset`）
     - `GET /api/inference/{inf_id}/metrics` — 評価メトリクス（正解あり時、IS/OOS/Inf の3列）
     - `GET /api/inference/{inf_id}/plot/{plot_type}` — 評価プロット（正解あり時）
     - `GET /api/inference/{inf_id}/download` — CSV ダウンロード
     - `GET /api/inference/{inf_id}/comparison/{other_inf_id}` — 分布比較統計
  2. 永続化モデルの追加（§3.4 に追記）:
     - 保存場所: `{jobs_dir}/{job_id}/inferences/{inf_id}/`
     - 保存内容: meta.json（inf_id, job_id, data_ref, has_ground_truth, created_at, row_count）/ predictions.parquet / metrics.json（正解あり時）
  3. 既存エンドポイントの整理:
     - `POST /api/inference/run` のレスポンスに `inf_id` を含める
     - `GET /api/inference/result` と `GET /api/inference/download` を `{inf_id}` パス付きに変更
- **Impact:** BLUEPRINT.md §5.4 全体、§3.4 状態管理、api/inference.py、services/inference.py
- **Compatibility:** 非破壊的（新規エンドポイント追加 + 既存エンドポイントの整理）
- **Alternatives:** 推論結果をセッション内のみ保持（揮発）する案 → §4.4.1 History の画面仕様（過去履歴の一覧と選択）と矛盾するため不採用
- **Acceptance Criteria:** 推論履歴の永続化モデルが §3.4 に、全エンドポイントが §5.4 に定義されている
- **Decision:** 2026-03-09 accepted — API 構成・永続化モデルとも提案通り

---

### H-0004: GET /api/workspace/data/columns レスポンススキーマの定義
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.2、§4.2.1
- **Context:** §5.2 Data に `GET /api/workspace/data/columns` が「カラム情報一覧」と記載されているが、レスポンスのフィールド定義がない。§4.2.1 Column Settings テーブルにはカラム名・ユニーク数・Type・自動除外判定結果が必要であり、API レスポンスの仕様が未定義では実装できない。
- **Proposal:** レスポンススキーマを §5.2 に追記する:
  ```json
  {
    "target": "y",
    "columns": [
      {
        "name": "age",
        "dtype": "int64",
        "unique_count": 50,
        "suggested_type": "numeric",
        "suggested_excluded": false,
        "exclude_reason": null
      }
    ]
  }
  ```
  - `suggested_type`: `"numeric"` | `"categorical"`（§4.2.1 の自動判定ルールに基づく）
  - `suggested_excluded`: 自動除外の推奨（ID / Const 判定）
  - `exclude_reason`: `"id"` | `"constant"` | `null`
  - データ加工ロジック（自動検出の閾値判定）は Service 層が担う（CLAUDE.md §4 準拠）
- **Impact:** BLUEPRINT.md §5.2、api/workspace.py、services/data.py
- **Compatibility:** 非破壊的（新規スキーマ定義）
- **Alternatives:** dtype のみ返しフロントエンドで自動判定する案 → CLAUDE.md §4 のレイヤー責務（データ加工は Service 層）に反するため不採用
- **Acceptance Criteria:** BLUEPRINT §5.2 にレスポンスの JSON スキーマが定義されている
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0005: POST /api/jobs/{job_id}/export リクエスト・レスポンスの定義
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.3、§4.3
- **Context:** §5.3 に `POST /api/jobs/{job_id}/export` が「モデル/レポートを指定パスに Export」と記載されているが、リクエストボディとレスポンスの仕様がない。§4.3 の Export ダイアログでは Export 形式（Model / Report）と出力先パスを指定する UI が定義されている。
- **Proposal:** リクエスト・レスポンスを §5.3 に追記する:
  ```json
  // リクエスト
  {
    "export_type": "model",
    "output_path": "/path/to/output"
  }
  ```
  - `export_type`: `"model"`（学習済みモデル）| `"report"`（結果レポート）
  - `output_path`: 出力先ディレクトリパス
  ```json
  // レスポンス
  {
    "exported_path": "/path/to/output/job_042_model",
    "export_type": "model"
  }
  ```
- **Impact:** BLUEPRINT.md §5.3、api/jobs.py、services/export.py
- **Compatibility:** 非破壊的（新規スキーマ定義）
- **Alternatives:** なし
- **Acceptance Criteria:** BLUEPRINT §5.3 にリクエスト・レスポンスの JSON スキーマが定義されている
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0006: GET /api/jobs/{job_id}/log エンドポイント追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §4.3.2、§5.3
- **Context:** §4.3.2 の Jobs 詳細画面に「Execution Log」Accordion が定義されているが、実行ログを提供する API エンドポイントが §5.3 に存在しない。また `services/training.py` は fit/tune 時のログをディスクに永続化していない。
- **Proposal:**
  1. `GET /api/jobs/{job_id}/log` エンドポイントを §5.3 に追加。レスポンス: `{ "log": "...text..." }`。ログが未保存の場合は空文字列を返す。
  2. `services/training.py` で fit/tune 実行時の stdout/stderr を `{job_dir}/execution.log` に書き込む。
  3. `services/jobs.py` に `get_log(job_id) -> str` メソッドを追加。
- **Impact:** BLUEPRINT.md §5.3、api/jobs.py、services/jobs.py、services/training.py
- **Compatibility:** 非破壊的（新規エンドポイント追加）
- **Alternatives:** なし
- **Acceptance Criteria:** `GET /api/jobs/{job_id}/log` がログテキストを返す
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0007: RequestValidationError ハンドラ追加（共通エラー形式統一）
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §6.1
- **Context:** §6.1 で全エラーレスポンスは `{ "error": { "code", "message", "details" } }` 形式と定義されている。しかし FastAPI のデフォルト `RequestValidationError` ハンドラは Pydantic 形式で 422 を返しており、共通形式に従っていない。
- **Proposal:** `fastapi.exceptions.RequestValidationError` 用のカスタムハンドラを `api/errors.py` に追加し、`server.py` に登録する。レスポンスは `{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": { "errors": [...] } } }` 形式。
- **Impact:** api/errors.py、server.py
- **Compatibility:** 非破壊的（レスポンス形式の統一、既存クライアントはステータスコード 422 で判別可能）
- **Alternatives:** なし
- **Acceptance Criteria:** 422 エラーが共通エラー形式で返る
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0008: InferenceNotFoundError を api/errors.py に統合
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §6.1
- **Context:** 全 `StudioError` サブクラスは `api/errors.py` に集約されているが、`InferenceNotFoundError` のみ `api/inference.py` にローカル定義されている。エラー体系の一元管理に反する。
- **Proposal:** `InferenceNotFoundError` を `api/errors.py` に移動し、`api/inference.py` からは import で参照する。
- **Impact:** api/errors.py、api/inference.py
- **Compatibility:** 非破壊的（内部リファクタリング）
- **Alternatives:** なし
- **Acceptance Criteria:** `InferenceNotFoundError` が `api/errors.py` に定義されている
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0009: POST /api/inference/run リクエストボディ形式変更 + evaluate 追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.4、§4.4.1
- **Context:** BLUEPRINT §5.4 は `POST /run` のリクエストボディを `{ "job_id": "...", "data": { "source_type": "path", "path": "..." }, "return_shap": false }` と定義しているが、現在の実装は `{ "job_id": "...", "data_path": "...", "return_shap": false }` のフラット形式。また §4.4.1 の Evaluate チェックボックスに対応する `evaluate` パラメータが未実装。
- **Proposal:**
  1. `RunRequest` を BLUEPRINT 準拠のネスト構造に変更: `data: { source_type, path }`
  2. `evaluate: bool = True` パラメータを追加。False の場合、GT 列が存在してもメトリクス計算をスキップ
- **Impact:** api/inference.py、services/inference.py、frontend/src/api/inference.ts、frontend/src/pages/InferencePage.tsx
- **Compatibility:** 破壊的（プレリリースのため許容）
- **Alternatives:** なし
- **Acceptance Criteria:** `POST /run` が BLUEPRINT 形式で 200 を返し、`evaluate: false` でメトリクスなし
- **Decision:** 2026-03-09 accepted — BLUEPRINT §5.4 準拠

---

### H-0010: GET /api/inference/history の job_id optional 化
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.4
- **Context:** BLUEPRINT §5.4 は「推論履歴一覧（query: `job_id`、省略時は全件）」と定義しているが、現在の実装では `job_id` は必須パラメータ。
- **Proposal:** `job_id` を optional 化。省略時は全ジョブの推論履歴を返却。
- **Impact:** api/inference.py、services/inference.py、frontend/src/api/inference.ts
- **Compatibility:** 非破壊的（既存リクエストはそのまま動作）
- **Alternatives:** なし
- **Acceptance Criteria:** `GET /api/inference/history` が `job_id` 省略で全件返却
- **Decision:** 2026-03-09 accepted — BLUEPRINT §5.4 準拠

---

### H-0011: POST /api/jobs/{job_id}/cancel エンドポイント追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §4.3.2、§5.3
- **Context:** BLUEPRINT §4.3.2 は Running ジョブに Cancel ボタンを定義し、§5.3 は Cancel アクションを記載している。しかし現在の実装にはキャンセルエンドポイントが存在せず、フロントエンドの Cancel ボタンは disabled 状態。
- **Proposal:**
  1. `POST /api/jobs/{job_id}/cancel` エンドポイント追加。レスポンス: `{ "status": "cancelled" }`
  2. Job status に `"cancelled"` を追加
  3. `JobStore` に `request_cancel()` / `is_cancel_requested()` メソッド追加
  4. training.py の progress callback 内でキャンセルフラグを確認し、検出時に `CancelledError` を送出
- **Impact:** api/jobs.py、services/jobs.py、services/training.py、frontend (ResultsPanel.tsx, jobs.ts)
- **Compatibility:** 非破壊的（新規エンドポイント + 新ステータス追加）
- **Alternatives:** なし
- **Acceptance Criteria:** `POST /api/jobs/{job_id}/cancel` が running ジョブを cancelled に遷移させる
- **Decision:** 2026-03-09 accepted — BLUEPRINT §5.3 準拠

---

### H-0012: BLUEPRINT §3.3.2 BackendAdapter Protocol に params / return_shap を追記
- **Status:** accepted
- **Scope:** Adapter
- **Related:** BLUEPRINT.md §3.3.2
- **Context:** H-0002 で Tune→Fit フローのために `fit(params=...)` が、H-0009 で SHAP のために `predict(return_shap=...)` が実装済みだが、BLUEPRINT §3.3.2 の Protocol 定義が未更新。
- **Proposal:** §3.3.2 の Protocol 定義を実装と整合させる:
  - `fit(model, *, params=None, on_progress=None) -> FitSummary`
  - `predict(model, data, *, return_shap=False) -> PredictionSummary`
- **Impact:** BLUEPRINT.md §3.3.2 のみ（コード変更なし）
- **Compatibility:** 非破壊的（文書化のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** BLUEPRINT §3.3.2 が実装と一致する
- **Decision:** 2026-03-09 accepted — spec-update

---

### H-0013: BLUEPRINT §3.3.1 TuningSummary に metric_name / direction を追記
- **Status:** accepted
- **Scope:** Adapter
- **Related:** BLUEPRINT.md §3.3.1
- **Context:** `TuningSummary` に `metric_name: str` と `direction: str` が実装済みだが、BLUEPRINT §3.3.1 に記載がない。Tune 結果の UI 表示に必要。
- **Proposal:** §3.3.1 の TuningSummary 定義に以下を追記:
  - `metric_name: str` — 最適化対象メトリクス名
  - `direction: str` — `"minimize"` | `"maximize"`
- **Impact:** BLUEPRINT.md §3.3.1 のみ（コード変更なし）
- **Compatibility:** 非破壊的（文書化のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** BLUEPRINT §3.3.1 が実装と一致する
- **Decision:** 2026-03-09 accepted — spec-update

---

### H-0014: GET /api/backends エンドポイント追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5（新規セクション）
- **Context:** フロントエンドが利用可能なバックエンド一覧を取得する手段がない。バックエンド名・バージョンを表示する UI（Model Panel のバッジ等）に必要。
- **Proposal:** `GET /api/backends` エンドポイントを追加。レスポンス: `[{"name": "lizyml", "version": "1.2.3"}]`
- **Impact:** BLUEPRINT.md §5（新規セクション追加）、api/backends.py（新規）、server.py
- **Compatibility:** 非破壊的（新規エンドポイント追加）
- **Alternatives:** バックエンド情報を `/api/workspace/status` に含める案 → 独立したエンドポイントのほうが RESTful
- **Acceptance Criteria:** `GET /api/backends` が 200 でバックエンド一覧を返す
- **Decision:** 2026-03-09 accepted — 提案通り

---

### H-0015: POST /api/inference/upload を upload-only に変更
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.4
- **Context:** BLUEPRINT §5.4 は upload と run を分離している（先に upload でデータ送信、次に run で `source_type: "upload"` を指定）。現在の実装は upload 時に即座に推論を実行しており、BLUEPRINT の設計意図と異なる。
- **Proposal:** `POST /api/inference/upload` を upload-only に変更。ファイルを一時保存しパス参照を返す。推論実行は `POST /run` で行う。
  - レスポンス: `{ "upload_path": "/tmp/lizystudio_xxx.csv", "filename": "data.csv" }`
- **Impact:** api/inference.py、frontend/src/api/inference.ts、frontend/src/pages/InferencePage.tsx
- **Compatibility:** 破壊的（プレリリースのため許容）
- **Alternatives:** なし
- **Acceptance Criteria:** upload が推論を実行せずパスのみ返す
- **Decision:** 2026-03-09 accepted — BLUEPRINT §5.4 準拠

---

### H-0016: GET /api/inference/{inf_id}/metrics の GT なし時応答を 404 に変更
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.4
- **Context:** BLUEPRINT §5.4 は metrics エンドポイントを「正解あり時」の条件付きとしている。現在の実装は GT なし時に `200 + {"error": "no ground truth available"}` を返しており、正常レスポンスとエラーの区別が困難。
- **Proposal:** GT なし時は `404 INFERENCE_NOT_FOUND` または新コード `METRICS_NOT_AVAILABLE` を返す。
- **Impact:** api/inference.py、frontend/src/pages/InferencePage.tsx
- **Compatibility:** 破壊的（プレリリースのため許容）
- **Alternatives:** 200 + `{"metrics": null, "has_ground_truth": false}` を返す案 → 404 のほうが REST 慣例に沿う
- **Acceptance Criteria:** GT なし時に 404 が返る
- **Decision:** 2026-03-09 accepted — 提案通り

---

## v2 テックスタック移行（2026-03-10）

v2 再開発ブランチ（`feat/v2`）にて、フロントエンドのテックスタックとビルド基盤を刷新する。

---

### H-0017: フロントエンド UI ライブラリを Mantine v8 から Tailwind CSS + shadcn/ui に変更
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §3.1、§4 全体、CLAUDE.md §3
- **Context:** v2 再開発にあたり、UIコンポーネントの設計方針を見直す。Mantine はフル UI フレームワークだが、カスタマイズ性と AI による継続的修正への耐性に課題がある。Tailwind CSS（ユーティリティファースト CSS）+ shadcn/ui（リポジトリ内に持つ直接編集可能なコンポーネント集）に移行し、コンポーネントの透明性と保守性を向上させる。
- **Proposal:**
  1. 以下のパッケージを削除: `@mantine/core`, `@mantine/hooks`, `@mantine/form`, `@mantine/notifications`, `@mantine/dropzone`, `@tabler/icons-react`
  2. 以下を導入: `tailwindcss`, `@tailwindcss/vite`, `shadcn/ui`（CLI でコンポーネントを生成しリポジトリ内に保持）, `lucide-react`（アイコン）
  3. BLUEPRINT の画面仕様で使用する UI コンポーネント名を shadcn/ui ベースの汎用名に置換
  4. フォーム管理は `react-hook-form` + `zod`（shadcn/ui の標準構成）に移行
- **Impact:** BLUEPRINT.md §3.1/§4 全体、CLAUDE.md §3、AGENTS.md §3、frontend/ 全コンポーネント、skills/frontend-pages、skills/frontend-components
- **Compatibility:** 破壊的（v2 再開発ブランチのため許容）
- **Alternatives:** Mantine v8 を継続する案 → AI による修正耐性と直接編集可能性の要件を満たさないため不採用
- **Acceptance Criteria:** BLUEPRINT/CLAUDE.md/AGENTS.md から Mantine 参照が除去され、Tailwind + shadcn/ui がテックスタックとして定義されている
- **Decision:** 2026-03-10 accepted — v2 再開発方針として採用

---

### H-0018: フロントエンド Lint/Format ツールを ESLint から Biome に変更
- **Status:** accepted
- **Scope:** Build
- **Related:** CLAUDE.md §5、§6
- **Context:** v2 再開発にあたり、フロントエンドの lint/format ツールを統一する。ESLint + Prettier の組み合わせは設定が複雑で、Biome は lint と format を単一ツールで高速に実行できる。
- **Proposal:**
  1. ESLint 関連パッケージを全て削除
  2. `@biomejs/biome` を devDependencies に追加
  3. `biome.json` を `frontend/` に配置
  4. `pnpm lint` → `biome check` に変更
  5. `pnpm format` → `biome format` に変更
- **Impact:** CLAUDE.md §5/§6、AGENTS.md §5/§6、frontend/package.json、frontend/.eslintrc（削除）、frontend/biome.json（新規）
- **Compatibility:** 破壊的（v2 再開発ブランチのため許容）
- **Alternatives:** ESLint v9 flat config への移行 → Biome のほうが高速かつ設定が簡素なため不採用
- **Acceptance Criteria:** `pnpm lint` が Biome で実行され、ESLint 関連ファイルが存在しない
- **Decision:** 2026-03-10 accepted — v2 再開発方針として採用

---

### H-0019: フロントエンドテスト基盤の導入（Vitest + Playwright + Storybook + MSW）
- **Status:** accepted
- **Scope:** Build
- **Related:** CLAUDE.md §5、§6、PLAN.md
- **Context:** 既存プロジェクトにはフロントエンドテスト戦略が存在しない。v2 ではユニットテスト（Vitest）、E2E テスト（Playwright）、コンポーネント開発環境（Storybook）、API モック（MSW）を標準基盤として導入する。
- **Proposal:**
  1. `vitest` + `@testing-library/react` を devDependencies に追加
  2. `@playwright/test` を devDependencies に追加
  3. `storybook` + 関連パッケージを devDependencies に追加
  4. `msw` を devDependencies に追加
  5. 開発コマンドを追加: `pnpm test`（Vitest）、`pnpm test:e2e`（Playwright）、`pnpm storybook`
- **Impact:** CLAUDE.md §5/§6、AGENTS.md §5/§6、frontend/package.json、frontend/vitest.config.ts（新規）、frontend/playwright.config.ts（新規）、frontend/.storybook/（新規）
- **Compatibility:** 非破壊的（新規追加）
- **Alternatives:** Jest を使用する案 → Vite との統合が良い Vitest を採用
- **Acceptance Criteria:** `pnpm test` / `pnpm test:e2e` / `pnpm storybook` が実行可能
- **Decision:** 2026-03-10 accepted — v2 再開発方針として採用

---

### H-0020: API 型生成パイプラインの導入（openapi-typescript）
- **Status:** accepted
- **Scope:** Build
- **Related:** BLUEPRINT.md §2（設計原則 #3 型安全）、CLAUDE.md §3
- **Context:** BLUEPRINT §2 で「Pydantic Schema → OpenAPI → TypeScript 型の自動連携チェーンを維持する」と原則を定めているが、具体的な生成ツールと手順が未定義。フロントエンドで API 型を手書きする運用は型安全の原則に反する。
- **Proposal:**
  1. `openapi-typescript` を devDependencies に追加
  2. `pnpm generate:api` コマンドを追加: FastAPI の `/openapi.json` から TypeScript 型を自動生成
  3. 生成先: `frontend/src/api/generated/` に配置
  4. フロントエンドの API クライアントは生成型を使用し、手書き型を禁止
- **Impact:** CLAUDE.md §5、frontend/package.json、frontend/src/api/（手書き型の廃止）、skills/frontend-pages
- **Compatibility:** 非破壊的（新規追加、既存手書き型は段階的に置換）
- **Alternatives:** openapi-fetch（クライアント自動生成）も候補だが、まず型生成のみで開始
- **Acceptance Criteria:** `pnpm generate:api` で TypeScript 型が生成され、API クライアントが生成型を参照している
- **Decision:** 2026-03-10 accepted — BLUEPRINT 設計原則の実現として採用

---

### H-0021: pre-commit フックの導入
- **Status:** accepted
- **Scope:** Build
- **Related:** CLAUDE.md §6
- **Context:** 品質ゲート（lint / format / typecheck）は PR 前に手動実行する運用だが、コミット時に自動チェックすることで品質違反の混入を防止できる。
- **Proposal:**
  1. `pre-commit` を Python dev dependencies に追加
  2. `.pre-commit-config.yaml` をリポジトリルートに配置
  3. フック内容: Ruff（lint/format）、mypy、Biome（lint/format）
  4. `uv run pre-commit install` でローカル環境にフックを登録
- **Impact:** pyproject.toml、.pre-commit-config.yaml（新規）、CLAUDE.md §6
- **Compatibility:** 非破壊的（新規追加）
- **Alternatives:** husky（Node.js 側のフック）→ Python 側も含めた統一管理のため pre-commit を採用
- **Acceptance Criteria:** `git commit` 時に Ruff + Biome が自動実行される
- **Decision:** 2026-03-10 accepted — 品質ゲート強化として採用

---

### H-0022: PyPI 配布ツールを twine から gh-action-pypi-publish に変更
- **Status:** accepted
- **Scope:** Build
- **Related:** CLAUDE.md §3、skills/build-and-deploy
- **Context:** 現在の配布手順は `twine` による手動アップロードだが、GitHub Actions の Trusted Publisher（OIDC）を使った `pypa/gh-action-pypi-publish` に移行することで、API トークン管理が不要になり CI/CD パイプラインに統合できる。
- **Proposal:**
  1. `twine` を依存から削除
  2. `.github/workflows/publish.yml` に `pypa/gh-action-pypi-publish` を使用した自動配布ワークフローを定義
  3. PyPI Trusted Publisher を設定（リポジトリ + ワークフロー名で認証）
- **Impact:** pyproject.toml、.github/workflows/publish.yml（新規）、skills/build-and-deploy
- **Compatibility:** 非破壊的（配布方法の変更、パッケージ自体は同一）
- **Alternatives:** twine を GitHub Actions 内で使用する案 → Trusted Publisher のほうがセキュア
- **Acceptance Criteria:** GitHub tag push で PyPI に自動配布される
- **Decision:** 2026-03-10 accepted — CI/CD 統合として採用

---

### H-0023: `react-resizable-panels` フロントエンド依存追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** CLAUDE.md §3、BLUEPRINT §4 Workspace 画面
- **Context:** Workspace 画面の 3 カラムレイアウト（DataPanel / ModelPanel / ResultsPanel）のサイズをユーザーがドラッグで変更できるようにする。`react-resizable-panels` は shadcn/ui が公式に採用しているリサイズパネルライブラリで、Node 18 / React 19 対応済み。
- **Proposal:**
  1. `pnpm add react-resizable-panels` でフロントエンド依存に追加
  2. shadcn/ui resizable コンポーネント（`components/ui/resizable.tsx`）を追加
  3. WorkspacePage の CSS grid を `ResizablePanelGroup` に置換
- **Impact:** frontend/package.json、WorkspacePage.tsx、新規 resizable.tsx
- **Compatibility:** 非破壊的（内部 UI 変更のみ）
- **Alternatives:** CSS resize プロパティ → 操作性が劣る。カスタム実装 → 工数大
- **Acceptance Criteria:** パネル間のドラッグリサイズが動作し、サイズが localStorage に永続化される
- **Decision:** 2026-03-10 accepted — UX 改善として採用

---

### H-0024: `GET /api/files` ディレクトリ一覧エンドポイント追加
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT §3.1 API エンドポイント一覧
- **Context:** データソース選択時にファイルパスを手入力する代わりに、サーバーサイドのディレクトリをブラウズして CSV/Parquet ファイルを選択できるようにする。シングルユーザーのローカルアプリケーションであり、セキュリティリスクは限定的。
- **Proposal:**
  1. `GET /api/files?path=<dir>` エンドポイントを追加
  2. レスポンス: `{path, parent, entries: [{name, type, size, extension}]}`
  3. デフォルトはホームディレクトリ、.csv/.parquet ファイルのみ表示
  4. フロントエンドに Dialog ベースのファイルブラウザコンポーネントを追加
- **Impact:** 新規 `api/files.py` ルーター、新規 `services/files.py`、フロントエンド FileBrowser コンポーネント
- **Compatibility:** 非破壊的（新規エンドポイント追加）
- **Alternatives:** `<input type="file">` のみ → サーバーサイドのパス指定が必要なケースに対応できない
- **Acceptance Criteria:** ファイルブラウザでディレクトリを遷移し、ファイル選択→データロードが動作する
- **Decision:** 2026-03-10 accepted — UX 改善として採用

---

### H-0025: `get_default_config` on BackendAdapter + `GET /workspace/config/defaults` エンドポイント追加
- **Status:** accepted
- **Scope:** API, Adapter
- **Related:** BLUEPRINT.md §3.3.2、§5.2
- **Context:** データ読み込み + ターゲット選択後、Config が空のため Fit/Tune を即座に実行できない。LizyML が必須とする `config_version`、`task`（トップレベル）、`model` が欠落しており validation エラーになる。ユーザーがデフォルト値で即座に Fit/Tune を実行できるようにするため、バックエンドから完全なデフォルト Config を取得する手段が必要。
- **Proposal:**
  1. `BackendAdapter` Protocol に `get_default_config(task: str, target: str) -> dict[str, Any]` メソッドを追加
  2. `GET /api/workspace/config/defaults?task={task}&target={target}` エンドポイントを追加。バックエンドの Pydantic モデルから完全なデフォルト Config を生成して返す
  3. フロントエンドはターゲット選択時にこのエンドポイントを呼び、デフォルト Config をベースに DataPanel の設定をマージする
- **Impact:** backends/base.py、backends/lizyml.py、services/workspace.py、api/workspace.py、frontend API client、DataPanel.tsx
- **Compatibility:** 非破壊的（新規メソッド + 新規エンドポイント追加）
- **Alternatives:** フロントエンドで JSON Schema から defaults を抽出する案 → discriminated union（model, split）の解決が困難。また「バックエンドの仕様が正」原則に反するため不採用
- **Acceptance Criteria:** ターゲット選択後に完全なデフォルト Config が設定され、追加設定なしで Fit/Tune が実行可能
- **Decision:** 2026-03-10 accepted — 提案通り
