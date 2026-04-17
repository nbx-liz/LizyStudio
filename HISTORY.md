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

### H-0026: BackendAdapter に `get_ui_schema()` メソッドを追加（Backend Contract パターン）
- **Status:** accepted
- **Scope:** Adapter, API, Frontend
- **Related:** BLUEPRINT.md §3.3.2, §4.2.2, §5.2

- **Context:**
  現在の Model Panel は LightGBM のパラメータ名・メトリクス選択肢・探索範囲デフォルトをフロントエンドの `constants.ts` にハードコードしている。この設計には以下の問題がある:
  1. バックエンドにモデル（例: XGBoost）を追加するたびにフロントエンドも変更が必要
  2. LizyML のパラメータ名（`feature_fraction` 等）とフロントエンドのプリセット（`colsample_bytree` 等）が不一致になるリスク
  3. Task ごとの objective/metric 選択肢がバックエンド知識であるにもかかわらずフロントエンドに記述されている
  4. `model.params` が `additionalProperties: true` の自由辞書のため JSON Schema だけでは適切なフォームを生成できない

  LizyML-Widget は「Backend Contract」パターンでこの問題を解決済み: Adapter が `config_schema`（JSON Schema）に加えて `ui_schema`（パラメータヒント、選択肢、探索範囲カタログ、条件付き表示ルール）を返し、フロントエンドはバックエンド固有の知識を一切持たない。

- **Proposal:**

  **1. BackendAdapter Protocol に `get_ui_schema()` を追加:**
  ```python
  def get_ui_schema(self) -> dict[str, Any]:
      """Return UI metadata that supplements config_schema.

      The returned dict contains:
      - sections: List of config section definitions (display order)
      - parameter_hints: Typed parameter metadata for model.params
      - option_sets: Task-specific valid values (objective, metric, model_metric)
      - search_space_catalog: Tunable parameters with mode/range info
      - step_map: Stepper increment hints per parameter
      - conditional_visibility: Field visibility rules based on task/toggles
      - defaults: Section-specific default structures (e.g., calibration)
      """
      ...
  ```

  **2. `GET /api/backends/ui-schema` エンドポイントを追加:**
  現在のバックエンドの `ui_schema` を返す。フロントエンドは初回ロード時に1回取得してキャッシュする。

  **3. LizyMLAdapter に実装を追加:**
  LizyML-Widget の `adapter_contract.py` から移植。`parameter_hints`、`option_sets`、`search_space_catalog`、`step_map`、`conditional_visibility`、`defaults` を返す。

  **4. フロントエンドから `constants.ts` のハードコードを削除:**
  `KNOWN_PARAMS`、`METRICS_BY_TASK`、`RANGE_DEFAULTS`、`CALIBRATION_DEFAULTS` を API レスポンスから取得する。`constants.ts` はフォールバック値のみ保持（API 未取得時のスケルトン表示用）。

  **5. Model Panel の各コンポーネントを ui_schema 駆動に変更:**
  - `KeyValueEditor` → `parameter_hints` からパラメータ一覧を生成
  - `MetricsChips` → `option_sets.metric[task]` から選択肢を取得
  - `SearchSpaceTable` → `search_space_catalog` から行を生成
  - `ConfigForm` → `conditional_visibility` で表示/非表示を制御
  - `NumberInput` → `step_map` からステップ値を取得

- **Impact:**
  - `backends/base.py` — Protocol にメソッド追加
  - `backends/lizyml.py` — `get_ui_schema()` 実装追加
  - `api/backends.py` — 新規エンドポイント追加
  - `frontend/src/components/workspace/constants.ts` — ハードコード削除、フォールバック化
  - `frontend/src/components/workspace/ModelPanel.tsx` — ui_schema 取得 + 配布
  - `frontend/src/components/workspace/*.tsx` — 各コンポーネントが ui_schema を props で受け取る

- **Compatibility:** 非破壊的
  - 新規メソッド + 新規エンドポイントの追加のみ
  - 既存の `get_config_schema()` / `get_default_config()` は変更なし
  - フロントエンドは `constants.ts` をフォールバックとして保持するため、API が利用不可でも動作する

- **Alternatives:**
  1. **フロントエンドにハードコードを維持する案** — 現状維持。バックエンド追加時にフロントエンドも毎回変更が必要。スケールしないため不採用
  2. **JSON Schema の `x-ui-*` 拡張で UI メタデータを埋め込む案** — Pydantic の `model_json_schema()` が返すスキーマを拡張する。スキーマ汚染になり、バリデーションと UI 関心が混在するため不採用
  3. **`get_backend_contract()` で config_schema と ui_schema を一括返す案** — LizyML-Widget のアプローチ。LizyStudio では既に `get_config_schema()` が分離されているため、`get_ui_schema()` を別メソッドにする方が既存設計と一貫する

- **Acceptance Criteria:**
  1. `GET /api/backends/ui-schema` が `parameter_hints`, `option_sets`, `search_space_catalog`, `step_map`, `conditional_visibility`, `defaults` を含む JSON を返す
  2. フロントエンドの `constants.ts` からバックエンド固有のハードコード（パラメータ名、メトリクス選択肢、探索範囲）が削除されている
  3. Model Panel の全コンポーネントが API レスポンスから UI を生成する
  4. Task 変更時に `option_sets` に基づいて選択肢が動的に切り替わる
  5. `pnpm build` + `pnpm check` + `uv run pytest` + `uv run mypy` が通る

- **Migration:** なし（非破壊的追加）
- **Decision:** 2026-03-15 accepted — LizyML-Widget の実績あるパターンを採用

---

### H-0027: LizyML v0.4.0 対応 — export_code() API の追加
- **Status:** accepted
- **Scope:** API, Adapter, Frontend
- **Related:** BLUEPRINT.md §5.3（Jobs API）、§3.2（Adapter 層）
- **Context:** LizyML v0.3.0 で `Model.export_code(path)` が追加された。学習済みモデルから LizyML 非依存の Python スクリプト（`train.py`, `predict.py`, `test_equivalence.py`, `config.json`, `requirements.txt`, `artifacts/`）を生成する機能。LizyStudio ユーザーが GUI から利用できるようにする。
- **Proposal:**
  1. `BackendAdapter` Protocol に `export_code(model, path) -> str` メソッドを追加
  2. `POST /api/jobs/{job_id}/export-code` エンドポイントを追加（ZIP ダウンロード）
  3. Jobs 画面の Export セクションに「Export Code」ボタンを追加
- **Impact:**
  - `src/lizystudio/backends/base.py` — Protocol にメソッド追加
  - `src/lizystudio/backends/lizyml.py` — `model.export_code(path)` 呼び出し
  - `src/lizystudio/api/jobs.py` — 新エンドポイント
  - `src/lizystudio/services/export.py` — export_code サービス関数
  - Frontend: Jobs 画面の Export UI
- **Compatibility:** 非破壊的（新規メソッド・エンドポイント追加のみ）
- **Alternatives:**
  1. **既存の `export_model` に統合する案** — export_model は LizyML フォーマットの保存、export_code は独立スクリプト生成で目的が異なるため分離が適切
  2. **CLI 専用にする案** — GUI ユーザーにもコード生成を提供するのが LizyStudio の価値
- **Acceptance Criteria:**
  1. `POST /api/jobs/{job_id}/export-code` が ZIP ファイルを返す
  2. ZIP 内に `train.py`, `predict.py`, `requirements.txt` が含まれる
  3. 既存テストが壊れない
  4. `uv run pytest` + `uv run mypy` が通る
- **Migration:** なし

---

### H-0028: LizyML v0.4.0 対応 — Tune 進捗コールバック統合（TuneProgressInfo）
- **Status:** accepted
- **Scope:** Adapter, Backend
- **Related:** BLUEPRINT.md §3.2（Adapter 層）、§5.2（Workspace API）
- **Context:** LizyML v0.1.3 で `TuneProgressInfo` / `TuneProgressCallback` が追加された。`Model.tune(progress_callback=fn)` で Trial 単位の進捗（current_trial, total_trials, best_score, latest_score, latest_state）を受け取れる。現在の LizyStudio Adapter は tune 開始/完了の2ポイントしか報告しておらず、長時間の Tune でユーザーに進捗が伝わらない。
- **Proposal:**
  1. `LizyMLAdapter.tune()` 内で `model.tune(progress_callback=fn)` を使い、Trial 単位で `on_progress` を呼び出す
  2. `BackendAdapter` Protocol の `tune()` シグネチャは変更しない（`on_progress: ProgressCallback` はすでに定義済み）
  3. `ProgressCallback` の `current`/`total` に `current_trial`/`total_trials` をマッピング
- **Impact:**
  - `src/lizystudio/backends/lizyml.py` — `tune()` 内部のみ変更
- **Compatibility:** 非破壊的（内部実装変更のみ。Protocol シグネチャ変更なし）
- **Alternatives:**
  1. **WebSocket メッセージに `best_score` 等を追加する案** — ProgressCallback の `message` フィールドに JSON を埋め込む方法。現時点では `message` は人間可読文字列の想定なので、将来の WebSocket 拡張時に検討
- **Acceptance Criteria:**
  1. Tune 実行中に Trial 単位で WebSocket 進捗メッセージが送信される
  2. 既存テストが壊れない
- **Migration:** なし

---

### H-0029: LizyML-Widget 画面仕様統合 — Data Panel CV 拡張
- **Status:** accepted
- **Scope:** Frontend, Config
- **Related:** BLUEPRINT.md §4.2.1 Cross Validation
- **Context:** LizyML-Widget では LizyML v0.4.0 の全 8 split method に対応し、strategy ごとの条件付きフィールド（time_col, group_col, purge_gap, embargo, gap, train_size_max, test_size_max, blocks/groups）を動的表示している。現 BLUEPRINT は 4 strategy しか定義しておらず、条件付きフィールドも不足。
- **Proposal:**
  1. CV Strategy を 8 種に拡張: kfold, stratified_kfold, group_kfold, stratified_group_kfold, time_series, purged_time_series, group_time_series, blocked_group_kfold
  2. Strategy ごとの条件付きフィールドを Widget に合わせて定義
  3. Folds を Slider から NumberInput（stepper）に変更
  4. CV Strategy の表示を Segment buttons（折返し可）に変更
  5. Config 自動反映マッピングに `data.time_col`, `split.gap`, `split.purge_gap`, `split.embargo` 等を追加
- **Impact:** BLUEPRINT.md §4.2.1, frontend DataPanel, lizyml_ui_schema.py
- **Compatibility:** 非破壊的
- **Acceptance Criteria:** BLUEPRINT §4.2.1 が Widget の CV 仕様と一致する
- **Decision:** 2026-03-22 accepted — Widget 踏襲方針

---

### H-0030: LizyML-Widget 画面仕様統合 — Model Panel Fit タブ拡張
- **Status:** accepted
- **Scope:** Frontend, Config
- **Related:** BLUEPRINT.md §4.2.2 Fit タブ
- **Context:** Widget の Fit タブでは (1) Smart Params / Model Params / Additional Params の3グループ分離、(2) Feature Weights Editor、(3) Inner Validation の Select 表示、(4) Additional Params のカタログ選択、(5) Objective の Segment buttons 表示、が実装されている。
- **Proposal:**
  1. Model セクションを3サブグループに視覚分離: Smart Params / Model Params / Additional Params
  2. Feature Weights Editor を追加: Toggle + column dropdown + weight stepper の Multi-row editor
  3. Inner Validation を Training セクション内に Select 表示（holdout / group_holdout / time_holdout）
  4. Additional Params をカタログドロップダウン選択に変更（`ui_schema.additional_params` から）
  5. Objective を Segment buttons に変更
  6. Evaluation メトリクスの選択肢を `ui_schema.option_sets.metric` から動的取得に統一
  7. Calibration methods を `ui_schema.calibration_methods` から動的取得
- **Impact:** BLUEPRINT.md §4.2.2, frontend ConfigForm, lizyml_ui_schema.py
- **Compatibility:** 非破壊的
- **Acceptance Criteria:** Fit タブが Widget と同等のグループ分け・Feature Weights・Inner Valid を持つ
- **Decision:** 2026-03-22 accepted — Widget 踏襲方針

---

### H-0031: LizyML-Widget 画面仕様統合 — Tune タブ拡張
- **Status:** accepted
- **Scope:** Frontend, Config
- **Related:** BLUEPRINT.md §4.2.2 Tune タブ
- **Context:** Widget の Tune タブでは (1) Search Space のグループ分け、(2) Tune 専用 Evaluation（Optimization Metric + Additional Metrics）、(3) direction 自動判定、(4) Empty space 許可、(5) Fixed 値の Fit 取り込みが実装されている。
- **Proposal:**
  1. Search Space テーブルを `group` フィールドでグループ分け表示
  2. Tune 専用 Evaluation セクション追加: Optimization Metric（single select）+ Additional Metrics（multi-select）
  3. direction Select を廃止し、`metric_direction` マップから自動判定
  4. Tune ボタン有効条件から「探索パラメータあり」を削除（empty space 許可）
  5. Tune タブ初回遷移時に Fit config の値を Fixed 値として取り込み
  6. `search_space_catalog` に `group` フィールドを追加
- **Impact:** BLUEPRINT.md §4.2.2, frontend TuneTab, lizyml_ui_schema.py
- **Compatibility:** 非破壊的
- **Acceptance Criteria:** Tune タブが Widget と同等の UX を持つ
- **Decision:** 2026-03-22 accepted — Widget 踏襲方針

---

### H-0032: Backend Contract capabilities セクション追加
- **Status:** accepted
- **Scope:** Adapter, Frontend
- **Related:** BLUEPRINT.md §3.3
- **Context:** Widget の backend contract には `capabilities` セクションがあり UI が機能を動的判定する。現 `get_ui_schema()` にはこれがない。
- **Proposal:**
  1. `get_ui_schema()` レスポンスに `capabilities` を追加: `cv_strategies`（8種リスト）、`tune.allow_empty_space`（boolean）
  2. `ui_schema` に `additional_params`, `calibration_methods` リストを追加
  3. `search_space_catalog` エントリに `group` フィールドを追加
  4. `conditional_visibility` に `early_stopping.*` 連動条件を追加
- **Impact:** lizyml_ui_schema.py, frontend
- **Compatibility:** 非破壊的（新フィールド追加のみ）
- **Acceptance Criteria:** `GET /api/backends/ui-schema` が capabilities 等を含む
- **Decision:** 2026-03-22 accepted — Widget 踏襲方針

---

### H-0033: Importance kind 選択機能の追加
- **Status:** accepted
- **Scope:** Adapter, API, Frontend
- **Related:** BLUEPRINT.md §3.3 BackendAdapter Protocol
- **Context:** Feature Importance が split のみ表示されている。LizyML は split / gain / shap の3種類をサポートするが、LizyStudio 側で kind を切り替える UI と API が不足。
- **Proposal:**
  1. `BackendAdapter` Protocol に `importance_kinds(model) -> list[str]` メソッド追加（デフォルト `["split"]`）
  2. LizyML Adapter で `["split", "gain", "shap"]` を返す実装
  3. API エンドポイント `GET /api/jobs/{job_id}/importance-kinds` 追加
  4. フロントエンド FoldDetailsSection に kind セレクタ（SegmentGroup）追加
  5. `fetchJobImportance(jobId, kind)` の kind パラメータを UI から制御
- **Impact:** base.py（Protocol）、lizyml.py（Adapter）、api/jobs.py、FoldDetailsSection.tsx、ResultsPanel.tsx、api/jobs.ts
- **Compatibility:** 非破壊的（Protocol にデフォルト実装付きメソッド追加、新 API エンドポイント追加のみ）
- **Alternatives:** ハードコードで kind リストをフロントに持つ案 → バックエンド依存の種別なので動的取得が適切
- **Acceptance Criteria:**
  1. Importance セクションで split / gain / shap を切り替えられる
  2. 選択した kind に応じてテーブルとプロットが更新される
  3. 既存テストが全パス
- **Decision:** 2026-03-28 accepted

---

### H-0034: LizyML v0.7.0 対応 — MetricEntry / Training Metric / Learning Curve Filter
- **Status:** accepted
- **Scope:** Adapter, API, Frontend, Config
- **Related:** BLUEPRINT.md §3.3 BackendAdapter Protocol、§4.2.1 Model Panel、§4.2.3 Tune Tab
- **Context:** LizyML v0.5.0〜v0.7.0 で以下の機能が追加された:
  1. `model.params.metric` のユーザー指定（v0.5.0 / H-0061）
  2. `plot_learning_curve(metrics=[...])` フィルター（v0.5.0 / H-0062）
  3. Metric Bridge — feval カスタムメトリクス対応（v0.6.0 / H-0064）
  4. `MetricEntry` パラメータ付きメトリクス — `{"precision_at_k": {"k": 20}}`（v0.7.0 / H-0065）
  現在 LizyStudio は `lizyml>=0.4.0,<0.5.0` に固定されており、これらの機能を利用できない。
- **Proposal:**
  **Phase 1: 依存更新 + Adapter 対応**
  - `pyproject.toml` のバージョンピンを `>=0.7.0,<0.8.0` に更新
  - `LizyMLAdapter.plot()` で `learning-curve` 呼び出し時に `metrics` パラメータを転送
  - `BackendAdapter.plot()` の signature に `**kwargs` を追加（learning curve filter 用）
  - `lizyml_ui_schema.py` のフォールバックメトリクス名を修正（`binary_logloss` → `logloss` 等）

  **Phase 2: API 拡張**
  - `GET /api/jobs/{job_id}/plot/learning-curve?metrics=auc,f1` — メトリクスフィルターパラメータ追加
  - Config schema の `evaluation.metrics` が `list[str | dict]` に自然拡張される（Pydantic → JSON Schema）

  **Phase 3: フロントエンド UI 更新**
  - `MetricsChips` の `precision_at_k` パラメータを `MetricEntry` dict 形式で config に書き込み
    - 現在: `config.evaluation.metrics = ["auc", "precision_at_k"]` + `config.evaluation.precision_at_k = 20`
    - 変更後: `config.evaluation.metrics = ["auc", {"precision_at_k": {"k": 20}}]`
  - Tune Evaluation セクションも同様に `MetricEntry` 対応
  - Learning Curve プロットにメトリクスフィルター UI（チップ選択）追加
  - `config.evaluation.precision_at_k` フィールドを廃止（`MetricEntry` dict に統合）

- **Impact:**
  - `pyproject.toml`, `uv.lock`
  - `backends/base.py`（Protocol: plot kwargs）
  - `backends/lizyml.py`（Adapter: learning curve filter 転送）
  - `backends/lizyml_ui_schema.py`（フォールバック名修正）
  - `backends/types.py`（変更なし — PlotData は plotly_json のみで MetricEntry の通過不要）
  - `api/jobs.py`（learning curve filter query param）
  - `frontend/src/components/workspace/MetricsChips.tsx`（MetricEntry 形式出力）
  - `frontend/src/components/workspace/ConfigForm.tsx`（precision_at_k 統合）
  - `frontend/src/components/workspace/TuneTab.tsx`（MetricEntry 対応）
  - `frontend/src/components/workspace/PlotSection.tsx`（learning curve filter UI）
  - `frontend/src/components/workspace/ResultsPanel.tsx`（annotateMetric 更新）
  - `frontend/src/api/jobs.ts`（fetchJobPlot に metrics param 追加）
- **Compatibility:** 非破壊的（バージョン更新、API は query param 追加のみ、Config は上位互換）
- **Alternatives:**
  - `precision_at_k` の k を引き続き `config.evaluation.precision_at_k` に分離保持する案 → LizyML 0.7.0 の `MetricEntry` 設計と不一致、config 変換ロジックが複雑化するため不採用
  - Learning Curve フィルターをフロントエンドのみで実装（Plotly subplot 表示/非表示）する案 → サーバーサイドで不要なサブプロットを生成する無駄があるため不採用
- **Acceptance Criteria:**
  1. `lizyml>=0.7.0` でテストが全パス
  2. `precision_at_k` 選択時に k 値を指定でき、config に `{"precision_at_k": {"k": N}}` 形式で保存される
  3. Tune Evaluation でも同様に `MetricEntry` 形式が使用される
  4. Learning Curve プロットで表示メトリクスをフィルター可能
  5. 既存テストが全パス + 新機能のテストカバレッジ 80%+
- **Decision:** 2026-03-28 accepted — 提案通り

---

### H-0035: WebSocket 再接続プロトコルの実装
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §3.1、frontend/src/api/websocket.ts
- **Context:** 現在の `connectJobProgress` は WebSocket 切断時の再接続ロジックを持たない。ネットワーク不安定やブラウザのスリープ復帰時に接続が切れると、ジョブ進捗が消失しユーザーに完了通知が届かない。LizyML-Widget では Colab 環境でのコネクション不安定に対処するためポーリングフォールバックと再接続パターンを実装しており、その知見を活用する。
- **Proposal:**
  1. `connectJobProgress` に指数バックオフ再接続ロジックを追加:
     - 再接続間隔: 1s → 2s → 4s → 8s → max 30s
     - 最大リトライ回数: 10回（超過でユーザーにトースト通知）
  2. 再接続成功後、既存の `GET /api/jobs/{job_id}` でジョブ状態を復元し、`completed` / `failed` の場合は結果表示に遷移
  3. `onReconnect` コールバックを追加し、呼び出し元（ResultsPanel）が状態を同期可能にする
- **Impact:** frontend/src/api/websocket.ts、frontend/src/components/workspace/ResultsPanel.tsx
- **Compatibility:** 非破壊的（既存 API 変更なし、フロントエンドのみ）
- **Alternatives:** Server-Sent Events (SSE) に切り替える案 → 既存 WebSocket インフラを活かすほうが低コスト。フォールバックポーリング（Widget 方式）案 → Studio は Colab 環境を考慮不要なため WebSocket 再接続で十分
- **Acceptance Criteria:**
  1. WebSocket 切断後、自動再接続が発火する
  2. 再接続成功後にジョブ状態が正しく復元される
  3. 最大リトライ超過時にユーザー通知が表示される
  4. 既存テストが全パス
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0036: OpenMP デーモンスレッド劣化対策（サブプロセスフォールバック）
- **Status:** accepted
- **Scope:** Backend
- **Related:** BLUEPRINT.md §3.2（Service レイヤー）、services/training.py
- **Context:** `start_fit_async` / `start_tune_async` はデーモンスレッドで ML バックエンドを実行する。LizyML-Widget の本番運用で、libgomp (OpenMP) がスレッドプールを最初の利用スレッドにバインドする仕様により、デーモンスレッドから LightGBM を実行すると 50x の性能劣化が発生することが判明した（Widget learned skill: `openmp-daemon-thread-degradation`）。Widget では `subprocess_runner.py` でプロセス分離フォールバックを実装済み。
- **Proposal:**
  1. OpenMP 検出ユーティリティを追加（`libomp.so` / `libgomp.so` の存在チェック）
  2. OpenMP 検出時は `subprocess` ベースのジョブワーカーにフォールバック
  3. 環境変数 `LIZYSTUDIO_FORCE_SUBPROCESS=1` で強制サブプロセスモードを選択可能
  4. サブプロセスワーカーは結果をテンポラリファイル経由で親プロセスに返却
  5. 新ジョブ開始前に前回スレッド/プロセスを `join()` する（`openmp-thread-pool-accumulation` 対策）
- **Impact:** services/training.py（ジョブ実行部分の大幅変更）、新規: services/subprocess_runner.py、services/openmp_detect.py
- **Compatibility:** 非破壊的（デフォルト動作は変わらない。OpenMP 検出時のみサブプロセス化）
- **Alternatives:**
  - `LD_PRELOAD=libomp.so` でユーザーに対処を求める案 → UX が悪く、サポートコストが高い
  - `asyncio.to_thread` に変更する案 → GIL 解放されるが OpenMP 問題は解決しない
  - デーモンスレッドを非デーモンに変更する案 → サーバー終了時にハングする可能性
- **Acceptance Criteria:**
  1. OpenMP 環境で Fit/Tune の性能がメインスレッド実行と同等であること
  2. 非 OpenMP 環境ではスレッドベース実行のまま（既存動作維持）
  3. `LIZYSTUDIO_FORCE_SUBPROCESS=1` でサブプロセスモードが強制される
  4. 前回ジョブのスレッド/プロセスが新ジョブ開始前に join される
  5. 既存テストが全パス + サブプロセスモードのテスト追加
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0037: PATCH /api/workspace/config — Config パッチプロトコルの導入
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.2（Workspace API）、api/workspace.py
- **Context:** 現在の `PUT /api/workspace/config` は Config 全体を置換する。フロントエンドが単一フィールドを変更する場合でも Config 全体を送信する必要があり、ネットワーク効率が悪い。また、全体置換では並行編集での意図しない上書きリスクがある。LizyML-Widget では `ConfigPatchOp` による細粒度パッチプロトコルを実装しており、パスバリデーション（正規表現 `/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/`）と dunder (`__`) パス拒否により安全性を確保している。
- **Proposal:**
  1. `PATCH /api/workspace/config` エンドポイントを追加
  2. リクエストボディ:
     ```json
     {
       "ops": [
         { "op": "set", "path": "model.params.learning_rate", "value": 0.05 },
         { "op": "unset", "path": "model.params.reg_lambda" },
         { "op": "merge", "path": "training", "value": { "seed": 42 } }
       ]
     }
     ```
  3. パスバリデーション:
     - 正規表現: `/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/`
     - dunder (`__`) を含むパスを拒否
     - op: `"set"` | `"unset"` | `"merge"` のみ許可
  4. 既存の `PUT /api/workspace/config` は後方互換として維持
  5. エラーレスポンス: `{ "error": { "code": "INVALID_PATCH", "message": "..." } }` (HTTP 422)
- **Impact:** api/workspace.py、services/workspace.py（パッチ適用ロジック追加）、api/errors.py（INVALID_PATCH エラー追加）、frontend/src/api/workspace.ts
- **Compatibility:** 非破壊的（新規エンドポイント追加、既存 PUT は維持）
- **Alternatives:**
  - JSON Patch (RFC 6902) を採用する案 → 配列操作やパス表現が複雑すぎる（ML Config には不要）
  - PUT のみ維持し楽観ロック（ETag）を追加する案 → 実装コストが高く、並行編集の UX が悪い
- **Acceptance Criteria:**
  1. `PATCH /api/workspace/config` が正しく Config を部分更新する
  2. 不正なパス（dunder 含む、正規表現不一致）で 422 が返る
  3. 不正な op で 422 が返る
  4. 既存 `PUT /api/workspace/config` が引き続き動作する
  5. フロントエンドが PATCH を使用するように更新される
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0038: DataFrame メモリ上限チェックの追加
- **Status:** accepted
- **Scope:** Backend
- **Related:** BLUEPRINT.md §4.2.1（Data Source）、security.py
- **Context:** 現在のアップロードサイズ制限（`MAX_UPLOAD_BYTES = 100MB`）はファイルサイズのみをチェックする。Parquet ファイルは高圧縮されるため、100MB のファイルが展開後に数 GB のメモリを消費する可能性がある。LizyML-Widget の移植計画では `df.memory_usage(deep=True).sum()` による展開後チェックと環境変数による上限設定を定義している。
- **Proposal:**
  1. `load_dataframe` 後に `df.memory_usage(deep=True).sum()` でメモリ使用量を計算
  2. 環境変数 `LIZYSTUDIO_MAX_DF_MEMORY`（デフォルト: 2GB）でメモリ上限を設定可能
  3. 上限超過時は `FileInvalidError` を raise し、メッセージにファイルサイズとメモリ使用量を含める
  4. `/api/workspace/data/load` のレスポンスに `memory_usage_bytes` フィールドを追加（情報表示用）
- **Impact:** security.py（チェック追加）、api/workspace.py（data/load エンドポイント）、services/data.py
- **Compatibility:** 非破壊的（新規チェック追加。デフォルト上限 2GB は十分大きい）
- **Alternatives:**
  - アップロードサイズ上限のみで対処する案 → Parquet の圧縮率が予測不可能なため不十分
  - 読み込み前にスキーマのみ解析してメモリを推定する案 → 精度が低く実装が複雑
- **Acceptance Criteria:**
  1. 展開後メモリが上限を超えるデータで `FileInvalidError` が返る
  2. 環境変数でメモリ上限をカスタマイズ可能
  3. エラーメッセージにファイルサイズとメモリ使用量が含まれる
  4. 正常なデータで既存動作に影響がない
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0039: Content Security Policy (CSP) ヘッダーの追加
- **Status:** accepted
- **Scope:** Backend
- **Related:** BLUEPRINT.md §3.1（全体構成）、server.py
- **Context:** 現在のサーバーには CSP ヘッダーが設定されていない。localhost 専用のため即座の脅威は低いが、将来のリモートアクセス対応やセキュリティ監査に備え、XSS 防御を強化すべきである。LizyML-Widget 移植計画でも CSP を明示的に定義している。
- **Proposal:**
  1. `server.py` に CSP ミドルウェアを追加
  2. CSP ポリシー:
     ```
     default-src 'self';
     script-src 'self';
     style-src 'self' 'unsafe-inline';
     connect-src 'self' ws://localhost:*;
     img-src 'self' data: blob:;
     font-src 'self';
     ```
  3. 開発モード（`--reload`）では CSP を緩和または無効化（HMR 対応）
  4. `X-Content-Type-Options: nosniff` と `X-Frame-Options: DENY` も同時に追加
- **Impact:** server.py（ミドルウェア追加）
- **Compatibility:** 非破壊的（ヘッダー追加のみ。`'unsafe-inline'` は既存 Tailwind インラインスタイルに必要）
- **Alternatives:**
  - Nginx / リバースプロキシで CSP を設定する案 → Studio は `pip install` 単体で動く前提のため不適切
  - `nonce` ベースの CSP にする案 → Vite のバンドルと相性が悪く実装コストが高い
- **Acceptance Criteria:**
  1. 本番モードでレスポンスに CSP ヘッダーが付与される
  2. `X-Content-Type-Options`, `X-Frame-Options` も付与される
  3. 開発モードで HMR が正常動作する
  4. Plotly のレンダリングが CSP でブロックされない
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0040: ワーカースレッド join 漏れ対策
- **Status:** accepted
- **Scope:** Backend
- **Related:** services/training.py
- **Context:** `start_fit_async` / `start_tune_async` で作成されたワーカースレッドは `WorkspaceState` に保持されず、新ジョブ開始前に前回スレッドの `join()` が行われない。LizyML-Widget では `openmp-thread-pool-accumulation` として、unjoin'd ワーカースレッドが OpenMP スレッドプールを蓄積し OS リソースを圧迫する問題が学習済み。H-0036 の前提条件となる。
- **Proposal:**
  1. `WorkspaceState` に `_job_thread: threading.Thread | None` フィールドを追加
  2. 新ジョブ開始前に `_job_thread` が alive であれば `join(timeout=5)` を実行
  3. join タイムアウト時はログ警告を出して続行（デッドロック防止）
  4. `cancel_requested` 時にもスレッド参照を保持し、キャンセル後の join を保証
- **Impact:** services/training.py（start_fit_async, start_tune_async）、services/workspace.py（WorkspaceState 拡張）
- **Compatibility:** 非破壊的（内部実装変更のみ）
- **Alternatives:**
  - `concurrent.futures.ThreadPoolExecutor(max_workers=1)` を使う案 → キャンセル機構との統合が複雑
  - スレッドプールサイズを制限する案 → OpenMP の問題は解決しない
- **Acceptance Criteria:**
  1. 連続して Fit を実行しても前回スレッドが join される
  2. スレッドリソースが蓄積しない（`threading.active_count()` が安定）
  3. join タイムアウト時にデッドロックしない
  4. 既存テストが全パス
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0041: エラーコードの拡充
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §6.1（エラーレスポンス）、api/errors.py
- **Context:** 現在のエラー体系は 12 種類で、一部のエラーが汎用コードに統合されている。LizyML-Widget は 17 種類のエラーコードを持ち、フロントエンドでのエラーメッセージ出し分けに活用している。特に Config ビルド失敗と YAML パースエラーが `VALIDATION_ERROR` / `FILE_INVALID` に統合されており、ユーザーへのガイダンスが不明確。
- **Proposal:**
  1. `ConfigBuildError` を追加（code: `CONFIG_BUILD_ERROR`, HTTP 400）— Config の組み立てに失敗した場合（必須フィールド不足等）
  2. `ConfigImportError` を追加（code: `CONFIG_IMPORT_ERROR`, HTTP 400）— YAML/JSON のパースまたは構造エラー
  3. `ExportError` を追加（code: `EXPORT_ERROR`, HTTP 500）— モデル/レポートのエクスポート失敗
  4. 既存コードは維持し、後方互換を保つ
- **Impact:** api/errors.py（3 エラークラス追加）、api/workspace.py（config 関連エンドポイント）、api/jobs.py（export エンドポイント）
- **Compatibility:** 非破壊的（新規エラーコード追加。既存コードは変更なし）
- **Alternatives:**
  - Widget と完全に同一のコード体系にする案 → Studio と Widget で画面構成が異なるため、Studio に不要なコード（`NO_TARGET` 等は Studio では `VALIDATION_ERROR` で十分）を含めるのは過剰
  - エラーコードを細分化せず `details` で区別する案 → フロントエンドの条件分岐が `details` パースに依存し脆弱
- **Acceptance Criteria:**
  1. Config ビルド失敗時に `CONFIG_BUILD_ERROR` が返る
  2. YAML インポート失敗時に `CONFIG_IMPORT_ERROR` が返る
  3. エクスポート失敗時に `EXPORT_ERROR` が返る
  4. 既存エラーコードの動作が変わらない
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0042: セキュリティ方針の文書化
- **Status:** accepted
- **Scope:** Config
- **Related:** BLUEPRINT.md、CLAUDE.md §7-8
- **Context:** Studio の実装はセキュリティ上安全だが（`yaml.safe_load` 使用、パストラバーサル防止、アップロードサイズ制限）、セキュリティ方針としては文書化されていない。LizyML-Widget 移植計画では YAML パース方針、ファイルアップロードのサニタイズ手順、入力バリデーションルールを明文化しており、ガバナンスとして参考にすべきである。
- **Proposal:** BLUEPRINT.md に「§7. セキュリティ方針」セクションを追加し、以下を文書化:
  1. **YAML パース**: `yaml.safe_load` のみ使用。`yaml.load` は禁止
  2. **ファイルアップロード**:
     - 拡張子チェック（`.csv`, `.tsv`, `.parquet` のみ）
     - Content-Type とのクロスチェック
     - pandas の `engine='c'` 推奨（eval 系の脆弱性回避）
     - ファイル名のサニタイズ（`os.path.basename` + パストラバーサル防止）
     - アップロードサイズ上限 + メモリ使用量上限（H-0038）
  3. **入力バリデーション**:
     - Config パッチのパスバリデーション（H-0037）
     - dunder (`__`) インジェクション防止
     - サーバーサイドファイルブラウザのパストラバーサル防止（`validate_path_within`）
  4. **HTTP ヘッダー**: CSP, X-Content-Type-Options, X-Frame-Options（H-0039）
  5. **localhost 前提での制限緩和**: 認証不要、CSRF トークン不要、Rate limiting 不要。将来リモート対応時に追加する旨を明記
- **Impact:** BLUEPRINT.md（新規セクション追加）
- **Compatibility:** 非破壊的（ドキュメント追加のみ）
- **Alternatives:** 別ファイル `SECURITY.md` に分離する案 → BLUEPRINT が仕様の正であるため、BLUEPRINT 内に含めるほうが参照しやすい
- **Acceptance Criteria:**
  1. BLUEPRINT.md にセキュリティ方針セクションが存在する
  2. 上記 5 項目がすべて記載されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0043: openapi-typescript 生成型の実活用（手書き型からの段階的移行）
- **Status:** accepted
- **Scope:** Frontend
- **Related:** CLAUDE.md §3（API型生成: openapi-typescript）、frontend/src/api/
- **Context:** CLAUDE.md §7 で「フロントエンドで API 型を手書きすること」は禁止されているが、現在 `frontend/src/api/types.ts` に手書き型が存在し、API 関数は自動生成型 (`generated/schema.d.ts`) ではなく手書き型を参照している。型のズレが生じるリスクがあり、CLAUDE.md の方針と矛盾する。
- **Proposal:**
  1. API 関数（`workspace.ts`, `jobs.ts`, `inference.ts`）の戻り値型とリクエスト型を `generated/schema.d.ts` の型に段階的に移行
  2. `types.ts` の手書き型を削減し、最終的には `generated/schema.d.ts` の re-export のみに
  3. CI に型生成チェックを追加: `pnpm generate:api && git diff --exit-code frontend/src/api/generated/` で生成型とコミット済み型の一致を検証
  4. `pnpm generate:api` をバックエンド変更時の pre-commit フックに追加
- **Impact:** frontend/src/api/types.ts（段階的削除）、frontend/src/api/*.ts（import 先変更）、CI 設定
- **Compatibility:** 非破壊的（内部リファクタリング。API は変更なし）
- **Alternatives:**
  - 手書き型をテストで自動生成型と比較する案 → 二重管理の解消にならない
  - 手書き型を一括削除する案 → 一度に大量の変更が発生しリスクが高い
- **Acceptance Criteria:**
  1. API 関数が `generated/schema.d.ts` の型を直接参照している
  2. `types.ts` に手書きの API レスポンス型が存在しない
  3. CI で型生成チェックが自動実行される
  4. `pnpm check` が全パス
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0044: CV Fold Preview の視覚化コンポーネント追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.1（Cross Validation）、frontend/src/components/workspace/CvSection.tsx
- **Context:** 現在の CV セクションは Strategy 選択とパラメータ入力のみで、設定した CV がどのようにデータを分割するかの視覚的フィードバックがない。LizyML-Widget では `FoldPreview.tsx` で以下の視覚化を実装しており、特に BlockedGroupKFold のような複雑な CV 戦略の理解に有効であることが実証されている:
  - 時間 fold × グループ fold のマトリクス表示
  - Train（青）/ Valid（橙）/ Unused（灰）のカラーブロックによる期間フロー図
  - `P0+P1 → P2` 形式の期間構造パース
  - Fold ごとの Train/Valid サイズ表示テーブル
- **Proposal:**
  1. `FoldPreview` コンポーネントを新規作成（`frontend/src/components/workspace/FoldPreview.tsx`）
  2. 表示内容:
     - サマリーバッジ: `"Total: {N} folds ({T} time × {G} groups)"`
     - 期間フロー図: 各時間 fold を行とし、期間ブロックを Train/Valid/Unused で色分け
     - 詳細テーブル: Fold #、構造（train期間 → valid期間 + グループ）、Train サイズ、Valid サイズ
  3. データソース: 既存の `GET /api/workspace/data/split-preview` を活用（または新設）
  4. CvSection の下部に配置。CV 設定変更時に自動リフレッシュ（debounce 500ms）
  5. 色定義: Tailwind のカスタムカラー — `bg-blue-500/20`（train）、`bg-orange-500/20`（valid）、`bg-muted`（unused）
- **Impact:** frontend/src/components/workspace/FoldPreview.tsx（新規）、CvSection.tsx（FoldPreview 埋め込み）、api/workspace.py（split-preview エンドポイント確認）
- **Compatibility:** 非破壊的（UI 追加のみ）
- **Alternatives:**
  - テキストテーブルのみで表示する案 → BlockedGroupKFold の時間×グループの2軸構造が直感的に伝わらない
  - Plotly チャートで描画する案 → 単純なカラーブロックに Plotly は過剰。HTML + CSS で十分
- **Acceptance Criteria:**
  1. CV 設定後に視覚的な Fold プレビューが表示される
  2. Train/Valid/Unused が色分けされている
  3. Fold 数、各 Fold の Train/Valid サイズが確認できる
  4. 設定変更時にプレビューが更新される
  5. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0045: BlockedGroupKFold 専用 2軸エディタの追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.1（Cross Validation — Blocks/Groups フィールド）、frontend/src/components/workspace/CvSection.tsx
- **Context:** BlockedGroupKFold は時間軸（Blocks）× エンティティ軸（Groups）の2軸で CV 分割を定義する複雑な戦略であり、汎用フォームフィールドでは設定が困難。LizyML-Widget では `BlockedGroupKFold.tsx` で専用の2軸エディタを実装しており、以下の要素で直感的な設定を実現している:
  - **Blocks セクション**: カラム選択 → 値分布バー表示 → カットオフ地点をチップ選択 → 結果の期間（P0, P1, ...）と行数プレビュー → Expanding/Sliding モード切替 → Train Window ステッパー（Sliding 時のみ）
  - **Groups セクション**: カラム選択（Blocks カラムを除外）→ n_splits → stratify (auto/on/off) → shuffle
  - **統合プレビュー**: H-0044 の FoldPreview + Min Train/Valid Rows 設定
- **Proposal:**
  1. `BlockedGroupKFoldEditor` コンポーネントを新規作成
  2. CvSection で strategy が `blocked_group_kfold` の場合にこのエディタに切り替え
  3. **Blocks サブセクション**:
     - カラム選択（Select）
     - 選択カラムのユニーク値分布バー（`GET /api/workspace/data/column-stats/{col}` を活用）
     - カットオフ値のチップ選択（クリックでトグル、最後の値は常に ON で disabled）
     - 結果の期間一覧（P0〜Pn）と各期間の行数
     - モード切替: Expanding / Sliding（SegmentGroup）
     - Train Window: NumberInput（Sliding モード時のみ表示）
  4. **Groups サブセクション**:
     - カラム選択（Blocks カラムを除外したリスト）
     - n_splits: NumberInput (2-10)
     - stratify: SegmentGroup (auto / on / off)
     - shuffle: Switch
  5. **Min Rows サブセクション**:
     - Min Train Rows: NumberInput（nullable）
     - Min Valid Rows: NumberInput（nullable）
- **Impact:** frontend/src/components/workspace/BlockedGroupKFoldEditor.tsx（新規）、CvSection.tsx（条件分岐追加）、api/workspace.ts（column-stats API 呼び出し）
- **Compatibility:** 非破壊的（UI コンポーネント追加。API は既存を活用）
- **Alternatives:**
  - 汎用フォームで JSON 入力させる案 → UX が著しく悪い。カットオフ値の手入力はエラーが頻発する
  - Blocks と Groups を別画面に分離する案 → 2軸の関係が見えなくなり設定ミスが増える
- **Acceptance Criteria:**
  1. BlockedGroupKFold 選択時に専用エディタが表示される
  2. カットオフ地点をチップで視覚的に選択できる
  3. カラムの値分布がバーで表示される
  4. Expanding/Sliding モードの切替が機能する
  5. Groups カラム選択で Blocks カラムが除外される
  6. H-0044 の FoldPreview と統合されている
  7. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0046: カラム値分布バーコンポーネントの追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.1（Column Settings）、frontend/src/components/workspace/DataPanel.tsx
- **Context:** 現在の Column Settings テーブルはカラム名・ユニーク数・Type・除外状態のみを表示する。LizyML-Widget ではカラム統計取得時にユニーク値のヒストグラム/分布バー（`DistributionBar`）を表示しており、カテゴリカラムの値分布把握や CV カットオフ設定に有効。また、数値カラムの分布の偏りを視覚的に確認できることで、前処理の必要性判断に役立つ。
- **Proposal:**
  1. `DistributionBar` コンポーネントを新規作成（`frontend/src/components/workspace/DistributionBar.tsx`）
  2. 表示:
     - 横バー形式。各値の出現頻度に比例した幅のセグメント
     - カテゴリカル: 上位 N 値 + "other" セグメント（色分け）
     - 数値: ヒストグラム風バー（ビン分割）
     - ホバーで値と件数のツールチップ表示
  3. データソース: `GET /api/workspace/data/column-stats/{col}` のレスポンスに `value_counts` を追加（上位 20 値 + other）
  4. 利用箇所:
     - Column Settings テーブルの行展開（Accordion）で表示
     - H-0045 の BlockedGroupKFoldEditor のカットオフ選択画面
  5. サイズ: 高さ 8px、幅は親コンテナに追従
- **Impact:** frontend/src/components/workspace/DistributionBar.tsx（新規）、DataPanel.tsx（行展開追加）、api/workspace.py（column-stats レスポンス拡張）、services/data.py
- **Compatibility:** 非破壊的（UI 追加 + API レスポンス拡張）
- **Alternatives:**
  - Plotly ヒストグラムで描画する案 → 8px バーに Plotly は過剰。CSS で十分
  - テキストで上位値を列挙する案 → 分布の偏りが直感的に伝わらない
- **Acceptance Criteria:**
  1. カラム選択時にユニーク値の分布バーが表示される
  2. ホバーで値と件数が確認できる
  3. カテゴリ/数値カラムで適切な表示が切り替わる
  4. API が `value_counts` を返す
  5. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0047: Fold 進捗のリアルタイムスコア表示
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.3（Results Panel — Running 状態）、frontend/src/components/workspace/ResultsPanel.tsx
- **Context:** 現在の進捗表示は WebSocket 経由のテキストメッセージを蓄積表示するのみ。LizyML-Widget では `ProgressView.tsx` で Fold ごとの評価スコアを逐次表示しており、学習の進行状況と品質を早期に把握できる:
  ```
  Fold 1/5: AUC = 0.892 ✓
  Fold 2/5: AUC = 0.905 ✓
  Fold 3/5: ──（実行中）
  ```
  これにより、早期のスコア劣化を検知してキャンセル→設定見直しの判断が可能になる。
- **Proposal:**
  1. WebSocket 進捗メッセージに `fold_results` フィールドを追加（バックエンド）:
     ```json
     {
       "type": "progress",
       "current": 2, "total": 5,
       "message": "Training fold 3/5...",
       "fold_results": [
         { "fold": 1, "metric": "auc", "score": 0.892 },
         { "fold": 2, "metric": "auc", "score": 0.905 }
       ]
     }
     ```
  2. `FoldProgressList` コンポーネントを新規作成:
     - 完了 fold: メトリクス名 + スコア + ✓ アイコン（緑）
     - 実行中 fold: プログレスインジケータ
     - 未実行 fold: ダッシュ（──）
  3. ResultsPanel の Running 状態に `FoldProgressList` を追加
  4. Fit/Tune の進捗コールバック (`on_progress`) で fold 完了時にスコアを含める
- **Impact:** frontend/src/components/workspace/FoldProgressList.tsx（新規）、ResultsPanel.tsx（組み込み）、services/training.py（fold_results 追加）、ws/progress.py（WebSocket メッセージ拡張）
- **Compatibility:** 非破壊的（WebSocket メッセージにフィールド追加。既存フィールドは変更なし）
- **Alternatives:**
  - 完了後にのみ全 fold スコアを表示する案 → 早期キャンセル判断ができない
  - ログテキストにスコアを埋め込む案 → パースが必要で脆弱。構造化データのほうが確実
- **Acceptance Criteria:**
  1. Fit/Tune 実行中に完了した fold のスコアがリアルタイム表示される
  2. 未完了の fold はダッシュで表示される
  3. スコアの劣化が視覚的に判別できる
  4. 既存の進捗表示（メッセージ、プログレスバー）が維持される
  5. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0048: Search Space Fixed モードのセグメントボタン表示
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.2（Tune タブ — Search Space）、frontend/src/components/workspace/SearchSpaceTable.tsx
- **Context:** 現在の `FixedValueEditor` は boolean と少数 enum（2-4個）の値に対して Select ドロップダウンを使用している。LizyML-Widget では `SearchSpace.tsx` で boolean と少数 enum をセグメントボタン（SegmentGroup）で表示しており、1クリックで値を切り替え可能。探索空間の設定は反復的に行う操作であり、クリック数の削減が UX 向上に直結する。
- **Proposal:**
  1. `FixedValueEditor` を以下のルールで表示方法を分岐:
     - `boolean` → SegmentGroup（`True` / `False` の2ボタン）— 現状維持（既に実装済み）
     - `enum` で選択肢が **4個以下** → SegmentGroup
     - `enum` で選択肢が **5個以上** → Select ドロップダウン（現状維持）
     - `array` with enum items → ChipGroup（現状維持）
  2. SegmentGroup のスタイル: shadcn ToggleGroup を使用。コンパクトサイズ（`size="sm"`）
  3. 閾値（4個）は定数として抽出し、将来の調整を容易にする
- **Impact:** frontend/src/components/workspace/SearchSpaceTable.tsx（FixedValueEditor 分岐追加）
- **Compatibility:** 非破壊的（表示方法の変更のみ。データ形式は変更なし）
- **Alternatives:**
  - 全 enum にセグメントボタンを使う案 → 選択肢が多い場合にレイアウトが崩れる
  - Radio ボタンにする案 → セグメントボタンのほうがコンパクトで探索空間テーブルに適合する
- **Acceptance Criteria:**
  1. boolean パラメータがセグメントボタンで表示される
  2. 4個以下の enum パラメータがセグメントボタンで表示される
  3. 5個以上の enum は従来の Select ドロップダウンのまま
  4. 値の選択が1クリックで完了する
  5. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0049: Running 中の Config 編集ロック
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.2（Model Panel）、frontend/src/components/workspace/ModelPanel.tsx、TuneTab.tsx
- **Context:** 現在の Studio では Fit/Tune 実行中（Running 状態）でも Model Panel と Tune タブの Config 編集が可能。ユーザーが実行中に Config を変更すると、表示中の結果と Config の対応関係が不明確になり混乱を招く。LizyML-Widget では Running 中に `pointer-events: none` + `opacity: 0.6` で Config 編集を物理的にブロックしており（ConfigTab.tsx L198）、実行中の Config 変更による混乱を防止している。
- **Proposal:**
  1. Model Panel と Tune タブに Running 状態の検出を追加
  2. Running 中の表示:
     - Config フォーム全体に `pointer-events: none` + `opacity: 0.6` を適用
     - フォーム上部にインフォバー表示: "ジョブ実行中は Config を変更できません"（shadcn Alert、info variant）
  3. Fit/Tune ボタンを Running 中は "Running..." テキスト + disabled 状態に変更
  4. Cancel ボタンのみ操作可能に維持
  5. Running → Completed/Failed 遷移時にロックを自動解除
- **Impact:** frontend/src/components/workspace/ModelPanel.tsx、TuneTab.tsx、ConfigForm.tsx
- **Compatibility:** 非破壊的（UI 動作変更のみ）
- **Alternatives:**
  - 変更を許可し次回ジョブに反映する案（現状） → ユーザーが「変更が即座に反映される」と誤解するリスク
  - 警告ダイアログを表示するが変更は許可する案 → ダイアログ疲れを起こし、結局混乱を防げない
- **Acceptance Criteria:**
  1. Running 中に Config フォームが操作不可になる
  2. インフォバーで理由が表示される
  3. Cancel ボタンは操作可能
  4. 完了後にロックが解除される
  5. Fit/Tune ボタンが Running 中に disabled になる
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0050: Jobs 詳細画面の KPI カード表示統一
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.3.2（Jobs 詳細画面）、frontend/src/components/jobs/CompletedContent.tsx
- **Context:** Workspace の ResultsPanel ではメトリクスを **KPI カード形式**（metric name + IS / OOS / Std の3値カード）で表示しているが、Jobs 詳細画面の CompletedContent では **テーブル形式**（ScoreSection）で表示している。同じ Fit 結果を見ているのに表示形式が異なり、ユーザー体験の一貫性が損なわれている。
- **Proposal:**
  1. CompletedContent のメトリクス表示を ResultsPanel と同じ KPI カードコンポーネントに統一
  2. KPI カードコンポーネントを `components/shared/MetricCards.tsx` として抽出し、ResultsPanel と CompletedContent の両方で使用
  3. ScoreSection（テーブル形式）は KPI カードの下に "View Details" リンクで展開可能なアコーディオンとして残す（全 fold の詳細を見たい場合用）
- **Impact:** frontend/src/components/jobs/CompletedContent.tsx（KPI カード使用）、frontend/src/components/shared/MetricCards.tsx（新規抽出）、frontend/src/components/workspace/ResultsPanel.tsx（共通コンポーネント使用）
- **Compatibility:** 非破壊的（表示変更のみ）
- **Alternatives:**
  - ResultsPanel をテーブル形式に統一する案 → KPI カードのほうが一目でスコアを把握しやすく、Workspace の反復作業に適している
  - Jobs 詳細のみ独自デザインにする案 → 一貫性がない
- **Acceptance Criteria:**
  1. Jobs 詳細画面で KPI カードが表示される
  2. ResultsPanel と同じコンポーネントを使用している
  3. テーブル形式はアコーディオン内で引き続き利用可能
  4. Storybook にストーリーが追加されている
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0051: Jobs 詳細画面の Learning Curve メトリクスフィルター追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.3.2（Jobs 詳細画面 — Plots）、frontend/src/components/jobs/CompletedContent.tsx
- **Context:** Workspace の ResultsPanel では Learning Curve プロットのメトリクスフィルター（chip 選択で表示メトリクスを切替）が実装されているが、Jobs 詳細画面の CompletedContent では Learning Curve フィルターが未実装。複数メトリクスを使用する場合、全メトリクスの Learning Curve が重なって表示され見づらい。LizyML-Widget でも Learning Curve のメトリクスフィルターは Results 画面の重要機能として実装されている。
- **Proposal:**
  1. CompletedContent の PlotSection に `lcMetrics` state を追加
  2. Learning Curve 選択時にメトリクス chip フィルターを表示
  3. chip 選択時に `GET /api/jobs/{id}/plots/learning-curve?metrics={metric}` を呼び出し
  4. ResultsPanel と同じフィルター UI コンポーネントを共用
- **Impact:** frontend/src/components/jobs/CompletedContent.tsx（state + UI 追加）、PlotSection.tsx（共通化確認）
- **Compatibility:** 非破壊的（UI 追加のみ）
- **Alternatives:**
  - Plotly のレジェンドクリックで非表示にする案 → ユーザーが知らないと使えない、サーバー側でフィルターすべき
- **Acceptance Criteria:**
  1. Jobs 詳細画面の Learning Curve にメトリクスフィルターが表示される
  2. chip 選択でプロットが更新される
  3. Workspace ResultsPanel と同じ UI
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0052: Jobs 詳細画面の Importance Kind セレクター追加
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.3.2（Jobs 詳細画面 — Plots）、frontend/src/components/jobs/CompletedContent.tsx
- **Context:** Workspace の ResultsPanel には Feature Importance の Kind セレクター（Split / Gain / SHAP の切替）が Segment group で実装されている（PlotSection.tsx）が、Jobs 詳細画面の CompletedContent ではデフォルトの kind のみ表示され、Kind を切り替える UI がない。H-0033 で追加された Importance Kind 選択機能が Jobs 画面に反映されていない。
- **Proposal:**
  1. CompletedContent の PlotSection に `importanceKind` state を追加
  2. Importance プロット選択時に Kind セレクター（Segment group: Split / Gain / SHAP）を表示
  3. Kind 切替時に `GET /api/jobs/{id}/plots/importance?kind={kind}` を呼び出し
  4. ResultsPanel と同じセレクター UI を共用
- **Impact:** frontend/src/components/jobs/CompletedContent.tsx（state + UI 追加）
- **Compatibility:** 非破壊的（UI 追加のみ）
- **Alternatives:** なし（Workspace との一貫性維持のため）
- **Acceptance Criteria:**
  1. Jobs 詳細画面の Importance プロットに Kind セレクターが表示される
  2. Kind 切替でプロットが更新される
  3. Workspace ResultsPanel と同じ UI
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0053: Tune Tab — Search Space デフォルト Range 自動ポピュレートの Widget 側への逆輸入提案
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.2（Tune タブ — Search Space）
- **Context:** LizyStudio の SearchSpaceTable は初回表示時に主要パラメータ（`learning_rate`, `num_leaves`, `n_estimators`, `max_depth`）を Range モードで自動ポピュレートする（`RANGE_DEFAULTS` + `KNOWN_PARAMS` 定数）。これにより、初心者が Tune を始める際の「全パラメータが Fixed で何も探索されない」問題を回避している。LizyML-Widget ではこの機能がなく、ユーザーが手動で Range に切り替える必要がある。
  本 Proposal は Studio 側の対応ではなく、Widget（`search_space_catalog`）のデフォルトモードを拡張し、Adapter が `default_mode: "range"` を指定可能にすることで、Studio と Widget の両方でデフォルト Range パラメータを Adapter 契約で統一的に制御する提案。
- **Proposal:**
  1. `search_space_catalog` の各エントリに `default_mode: "fixed" | "range" | "choice"` フィールドを追加（デフォルト: `"fixed"`、後方互換）
  2. `default_mode: "range"` の場合、`default_range: { low, high, log }` フィールドも追加可能
  3. Studio の `RANGE_DEFAULTS` / `KNOWN_PARAMS` ハードコードを廃止し、Adapter 契約から取得
  4. Widget の SearchSpace も `default_mode` を参照して初期モードを設定
  5. LizyML Adapter に以下のデフォルト Range を設定:
     - `learning_rate`: { low: 0.01, high: 0.3, log: true }
     - `num_leaves`: { low: 15, high: 127, log: false }
     - `n_estimators`: { low: 50, high: 500, log: false }
     - `max_depth`: { low: 3, high: 12, log: false }
- **Impact:** backends/types.py（CatalogEntry 型拡張）、backends/lizyml.py（デフォルト Range 設定）、Studio: SearchSpaceTable.tsx（RANGE_DEFAULTS 廃止）、Widget: SearchSpace.tsx（default_mode 参照）
- **Compatibility:** 非破壊的（`default_mode` はオプショナル、デフォルト `"fixed"` で後方互換）
- **Alternatives:**
  - Studio のハードコードを維持する案 → Adapter 追加時に Studio 側のコード変更が必要になり拡張性が低い
  - Widget のみに対応する案 → Studio と Widget で異なるデフォルトになり一貫性がない
- **Acceptance Criteria:**
  1. `search_space_catalog` のエントリに `default_mode` が含まれる
  2. Studio の SearchSpaceTable が Adapter 契約から Range デフォルトを取得する
  3. Widget の SearchSpace が `default_mode: "range"` のパラメータを Range モードで初期表示する
  4. Studio の `RANGE_DEFAULTS` ハードコードが削除されている
  5. 既存テストが全パス
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0054: PyPI 配布準備 — LICENSE / README / メタデータ整備
- **Status:** accepted
- **Scope:** Build
- **Related:** BLUEPRINT.md §9.3
- **Context:** `pyproject.toml` で `license = "MIT"` と宣言しているが、リポジトリルートに LICENSE ファイルが存在しない。README.md も空でありPyPI プロジェクトページが空になる。classifiers / keywords が不十分で検索性が低い。py.typed マーカーもなく型情報の配布ができない。PyPI 初回登録に向けてこれらを整備する必要がある。
- **Proposal:**
  1. リポジトリルートに `LICENSE` ファイル（MIT）を作成
  2. `README.md` にプロジェクト概要・インストール方法・使い方を記載（英語）
  3. `pyproject.toml` に classifiers（Development Status, Python versions, Topic 等）、keywords、追加 URLs（Documentation, Issues）を追加
  4. `src/lizystudio/py.typed` マーカーファイルを作成
- **Impact:** LICENSE（新規）、README.md（既存・空→内容追加）、pyproject.toml（メタデータ追加）、src/lizystudio/py.typed（新規）
- **Compatibility:** 非破壊的（メタデータ追加のみ、コード変更なし）
- **Alternatives:**
  - LICENSE をプロジェクトルートでなく pyproject.toml 内に inline 記載する案 → PyPI/GitHub ともにファイルとして存在するのが標準
  - README を日本語で書く案 → PyPI は国際ユーザー向けなので英語が適切
- **Acceptance Criteria:**
  1. `LICENSE` ファイルが存在し MIT 全文を含む
  2. `README.md` にインストール・使い方が記載されている
  3. `uv build` で生成される wheel に LICENSE が含まれる
  4. PyPI メタデータに classifiers / keywords が反映される
  5. `py.typed` が wheel に含まれる
- **Decision:** 2026-04-04 accepted — 提案通り

---

### H-0055: BackendAdapter Protocol への get_ui_schema / importance_kinds 追記
- **Status:** accepted
- **Scope:** Adapter
- **Related:** BLUEPRINT.md §3.3.2
- **Context:** H-0026 で `GET /api/backends/ui-schema` を追加した際に `BackendAdapter` Protocol に `get_ui_schema()` メソッドを実装したが、BLUEPRINT §3.3.2 の Protocol 定義に追記されていない。同様に `importance_kinds()` も実装済みだが未記載。requirements-audit（2026-04-06）で検出。
- **Proposal:** §3.3.2 の Protocol 定義に以下を追記:
  - `get_ui_schema(self) -> dict[str, Any]` — UI メタデータ（H-0026）
  - `importance_kinds(self, model: Any) -> list[str]` — 利用可能な重要度の種類
- **Impact:** BLUEPRINT.md §3.3.2
- **Compatibility:** 非破壊的（実装は既に完了。ドキュメント追記のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** §3.3.2 に両メソッドが記載されている
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0056: 共通型に ColumnInfo / ColumnsResponse を追記
- **Status:** accepted
- **Scope:** Adapter
- **Related:** BLUEPRINT.md §3.3.1
- **Context:** `GET /api/workspace/data/columns` のレスポンス型として `ColumnInfo` と `ColumnsResponse` が `backends/types.py` に実装済みだが、§3.3.1 の共通型一覧に記載されていない。`DataRef` は §3.4.3 に記載があるが §3.3.1 には未記載。requirements-audit（2026-04-06）で検出。
- **Proposal:** §3.3.1 に以下を追記:
  - `ColumnInfo` — カラム分析情報（name, dtype, unique_count, suggested_type, suggested_excluded, exclude_reason）
  - `ColumnsResponse` — カラム一覧レスポンス（target, columns）
- **Impact:** BLUEPRINT.md §3.3.1
- **Compatibility:** 非破壊的（実装は既に完了。ドキュメント追記のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** §3.3.1 に両型が記載されている
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0057: Job.status に cancelled を追記 + Results Panel 状態を 6 モードに更新
- **Status:** accepted
- **Scope:** Frontend, Backend
- **Related:** BLUEPRINT.md §3.4.2, §4.2.3
- **Context:** H-0011 で Cancel 機能を実装した際、`Job.status` に `"cancelled"` リテラルを追加し、Results Panel にも `pending` / `cancelled` 状態の表示を追加した。しかし §3.4.2 の status 定義は `pending | running | completed | failed` のまま、§4.2.3 は「4つのモード」のままで未更新。requirements-audit（2026-04-06）で検出。
- **Proposal:**
  1. §3.4.2 の `status` 型を `pending | running | completed | failed | cancelled` に更新
  2. §4.2.3 の「4つのモード」を「6つのモード」に更新し、`pending`（キュー待ち）と `cancelled`（キャンセル済み）の表示仕様を追記
- **Impact:** BLUEPRINT.md §3.4.2, §4.2.3
- **Compatibility:** 非破壊的（実装は既に完了。ドキュメント追記のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** §3.4.2 に cancelled が記載、§4.2.3 に 6 モードが記載されている
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0058: Jobs API に importance-kinds エンドポイント追記 + WebSocket に ping メッセージ追記
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.3, §5.5
- **Context:** `GET /api/jobs/{job_id}/importance-kinds` が実装済みだが §5.3 に未記載。また WebSocket の keepalive `ping` メッセージが 30 秒間隔で送信されているが §5.5 に未記載。requirements-audit（2026-04-06）で検出。
- **Proposal:**
  1. §5.3 に `GET /api/jobs/{job_id}/importance-kinds` を追記（利用可能な重要度の種類一覧）
  2. §5.5 に `ping` メッセージ型を追記（30 秒間隔の keepalive。クライアントは無視してよい）
- **Impact:** BLUEPRINT.md §5.3, §5.5
- **Compatibility:** 非破壊的（実装は既に完了。ドキュメント追記のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** §5.3 に importance-kinds、§5.5 に ping が記載されている
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0059: UI コンポーネント差異の追認（Task / Column Type / Backend 表示 / FI 表示 / Import-Export 配置）
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.1, §4.2.2, §4.2.3
- **Context:** v2 再実装で以下の UI 仕様が BLUEPRINT と異なる形で実装されたが、実用上は同等以上の UX を提供している。requirements-audit（2026-04-06）で検出。
  - §4.2.1 Task: Select → SegmentGroup（選択肢が少数のため視認性向上）
  - §4.2.1 Column Type: Dropdown → Num/Cat トグルボタン（2択のためボタンが適切）
  - §4.2.2 Backend 表示: Badge → plain text（情報量は同一）
  - §4.2.2 Config Import/Export: タブ内 → sticky footer（常時アクセス可能に改善）
  - §4.2.3 Feature Importance: 独立 Accordion → PlotSection 内選択肢（プロット操作の統一）
- **Proposal:** BLUEPRINT の該当箇所を実装に合わせて更新:
  1. §4.2.1 Task: 「ドロップダウンで変更可能」→「SegmentGroup で変更可能」
  2. §4.2.1 Column Type: 「Numeric / Categorical のドロップダウン」→「Num / Cat のトグルボタン」
  3. §4.2.2 Backend 表示: 「Badge (secondary)」→「テキスト表示（text-xs, muted）」
  4. §4.2.2 Config Import/Export: 「各タブ内の Action Button 上に配置」→「sticky footer に配置（タブ共通）」
  5. §4.2.3 Feature Importance: 独立 Accordion から PlotSection 内の選択肢に変更
- **Impact:** BLUEPRINT.md §4.2.1, §4.2.2, §4.2.3
- **Compatibility:** 非破壊的（UI 調整の追認）
- **Alternatives:** 実装を仕様に戻す案 → 現実装の方が UX が優れているため不採用
- **Acceptance Criteria:** BLUEPRINT の該当箇所が実装と一致する
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0060: Undo/Redo + Preset 機能の追認 + Execution Log 表示方式の追認
- **Status:** accepted
- **Scope:** Frontend
- **Related:** BLUEPRINT.md §4.2.2, §4.3.2
- **Context:** v2 再実装で以下の機能が BLUEPRINT 未記載のまま追加された。requirements-audit（2026-04-06）で検出。
  - §4.2.2 Model Panel footer: Undo/Redo ボタン + Save/Load Preset ボタン
  - §4.3.2 Execution Log: BLUEPRINT は全状態で Accordion だが、実装は completed のみ Accordion、failed/cancelled は View Full Log ダイアログ
- **Proposal:** BLUEPRINT に以下を追記:
  1. §4.2.2 に Undo/Redo + Preset 機能の仕様を追記
  2. §4.3.2 Execution Log の表示方式を実装に合わせて更新（completed: Accordion、failed/cancelled: View Full Log ダイアログ）
- **Impact:** BLUEPRINT.md §4.2.2, §4.3.2
- **Compatibility:** 非破壊的（追認のみ）
- **Alternatives:** なし
- **Acceptance Criteria:** BLUEPRINT に Undo/Redo/Preset 仕様と Execution Log 表示方式が記載されている
- **Decision:** 2026-04-07 accepted — 実装追認

---

### H-0061: Re-tune Dashboard — Round History / Boundary Expansion / Convergence Signal の可視化（Phase A）
- **Status:** implemented
- **Scope:** API | Frontend | Backend | Adapter
- **Related:** BLUEPRINT.md §3.3.1 (TuningSummary), §4.2.2 (Tune Tab), §5.2 (Workspace API), Issue #59, LizyML H-0068 (re-tune + boundary expansion), LizyML-Widget P-027/P-028
- **Context:** LizyML 0.9.0 で H-0068 が `Model.tune(resume, n_trials, expand_boundary, boundary_threshold)` を追加し、追加ラウンド実行時に Optuna study を継続し搜索空間を動的に拡張する機能をリリースした。LizyStudio 側ではこの機能がまだ GUI から利用できない。Issue #59 は Round History / Search Space Evolution / Convergence Signal / Boundary Detail の4ビューを要求している。

  Studio の既存ジョブ実行モデルは「1 Tune Job = 1 Model インスタンス → 完了時に Model 破棄・TuningSummary のみ永続化」で、別ジョブから Optuna study を引き継ぐ真の "resume from previous job" は Model pickle 化 + Job lineage という大きな変更を要する。段階的アプローチとして、Phase A（本提案）では **単一ジョブ内の multi-round 実行** を導入し、Phase B（将来別 Proposal）で真の Job 間 resume を追加する。
- **Proposal:**
  1. **共通型拡張** ([backends/types.py](src/lizystudio/backends/types.py)): `TuningSummary` に以下を追記（いずれも optional, None デフォルトで後方互換）:
     - `rounds: list[dict] | None` — 各ラウンドの n_trials / best_score_before / best_score_after / expanded_dims / space_snapshot
     - `boundary_report: dict | None` — 最終ラウンド後の BoundaryReport（per-dim: best_value / position_pct / edge / expanded / new_low / new_high）
  2. **Adapter 拡張** ([backends/lizyml.py](src/lizystudio/backends/lizyml.py)): `LizyMLAdapter.tune()` に `re_tune` パラメータを受け取るオプションを追加。`re_tune={"n_rounds": int, "expand_boundary": bool, "boundary_threshold": float}` が与えられた場合、`model.tune(n_trials=...)` → `model.tune(resume=True, n_trials=..., expand_boundary=..., boundary_threshold=...)` を n_rounds 回ループ実行し、lizyml の `TuningResult.rounds` / `boundary_report` を Studio `TuningSummary` にシリアライズする。
  3. **API 拡張** ([api/workspace.py](src/lizystudio/api/workspace.py), [api/models.py](src/lizystudio/api/models.py)): `POST /api/workspace/tune` のリクエストボディ（Config JSON 経由）に `tuning.re_tune: {n_rounds, expand_boundary, boundary_threshold} | None` を許容する。既存呼び出しは影響を受けない。
  4. **UI 新設** ([frontend/src/components/workspace/](frontend/src/components/workspace/)): 以下の新規コンポーネントを追加し、既存 Tune 結果画面 ([TuneTrialsSection.tsx](frontend/src/components/workspace/TuneTrialsSection.tsx)) に統合する:
     - `RoundHistoryTable.tsx` — rounds 配列を表示する shadcn/ui Table
     - `BoundaryExpansionPanel.tsx` — boundary_report を per-dim 表示（LizyML-Widget 実装を参考に shadcn/ui で再実装）
     - `ConvergenceSignalPanel.tsx` — 最終ラウンドの expanded_dims が空かつ improvement < 閾値 のとき「Fit に進む」を推奨するバナー
     - `TuneTab.tsx` の Accordion に Re-tune 設定セクション（n_rounds / expand_boundary / boundary_threshold 入力）
  5. **依存バージョン**: `pyproject.toml` の lizyml pin を `>=0.7.0,<0.10.0` → `>=0.9.0,<0.10.0` に引き上げる。
- **Impact:**
  - Backend: [backends/types.py](src/lizystudio/backends/types.py), [backends/lizyml.py](src/lizystudio/backends/lizyml.py), [backends/base.py](src/lizystudio/backends/base.py) (Protocol doc 更新), [api/models.py](src/lizystudio/api/models.py), [api/workspace.py](src/lizystudio/api/workspace.py), [services/training.py](src/lizystudio/services/training.py) (re_tune 引数パススルー)
  - Frontend: [TuneTab.tsx](frontend/src/components/workspace/TuneTab.tsx), [TuneTrialsSection.tsx](frontend/src/components/workspace/TuneTrialsSection.tsx), [ResultsCompletedView.tsx](frontend/src/components/workspace/ResultsCompletedView.tsx), 新規 retune/ ディレクトリ 4 コンポーネント, `frontend/src/api/types.ts` (自動生成)
  - Docs: BLUEPRINT.md §3.3.1 TuningSummary フィールド追記, §4.2.2 Tune Tab UI 追記
  - Version: pyproject.toml lizyml pin
- **Compatibility:** 非破壊的。追加フィールドは all optional（None デフォルト）。既存の Tune Job / 古い TuningSummary JSON は `rounds=None, boundary_report=None` として読み込まれる。`re_tune` 未指定時は従来の単一ラウンド tune として振る舞う。
- **Alternatives:**
  - **C1: Model pickle + Job lineage** — 別ジョブから前ジョブの Model を復元して `tune(resume=True)` 実行。Issue #59 の "[Re-tune (+N trials)]" ボタンを事後操作として実現できる。ただし pickle バージョン整合性・subprocess 実行モード・Job 親子関係の lifecycle・並行制御など実装コストが大きく、MVP として重すぎる。Phase B で別 Proposal として提案予定。
  - **C2: In-memory model registry** — Studio プロセス内に `dict[job_id, Model]` を保持。プロセス再起動で消失・subprocess 非互換。除外。
  - **弱い resume (best_params を initial_params として引き継ぐ)** — Optuna study は継続しないので H-0068 の核心（boundary expansion）を活かせない。採用せず。
- **Acceptance Criteria:**
  1. `POST /api/workspace/tune` に `tuning.re_tune={n_rounds: 3, expand_boundary: true, boundary_threshold: 0.05}` を含む Config を送信すると、lizyml の multi-round 実行が走り、`TuningSummary.rounds` が長さ 3 のリストで返る
  2. `TuningSummary.boundary_report` が最終ラウンドの BoundaryReport を含む
  3. Tune 結果画面に Round History Table / Boundary Expansion Panel / Convergence Signal Panel が表示される
  4. 最終ラウンドの `expanded_dims` が空 かつ rounds.length >= 2 のとき Convergence Signal に「Converged — proceed to Fit」が表示される
  5. `re_tune` 未指定の従来 Tune は影響を受けず動作する（既存テスト緑）
  6. pytest / mypy / ruff / vitest / Biome / pnpm build がすべて緑
  7. Backend カバレッジ 80%+ を維持
- **Decision:** 2026-04-13 accepted — ユーザ承認済、Phase A 実装開始
- **Implemented:** 2026-04-13 in PR #72 (develop commits 5b14d6a..eac1936). BLUEPRINT §3.3.1 / §4.2.2 への仕様反映と Search Space Evolution パネル追加は後続 PR で対応。Phase B（Job lineage + Re-tune (+N trials) ボタン）は H-0062 として別 Proposal で起案する。

---

### H-0062: Re-tune Dashboard Phase B — Job lineage + Incremental checkpoint + [Re-tune (+N trials)] / [Resume] actions
- **Status:** implemented
- **Scope:** API | Frontend | Backend | Persistence
- **Related:** H-0061 (Phase A, implemented), Issue #59 要求 4a ([Re-tune (+N trials)] ボタン), LizyML H-0068 (Study Resume), BLUEPRINT §3.4.4 (Job 永続化), H-0036 (subprocess tune 実行)
- **Context:** H-0061 Phase A は **単一ジョブ内の multi-round 実行** を導入したが、Issue #59 の残る要求 4a「完了済みの Tune ジョブから追加 N trials を走らせる [Re-tune (+N trials)] ボタン」と、Tune 実行中のクラッシュ耐性は未対応のままだった。Studio の既存永続化モデルは「1 Tune Job = 1 Model インスタンス → 完了時に Model 破棄」だったため、別ジョブ間での Study Resume が不可能で、途中クラッシュ時はすべての trial が失われていた。

  Phase B では以下 2 つの機能を同時に導入する:
  1. **Incremental checkpoint**: Tune 実行中、各 trial 完了時に `model.pkl` を atomic rename で上書き保存する。これにより Tune の途中クラッシュ/ディスク障害からの復旧が可能になる。
  2. **Job lineage + Re-tune / Resume UI**: Completed Tune Job から `[Re-tune (+N trials)]` を、Failed Tune Job から `[Resume (X trials remaining)]` を起動できる。両者は内部的に「既存 model.pkl を load して `tune(resume=True)`」の同じコードパスを共有し、child job として lineage に記録される。

  なお Issue #59 要求 4b「[Fit with best params] ボタン」は Phase A の `ConvergenceSignalPanel.onApplyToFit` と `TuneTrialsSection` の Apply to Fit 動線で既にカバーされているため、Phase B のスコープからは除外する。
- **Proposal:**
  1. **Incremental checkpoint save:** LizyML Adapter の tune ループ内、各 trial 完了時に `_save_checkpoint(model, job_dir)` を呼び、`{job_dir}/model.pkl.tmp` に cloudpickle で書き出した後 POSIX の `rename()` で `model.pkl` にアトミックに置換する。書き出し失敗 (`OSError` / `PicklingError`) は warning log を出すのみで tune は継続する（次の trial で再試行される）。
  2. **Pre-flight check (tune 開始前の最小限チェック):** `POST /api/workspace/tune` 受付直後、tune subprocess 起動前に以下を実行:
     - `{job_dir}/.write_test` 作成 → 即削除（書き込み権限 / SELinux 検証）
     - Minimal skeleton Model を cloudpickle dump/load の round-trip テスト（unpicklable object の早期検出）
     - 失敗時は `PICKLE_PREFLIGHT_FAILED` エラーコードで 400 を返し tune を開始しない
     - **Disk space check は実施しない** — incremental checkpoint の仕組みが tune 中のディスク枯渇を吸収できるため
  3. **Model pickle メタデータ:** `{jobs_dir}/{job_id}/model_meta.json` に `{pickle_schema: 1, lizyml_version: X, lightgbm_version: Y, optuna_version: Z, saved_at: ISO}` を記録。Resume / Re-tune 時にメジャーバージョン不一致を検出したら `PICKLE_INCOMPATIBLE` エラーで明示的に拒否する（自動マイグレーションは行わない）。
  4. **Job lineage:** `Job` dataclass に `parent_job_id: str | None` を追加。Re-tune / Resume で生成される child job が parent を参照する。child の `config` は parent を copy + `tuning.re_tune` をオーバーライド。API レスポンス (`JobDetail`) には `parent_job_id` と `child_job_ids: list[str]` を含める。
  5. **排他ロック (Q6):** 同一 parent から同時に複数 Re-tune / Resume を起動できないようにする。`JobStore` に `{parent_job_id → child_job_id}` の in-memory lock を持ち、child job 完了/失敗/キャンセル時に解放する。ロック取得失敗時は `PARENT_LOCKED` (409) を返す。プロセス再起動時は全ロックが解放される（running 中の child は Studio 再起動で `failed` 扱いになるため整合性は維持）。
  6. **新 API:**
     - `POST /api/jobs/{job_id}/retune` — body `{n_trials: int, expand_boundary?: bool, boundary_threshold?: float}`。parent の model.pkl を child job ディレクトリにコピー → `adapter.tune(resume=True, re_tune=...)` を実行 → 完了後に best_params で auto-fit を実行（Phase A `run_tune` と同じパイプラインで `FitSummary` も生成） → 新 Job を作成して `TuningSummary` と `FitSummary` の両方を永続化。Completed Tune Job のみが対象。
     - `POST /api/jobs/{job_id}/resume` — body `{n_trials?: int}` (省略時は残り trials を自動計算)。Failed Tune Job で model.pkl が残っているもののみが対象。child job として実行される。完了後の auto-fit は Re-tune と同じ。
  7. **Cancellation semantics (Q3-detail (a)):** Parent Job の DELETE API は active な child が存在する場合、child を先にキャンセルしてから parent を削除する。DELETE リクエストに `?cascade=true` を必須とし、明示的でない場合は `PARENT_HAS_ACTIVE_CHILDREN` (409) を返す。UI 側は delete 確認ダイアログに "This will also cancel N active Re-tune/Resume jobs" を表示する。
  8. **Cascade 削除 (Q4):** Parent Job の完全削除時は children も再帰的に cascade 削除する。API レスポンスには削除された job_id のリストを含める。
  9. **Tree lineage UI (Q5):** Jobs 画面に lineage ツリー表示を追加する。shadcn/ui の Collapsible を入れ子にして親から子へ展開する簡易ビューを実装。大規模（深さ 5 以上 / 幅 10 以上）な場合のスクロール/折りたたみは含めない。
  10. **UI アクションボタン:**
      - `ResultsCompletedView` の Completed Tune 表示に `[Re-tune (+N trials)]` ボタン (n_trials は直前ラウンドと同じがデフォルト、上限 10,000)
      - `ResultsPanel` の Failed Tune 表示に `[Resume (X trials remaining)]` ボタン (n_trials は残数自動計算)
      - 両ボタンとも model.pkl が存在しない job では無効化
      - parent_job_id が **既にある** child job では両ボタンとも **disabled + tooltip** で理由を表示する（孫世代を防ぐため MVP では禁止。ユーザ Q5 回答により tooltip 方式を採用、孫世代 Re-tune の必要性は将来別 Proposal で再評価）
  11. **Restart 時の自動 resume は行わない (Q-new-1 (a)):** Studio 起動時に failed tune job を検出して自動的にキューに入れることはしない。ユーザーが明示的に Resume ボタンをクリックする必要がある。
  12. **Resume と Re-tune は UI 上区別する (Q-new-2 (b)):** 内部コードパスは共有するが、ラベル・文脈・デフォルト値が異なるため UI ボタンは分離する。
- **Impact:**
  - Backend:
    - `src/lizystudio/backends/base.py` — Protocol に `save_checkpoint(model, path)` / `load_checkpoint(path) -> Model` を追加
    - `src/lizystudio/backends/lizyml.py` — checkpoint save/load 実装, tune loop に trial 完了 hook を追加
    - `src/lizystudio/services/jobs.py` — `Job.parent_job_id` / `child_job_ids`, `create_child_job()`, `get_lineage_tree()`, retune lock management, cascade delete
    - `src/lizystudio/services/training.py` — pre-flight check, tune subprocess への checkpoint callback 注入
    - `src/lizystudio/api/jobs.py` — `POST /jobs/{id}/retune`, `POST /jobs/{id}/resume`, DELETE に cascade / active-children チェック
    - `src/lizystudio/api/errors.py` — `PICKLE_PREFLIGHT_FAILED` / `PICKLE_INCOMPATIBLE` / `PARENT_LOCKED` / `PARENT_HAS_ACTIVE_CHILDREN` エラーコード追加
  - Frontend:
    - `frontend/src/components/workspace/ResultsCompletedView.tsx` — Re-tune ボタン
    - `frontend/src/components/workspace/ResultsPanel.tsx` — Failed 状態に Resume ボタン
    - `frontend/src/components/jobs/JobLineageTree.tsx` — 新規コンポーネント
    - `frontend/src/api/jobs.ts` — `retuneJob()`, `resumeJob()` API client
    - `frontend/src/api/types.ts` — OpenAPI 自動生成型に `parent_job_id` / `child_job_ids` 追加
  - Docs:
    - `BLUEPRINT.md` §3.4.4 に `model.pkl` / `model_meta.json` / lineage ファイル構造を追記
    - `BLUEPRINT.md` §4.3 に lineage tree と Re-tune / Resume ボタンの仕様を追記
    - `PLAN.md` に `v3-12` phase を追加
- **Compatibility:** 非破壊的。既存の Tune Job (model.pkl を持たない) は Re-tune / Resume ボタンが自動的に無効化される。`parent_job_id` は optional（既存 job では `None`）。Pre-flight check / checkpoint save は Phase A の re_tune 実行時にも動作するため、Phase A 実装に影響はない。
- **Alternatives considered:**
  - **Snapshot copy モデル (Q3 rejected):** Re-tune 開始時に parent の pickle を child にコピーして以降 parent 非依存にする案。ユーザー判断により **却下**: lineage の意味が曖昧になり、ディスク使用量が倍加する。代わりに cascade delete + active children 検知で整合性を担保する。
  - **In-memory model registry:** プロセス再起動で消失するため実用性なし。
  - **Weak resume (best_params を initial_params として新 Tune):** Optuna study を継続しないので `expand_boundary` が機能しない。Phase A で既に却下済み。
  - **Periodic checkpoint (N trials ごと):** incremental save のオーバーヘッドを減らす案。pickle サイズが数 MB-数十 MB で SSD 書き込み速度を考えると trial あたり数百 ms 未満のコストで済むため、毎 trial 保存でも実質問題にならない。シンプルさを優先して毎 trial を採用。
  - **並行実行 (n_active_retune 制限) (Q6):** 同一 parent から複数 Re-tune を並行実行する案。lizyml の study resume が in-place 更新であることを前提にすると race condition のリスクがあり、MVP としては排他ロックが最もシンプルかつ堅牢。将来 B に進化させる場合はロック実装を差し替えるだけでよい。
- **Acceptance Criteria:**
  1. **Checkpoint:** Tune 実行中、各 trial 完了時に `{job_dir}/model.pkl` が atomic rename で更新される。途中で SIGKILL されても直前までの trial は無傷で残る
  2. **Pre-flight:** 書き込み権限なし / unpicklable オブジェクトが検出されたら tune は開始されず、明確なエラーコードが返る
  3. **Pickle metadata:** `model_meta.json` に lizyml / lightgbm / optuna のバージョンと pickle schema version が記録される
  4. **Version mismatch:** Re-tune / Resume 時にメジャーバージョン不一致があれば `PICKLE_INCOMPATIBLE` で拒否され、具体的なバージョン情報がエラーメッセージに含まれる
  5. **Re-tune API:** `POST /api/jobs/{id}/retune` が completed tune job から child job を作成し、`parent_job_id` が設定される
  6. **Resume API:** `POST /api/jobs/{id}/resume` が failed tune job（model.pkl 保持）から child job を作成し、残り trials を実行する
  7. **排他ロック:** 同一 parent から 2 つ目の Re-tune / Resume を起動すると `PARENT_LOCKED` (409) が返る
  8. **Cascade delete:** Parent Job の削除時、children が再帰的に削除される
  9. **Active children 保護:** Active children がある parent の DELETE は `?cascade=true` 無しで 409 を返す
  10. **UI Re-tune ボタン:** Completed Tune Job に `[Re-tune (+N trials)]` が表示され、クリックで child job が起動する
  11. **UI Resume ボタン:** Failed Tune Job (model.pkl あり) に `[Resume (X trials remaining)]` が表示され、クリックで残り trials が実行される
  12. **UI 無効化:** model.pkl が存在しない job / 既に parent_job_id を持つ child job では両ボタンが disabled + tooltip で表示される
  13. **Lineage tree:** Jobs 画面から parent ↔ children の関係がツリー表示でたどれる
  14. **後方互換:** Phase A の `re_tune` 同一ジョブ multi-round 実行が影響を受けない
  15. **品質ゲート:** pytest / mypy / ruff / vitest / biome / pnpm build がすべて緑
  16. **Coverage:** Backend 80%+ / Frontend 80%+
- **Decision:** 2026-04-13 accepted — ユーザレビュー済、ユーザ回答により Q1〜Q7 および追加質問 (Pre-flight minimization / Incremental checkpoint / Resume UI) を確定。本 Proposal accepted 後、PLAN.md に `v3-12` として実装フェーズを追加する。
- **Implemented:** 2026-04-13 in branch `feat/h0062-phase-b-job-lineage-resume` (8 commits). 全 16 受入条件達成、869 backend tests + 1239 frontend tests 緑、mypy / ruff / biome clean。BLUEPRINT §3.4.4 / §4.3 / §6.1 と PLAN v3-12 に仕様反映済。
- **Bugfix 2026-04-14 — Resume from checkpoint threw "no previous tune() call":** 初期実装ではチェックポイント保存は毎 trial の bridge コールバック内でのみ実行していたが、lizyml の `Model.tune()` は `self._study = study` を関数末尾でのみ代入する契約のため、毎 trial save でディスクに書かれる `model._study` は常に古い値（新規 Tune なら None）だった。結果として Re-tune / Resume で `load_checkpoint()` した Model は `_study is None` となり、lizyml の `resume=True` ガードで `TUNING_FAILED: Cannot resume tuning: no previous tune() call` が発生していた。修正として `LizyMLAdapter.tune` のループ完了後（`return` 前）に明示的な最終 `save_checkpoint` を追加し、`self._study` がセットされた後の Model をディスクに書き戻す。毎 trial の bridge save はクラッシュ耐性のため残す。併せて既存 mock ベーステストの盲点を埋める実 lizyml Model による回帰テストを `tests/test_lizyml_checkpoint_real_model.py` に追加し、API end-to-end 回帰テストを `tests/test_retune_api.py::test_retune_end_to_end_with_real_lizyml` に追加した。
- **Bugfix 2026-04-14 (2) — Re-tune performance 8× slowdown + parent trial history invisible:** Re-tune 実行時に CPU 使用率が低く 1 trial あたり約 40 秒（通常 tune の約 5 秒に対し ~8×遅い）という報告を受けて調査。2 つの独立バグが同時に発生していた: **(A) OpenMP subprocess 分岐漏れ**: `start_fit_async` / `start_tune_async` は `openmp_detect.should_use_subprocess()` が True のとき subprocess モードに切り替えて daemon-thread OpenMP の thread-pool bind 問題（~8-50× 遅延）を回避していたが、`start_retune_async` はこの分岐を実装していなかった。OpenMP 検出環境では Re-tune がスレッドモードで強制実行され、lizyml の LightGBM 学習が 1 コアしか使えていなかった。**(B) Bridge accumulated_trials リセット**: `LizyMLAdapter.tune` の bridge コールバックは毎回 `accumulated_trials = []` から始まるため、`resume=True` でも UI の Running Trials テーブル / LiveTrialChart は新規 trials しか表示せず、Best 列も最初の新 trial から再カウントされ、ユーザーから見ると「前の結果を引き継いでいない」ように見えた（実際には Optuna study は継続していた）。修正として: (A) `subprocess_runner.run_job_in_subprocess` に `mode="retune"` 分岐を追加し、`_child_main` で `run_retune(...)` を実行できるようにした。`training.py` に `_run_retune_subprocess` ヘルパーを追加し、`start_retune_async` で `should_use_subprocess()` True 時に subprocess パスへディスパッチ。in-memory upload（`data_ref.path` が空）で subprocess モードが要求された場合は明示的なエラーで早期失敗させる（スレッドパスへの静かなフォールバックは行わない）。(B) `LizyMLAdapter.tune` で `resume=True` かつ `model._tuning_result` が非 None のとき、bridge の `accumulated_trials` を親の trials で seed し、各行の `best_score` に親の `best_score` をコピー。これにより Running view 側で親の履歴が先頭から表示され、Best 列は親の best から始まり新 trial が改善したときだけ更新される。テストは `tests/test_training_coverage.py` に 3 本（subprocess 分岐、in-memory 拒否、ヘルパー assert）と `tests/test_lizyml_checkpoint_real_model.py` に `test_resume_seeds_progress_trials_from_parent_history` を追加。905 backend tests green, mypy / ruff / biome clean。
- **Hardening 2026-04-14 (deep-review follow-up) — concurrency + validation defensive fixes:** H-0062 Phase B 修正の深層レビューで 7 件の真正なバグを特定し、すべて対応。**(C1)** `api/jobs.py` の `release_parent_lock` → `acquire_parent_lock` 2 ステップが race window を作り、2 番目の `acquire` の bool 戻り値を無視して silent にロックを手放していた。`JobStore.rebind_parent_lock(parent, expected_holder, new_holder)` を追加して single mutex 下の atomic swap に置き換え、失敗時は新規 child を削除して 409 を返す。**(H1)** `subprocess_runner._poll_progress` に cancel 監視ループを追加し、`job_store.is_cancel_requested(job_id)` True で `proc.terminate()` を呼ぶ escape hatch を実装。`run_job_in_subprocess` 側で `proc.wait(timeout=_WAIT_TIMEOUT)` + `proc.kill()` フォールバックも追加。これまで子プロセスのハングが daemon worker thread を永久に生かし、次の retune が `PreviousJobStillRunningError` で永続的にロックアウトされていた。**(H2)** `_run_retune_subprocess` の `assert` を `_mark_retune_child_failed` 共有 helper 経由の runtime check に差し替え。`assert` 失敗時に child job が `pending` のまま orphan 化していた。併せて `start_retune_async._run` に blanket `except` を追加し、worker thread 内の予期せぬ例外でも child を `failed` に遷移させる。**(H1-data)** `_task_params_compat_errors` と `_strip_internal_keys` に `isinstance(model, dict)` / `isinstance(params, dict)` ガードを追加。pydantic が既に non-dict `model` を拒否している config に対して helper が `AttributeError` で 500 を返していた。**(H2-data)** metric 互換性チェックのポリシーを「全て不正で初めてフラグ」から「いずれか不正でフラグ」に変更。LightGBM は `task=binary` + `metric=["auc","multi_logloss"]` のような部分不整合でも全 trial を失敗させるため、旧ポリシーでは run-time まで検出できなかった。`test_adapter_validate_config_rejects_partial_metric_mismatch` + 空リスト許容 + 非 dict 2 ケース追加。**(M1-quality)** `LizyMLAdapter.tune` の final save 付近の `except Exception` を `(OSError, PicklingError, RecursionError)` に narrow 化し、programming bug が silent に swallowed されないように。**(M2-quality)** `assert` を runtime check に昇格 (Python -O で消えない)。テスト追加: `test_parent_lock.py` 3 本 (rebind succeeds / fails when stolen / fails when empty), `test_subprocess_runner.py::TestPollProgressCancelEscape` 2 本 (cancel terminate / no cancel no terminate), `test_training_coverage.py` 2 本 (helper fails child / worker crash transitions to failed), `test_backends_lizyml.py` 4 本 (partial metric mismatch / empty list accept / non-dict model / non-dict params)。920 backend tests green, 1250 frontend tests green, mypy / ruff / biome clean。
- **Bugfix 2026-04-14 (3) — "All tuning trials failed" with stale task-specific params:** 通常 Tune 実行時に `LizyMLError: [TUNING_FAILED] All tuning trials failed. Check parameter ranges.` が発生。調査したところ job config は `task=binary` だが `model.params = {"objective": "multiclass", "metric": ["auc_mu", "multi_logloss"]}` という不整合状態。LGBM は binary target に multiclass objective を拒否するため全 trial が FAIL し、lizyml の tuner が「全 trial 失敗」として再送出していた。原因: ユーザーが一時的に `task=multiclass` を選択 → auto-default useEffect で `model.params.objective=multiclass` / `metric=[auc_mu, multi_logloss]` がセットされ、その後 `task=binary` に戻しても既存値が残ったまま使われた。旧 guard は `!modelParams.objective` で空のときしか発火せず、**task 変更に伴う不整合チェックが無かった**のが真因。修正 (二重ガード): **(Frontend)** `ConfigForm.tsx` の auto-default useEffect を「空 OR 現在値が新 task の option_sets に含まれない」で発火するように変更。`objective` は新 task の最初の選択肢にリセット、`metric` は `parameter_hints.metric.default[task]` にリセット。現在値が task と互換なら上書きしない。**(Backend)** `LizyMLAdapter.validate_config` に task ↔ objective / metric 互換性チェックを追加 (`_task_params_compat_errors`)。option_sets との突き合わせで不整合を pydantic-style validation error として返す。single source of truth は lizyml_ui_schema の `option_sets`。API 直叩きや古い config ファイルからの不整合もバックエンドで弾けるようになった。テスト: `tests/test_backends_lizyml.py` に 4 本 (binary/regression 不整合 + binary 正常), `frontend/src/components/workspace/ConfigForm.test.tsx` に 3 本 (objective reset / metric reset / compatible は維持)。910 backend tests green, 1250 frontend tests green, mypy / ruff / biome clean。
- **Decision flip 2026-04-14 — Grandchild retune allowed:** 当初 H-0062 MVP スコープでは Q5 回答に基づき「`parent_job_id` を持つ child に対する Re-tune / Resume は disabled + tooltip」としていたが、UX 実地検証の結果ユーザーが「Re-tune の結果からさらに Re-tune を続けたい」という自然な期待を持つことが判明（2 回目 Re-tune で 400 Bad Request が発生）。技術的には各 child が自分の model.pkl を持ち Optuna study を継続できるため多世代チェーン（A → B → C → ...）に障害は無い。修正として `api/jobs.py::_require_tune_job_with_checkpoint` の `parent.parent_job_id is not None` ガードを削除、`frontend/src/components/workspace/ResultsCompletedView.tsx` で `RetuneActionButton` に渡していた `disabledReason` grandchild 分岐を削除。既存テスト `test_retune_rejects_grandchild` を `test_retune_accepts_grandchild` に差し替え、`tests/test_lizyml_checkpoint_real_model.py::test_grandchild_resume_chain_a_b_c` で A → B → C の実 lizyml チェーン検証を追加（各ステップで study trials 数が増えることを確認）。BLUEPRINT §11.6 の無効化ルール記述も削除し「多世代 resume を許可」に更新した。Lineage tree の最大深度 20 は cascade delete 再帰ガードのため維持。
- **Outstanding follow-ups (as of 2026-04-14):** H-0062 Phase B の主要修正・hardening は全て完了したが、以下の残課題を別 PR で順次対応する予定。
  - **HIGH:** _(2026-04-14 update: すべて対応完了)_
    1. ~~**Lineage Tree UI 配線**~~ — PR #74 内で `ResultsCompletedView` に wire-in 完了。受入条件 #13 達成。
  - **MEDIUM:**
    2. ~~**ファイル分割**~~ — `feat/h0062-cleanup-and-e2e` ブランチで完了。`backends/lizyml.py` は `backends/lizyml/` パッケージ (pickle_compat / serialization / config_compat / adapter) に分割。`services/training.py` は `training_retune.py` を切り出し。`api/jobs.py` は `api/retune.py` を切り出し。すべて re-export で後方互換維持、テスト 945 全 green。
    3. ~~**E2E シナリオ追加**~~ — `feat/h0062-cleanup-and-e2e` で B-1〜B-5 を `frontend/tests/e2e/retune-flow.spec.ts` に追加: Cancel during retune (API), PARENT_LOCKED 409 (API), 破損 model_meta.json で PICKLE_INCOMPATIBLE 400 (API), Lineage panel UI click-through (UI), Grandchild Re-tune button enabled (UI)。Resume end-to-end と In-memory upload rejection は scope-out（前者は意図的 failure 操作の flaky リスク、後者は既存 unit test でカバー済み）。
    4. **`plotly.js-dist-min` peer dependency 検証:** `LiveTrialChart` 経由で peer dependency 警告のリスクがあるため確認が必要。_(残)_
  - **LOW:**
    5. biome `noNonNullAssertion` 15 warnings (テストファイル内、すべて pre-existing) の解消。
    6. `_strip_internal_keys` の追加 defensive guard (tuning / result セクション)。
    7. `JobStore` レベルでの cross-parent retune races 用 `_spawn_lock` 追加検討。
    8. `LizyMLAdapter.tune` (~195 行) のリファクタ（ファイル分割完了後の追加リファクタ。`adapter.py` が 613 行と大きめなので分割の余地はある）。
    9. `_run_retune_subprocess` と `start_fit_async` / `start_tune_async` の重複統合。
    10. exact trial count 監視テストの brittleness（一部緩和済、残箇所は段階的に）。
- **Bugfix 2026-04-14 (4) — AUC が low-is-better で最適化される CRITICAL バグ:** ユーザ報告「Tuning 時に AUC スコアが低いほど良い指標になっている」を受けて調査。根本原因は `api/workspace.py::workspace_tune` のデフォルト tuning inject 経路で `direction` が `"minimize"` にハードコードされていたこと。具体的な再現フロー: (1) ユーザが Workspace で task=binary を選ぶ（評価メトリックは default の auc）→ (2) `tuning` セクション未設定のまま Tune ボタンを押す → (3) `POST /api/workspace/tune` でバックエンドが `tuning.optuna.params = {"n_trials": 50, "direction": "minimize", "timeout": None}` を inject → (4) `_prepare_tune_config` の auto-resolve は `"direction" not in params` を見ていたため発火せず → (5) lizyml の `Model.tune()` が Optuna study direction = `"minimize"` で起動 → (6) AUC を最小化（=低いほど良い指標として扱う） → (7) `best_params` が完全に意味不明な値になる。**影響範囲**: すべての fresh tune 実行で auc / auc_pr / r2 / accuracy / f1 / auc_mu が低いほど良いと最適化されていた。ユーザがメトリックを 1 度切り替えた場合のみ TuneEvaluationSection の `handleOptimizationMetricChange` が direction を上書きするため回避されていた。修正 (5 層): **(Fix 1)** `api/workspace.py:437` のハードコード `"direction": "minimize"` を削除し、`_prepare_tune_config` の auto-resolve に一任。**(Fix 2)** `services/training.py::_prepare_tune_config` の direction 補正条件を `"direction" not in params` から「常に metric と整合させる（不整合なら上書き）」に変更。これにより stale な direction や API 直叩きの誤った値も自動修正される。**(Fix 3)** `frontend/src/components/workspace/TuneEvaluationSection.tsx` に defensive useEffect を追加し、メトリック変化時にコンポーネント側でも `optuna.params.direction` を `metricDirection` と整合させる（ユーザがメトリックボタンを押さなくても同期）。**(Fix 4)** リグレッションテスト追加: `tests/test_workspace_coverage.py::test_tune_default_tuning_uses_auc_maximize_for_binary` (workspace_tune → _prepare_tune_config の統合テスト), `tests/test_training_service.py::test_overrides_stale_minimize_direction_for_auc` / `test_overrides_stale_maximize_direction_for_rmse` / `test_keeps_consistent_direction_unchanged`, 既存 `test_preserves_explicit_direction` を `test_overwrites_inconsistent_direction` に差し替え (新しい契約: 「metric が direction の単一の真実」)。E2E `frontend/tests/e2e/workspace-tune.spec.ts` の fixture から `direction: "minimize"` ハードコードを削除し、`tune_result.direction === "maximize"` の assertion を追加。**Fix 5** (このエントリー)。**壊れた job 履歴**: 既存の `direction: minimize` で完了済みの binary + auc tune jobs は best_params が論理的に逆なので破棄推奨。マイグレーション script は不要、ユーザが手動 delete でよい。949 backend tests green, mypy / ruff clean。

### H-0063: `POST /workspace/reset` がアクティブジョブを確実にキャンセルして slot を解放する
- **Status:** accepted
- **Scope:** API, Backend
- **Related:** BLUEPRINT §5 Workspace API / §8 Jobs ライフサイクル, Issue #99
- **Context:** 現状の `POST /workspace/reset` は `WorkspaceState` のみをクリアし、`JobStore._active_job_id` にはノータッチ。したがって前の fit / tune job がバックグラウンドで走っている状態で reset を押しても、次の fit / tune は `JOB_CONFLICT (409)` で弾かれる可能性がある。ユーザー期待値は「reset ボタンを押したら真っさらな状態から次の操作が始められる」であり、現在の挙動はそれを裏切っている。また E2E テスト側では PR #102 の `afterEach` baseline-diff ガードで workaround しており、そのガード自体が「reset は slot を touch しない」という暗黙の前提に依存している。
- **Proposal:** `workspace_reset` エンドポイントの挙動を次のように拡張する。
  1. `job_store.active_job_id` を取得し、非 None でかつ on-disk status が `running` / `pending` の場合に `job_store.request_cancel(active_id)` を呼ぶ。既存の cancel エンドポイント `POST /jobs/{id}/cancel` と同一経路なので、subprocess 経路は `subprocess_runner._poll_progress` が `is_cancel_requested` を検知して `proc.terminate()` → `run_job_in_subprocess.reconcile` で terminal 状態に遷移させる。in-process thread 経路は `_run_job_core` の cancel-aware callback が `CancelledError` を投げて finally で `release_active` を呼ぶ。
  2. 上記の完了を同期的に短時間待機する: `_RESET_WAIT_TIMEOUT = 12.0s`（subprocess runner の `_WAIT_TIMEOUT = 10s` + buffer 2s）で `has_active_job()` が False になるまで polling（`_RESET_WAIT_INTERVAL = 0.05s`）。待機中に on-disk status が terminal に遷移した場合は runner finally を待たず直接 `force_release_active_if` を呼ぶ（crashed runner 対応）。
  3. **Force-release on timeout:** タイムアウト内に解放されなかった場合、warn ログを残した上で `force_release_active_if(stuck_id)` で slot を強制解放する。Proposal 初稿では「warn だけ残して 409 は許容」としていたが、RED テストで runner が存在しない orphan slot ケースが露出したため、reset の約束（次の操作はクリーン状態から始められる）を守る方向に方針を強めた。`_RESET_WAIT_TIMEOUT` を subprocess の `_WAIT_TIMEOUT` より長く設定しているので、合法的な subprocess runner には `proc.terminate` + `proc.wait` + 自前の `release_active` まで完了する時間的余裕がある。それでもタイムアウトする場合は orphan slot と判断して差し支えない。
  4. **Atomic compare-and-release:** force-release の root cause review で TOCTOU ホール（`active_job_id` 読み取り → 別スレッドが新 claim → `release_active` で新 claim を誤削除）を指摘されたため、`JobStore.force_release_active_if(expected_job_id)` を追加。`_active_lock` を保持した単一 critical section 内で compare-and-release を行うので、観測した id と実際の slot holder が一致した場合のみ release する。一致しない場合は no-op。
  5. workspace state のクリアは 1. / 2. / 3. の **後**に実行する。データフレームやモデル参照が先にクリアされると、終了中の subprocess / thread が解放のタイミングで参照先を失ってクラッシュする余地がある。
- **Impact:**
  - `src/lizystudio/api/workspace.py::workspace_reset` — `job_store: JobStore = Depends(get_job_store)` を追加し、上記フローを実装。
  - `src/lizystudio/services/jobs.py` — 変更なし（既存の `request_cancel` / `has_active_job` / `active_job_id` で十分）。
  - `tests/regression/test_reg_NNNN_workspace_reset_releases_slot.py`（新規）— (a) active slot を持つ状態で reset を呼ぶと slot が解放される, (b) `request_cancel` が呼ばれる, (c) タイムアウト時も 200 を返して warn ログを残す, の 3 テストを追加。
  - `frontend/tests/e2e/retune-flow.spec.ts` の `afterEach` baseline-diff ガードは **このPRでは残す**。ガードの撤去は別 PR（動作確認後）にする。
- **Compatibility:** 非破壊的。既存クライアントから見ると「reset が少しだけ遅くなり、以前より多くの状態をクリアする」という拡張。reset のレスポンスボディは `{"status": "ok"}` で不変。
- **Alternatives:**
  1. **選択肢 A（却下）**: `workspace_reset` は現状維持で、新しい `POST /jobs/active/cancel` エンドポイントを追加する案。メリット: reset の影響範囲を変えず、セマンティクス分離が明確。デメリット: ユーザーが「reset」と「cancel active job」を区別して使いこなす必要があり、実際には「reset ボタンを押したのに次の Run が 409 になる」というユーザー期待値ギャップが残る。
  2. **選択肢 B（却下）**: `JobStore` に heartbeat-based stale detection を追加し、`running` のまま一定時間経過したジョブを stale 扱いして slot を自動再取得する案。メリット: reset 以外の経路でも効く。デメリット: 正当な長時間 tune を誤検知する誤陽性リスクがあり、timeout 値のチューニングが難しい。本質的には root cause（reset が slot を触らない）を修正しないで症状を緩和するだけ。
  3. **選択肢 C（採用、本提案）**: reset が active slot を同期的にキャンセルする。ユーザー期待値に最も近く、既存の cancel 経路を再利用するだけで実装リスクが低い。
- **Acceptance Criteria:**
  - (a) `POST /workspace/reset` 呼び出し前に active job が存在した場合、呼び出し後 `job_store.has_active_job()` は False を返す（タイムアウト内）。
  - (b) active job に対して `request_cancel` が呼ばれたことが確認できる。
  - (c) `_RESET_WAIT_TIMEOUT` 内に解放されなくても HTTP 200 を返し、サーバーログに warn を残す。
  - (d) active job が無い通常ケースでは既存の挙動が変わらない。
  - (e) 既存の `test_reg_0071` / `test_reg_0072` / retune-flow E2E が regression なく通る。
- **Decision:** 2026-04-15 採択 (Phase B3)。Option 1 変種 C を採用。E2E workaround 撤去は本 PR 範囲外。

---

### H-0064: Health / readiness エンドポイントの追加（Issue #30 Phase 1）
- **Status:** accepted
- **Scope:** API
- **Related:** BLUEPRINT.md §5.8（新設）
- **Context:** Issue #30 は Prometheus メトリクス + liveness / readiness probe の追加を要望している。現状、`/api/*` 配下には軽量な liveness エンドポイントが存在せず、k8s / 一般的なリバースプロキシ配下に LizyStudio をデプロイする際に probe を配線する手段がない。Prometheus 対応（Phase 2）は外部依存（`prometheus-client`）と middleware 追加が必要で規模が大きいため、まずは追加依存ゼロで実装できる health / ready 2 エンドポイントを切り出して先に着地させたい。
- **Proposal:** 以下 2 エンドポイントを `/api/health` 名前空間に追加する:
  - `GET /api/health` — liveness probe。プロセスが応答可能であれば常に 200 を返す。Body: `{"status": "ok", "version": "<pkg __version__>"}`。
  - `GET /api/health/ready` — readiness probe。Backend adapter と JobStore の初期化が完了しているか確認する。準備完了なら 200、未完了なら 503。Body: `{"status": "ready" | "not_ready", "backend": "<name>", "jobs_dir": true/false, "version": "..."}`。
- **Impact:**
  - 新規: `src/lizystudio/api/health.py`（エンドポイント実装）
  - 追加: `src/lizystudio/server.py` に `app.include_router(health.router, prefix="/api/health")` 1 行
  - 新規: `tests/test_health_api.py`
  - 追記: BLUEPRINT.md §5.8
- **Compatibility:** 非破壊的（新規エンドポイント追加のみ）。既存のフロントエンドは health を呼ばない。
- **Alternatives:**
  1. **選択肢 A（却下）**: `/api/workspace/status` を liveness として流用する案。デメリット: workspace state の依存があり、未初期化時に 500 を返す可能性がある。liveness として誤検知リスクが高い。
  2. **選択肢 B（却下）**: Issue #30 の 3 フェーズ（health + Prometheus + system metrics）を一括実装する案。デメリット: PR が肥大化し、`prometheus-client` の追加やメトリクス middleware の設計議論でブロックされる。Phase 1 だけでも独立した運用価値がある。
  3. **選択肢 C（採用、本提案）**: health / ready 2 本のみ、追加依存ゼロで着地。Prometheus は別 Issue / 別 PR で段階的に追加する。
- **Acceptance Criteria:**
  - (a) `GET /api/health` が 200 と `{"status": "ok", "version": ...}` を返す。
  - (b) `GET /api/health/ready` が完全初期化済みアプリに対して 200 と `{"status": "ready", ...}` を返す。
  - (c) backend adapter / jobs_dir の初期化失敗を ready=false として 503 で返す（未初期化シナリオ）。
  - (d) liveness エンドポイントが **workspace state に依存せず** 単独で応答する（未データロード状態でも 200）。
  - (e) SPA fallback ルートが `/api/health` を奪わない（`/api/` プレフィックスで既に除外されているが、テストで固定）。
- **Decision:** 2026-04-17 採択 (Issue #30 Phase 1)。Prometheus メトリクス + system metrics は別 Proposal で追加する。
