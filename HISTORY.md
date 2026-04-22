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

---

### H-0065: Prometheus メトリクスエンドポイントの追加（Issue #30 Phase 2）
- **Status:** accepted
- **Scope:** API / Config (runtime dep)
- **Related:** BLUEPRINT.md §5.9（新設）
- **Context:** H-0064 で health / readiness probe を追加したが、実運用では「このプロセスは生きているか」だけでなく「どのくらいトラフィックを処理しているか」「ジョブは詰まっていないか」を可視化する必要がある。Issue #30 Phase 2 として Prometheus 互換の `/api/metrics` を提供する。Phase 3（system metrics: メモリ / GPU / CPU）は独立 Proposal にする。
- **Proposal:** `GET /api/metrics` を追加し、以下 4 系統のメトリクスを Prometheus text format で公開する:
  - `lizystudio_requests_total{method, path, status}` — Counter。HTTP リクエスト総数。`path` は FastAPI の route template（例: `/api/jobs/{job_id}`）。未マッチ path は `unmatched` に集約してカーディナリティ爆発を防ぐ。
  - `lizystudio_request_duration_seconds{method, path}` — Histogram。リクエスト処理時間。bucket は prometheus_client のデフォルトを採用。
  - `lizystudio_jobs_total{job_type, status}` — Counter。ジョブ終了時に `status=completed|failed|cancelled` で増分。`job_type` は `fit|tune`。
  - `lizystudio_active_jobs` — Gauge。JobStore の active slot が保持されている間は 1、解放されると 0。
- **Impact:**
  - 新規 runtime dep: `prometheus-client>=0.20`（pyproject.toml）
  - 新規: `src/lizystudio/metrics.py`（メトリクス定義 + `record_job_terminal()` helper）
  - 新規: `src/lizystudio/api/metrics_api.py`（`GET /api/metrics` エンドポイント）
  - 追加: `src/lizystudio/server.py` にミドルウェア登録 + router include
  - 追加: `src/lizystudio/services/jobs.py` の `claim_active` / `release_active` / `force_release_active_if` で `ACTIVE_JOBS` gauge を更新
  - 追加: `src/lizystudio/services/training.py` / `training_retune.py` の terminal status 確定箇所で `record_job_terminal()` 呼び出し
  - 新規: `tests/test_metrics_api.py`
  - 追記: BLUEPRINT.md §5.9
- **Compatibility:** 非破壊的（新規エンドポイント / 新規 runtime dep 追加のみ）。既存エンドポイントの挙動は変わらない。
- **Alternatives:**
  1. **選択肢 A（却下）**: prometheus-client を使わず自前で text format を生成する案。メリット: 依存ゼロ。デメリット: Histogram の bucket 生成 / label escape / HELP/TYPE ヘッダの正確な出力を再実装する必要があり、車輪の再発明。
  2. **選択肢 B（却下）**: OpenTelemetry SDK 経由で Prometheus exporter を吊るす案。メリット: 将来 OTLP に移行しやすい。デメリット: 依存が重く（otel-sdk + otel-instrumentation-fastapi）、Phase 2 のスコープに対して過剰。
  3. **選択肢 C（採用、本提案）**: `prometheus-client` の素朴な使い方（Counter / Histogram / Gauge + ASGI 公開）。軽量で枯れた選択。
- **Acceptance Criteria:**
  - (a) `GET /api/metrics` が 200 と `Content-Type: text/plain; version=0.0.4` を返す。
  - (b) 任意のリクエスト後に `/api/metrics` を叩くと、`lizystudio_requests_total{...}` の該当ラベル行が 1 以上になる。
  - (c) Fit / Tune ジョブ完了後、`lizystudio_jobs_total{job_type="fit",status="completed"}` 等が 1 以上になる。
  - (d) active ジョブが動いている間 `lizystudio_active_jobs` が 1、解放後 0 に戻る。
  - (e) `/api/metrics` エンドポイント自身は `lizystudio_requests_total` の計測対象から除外する（監視トラフィックが本体メトリクスを埋めるのを防ぐ）。
  - (f) Path label は FastAPI の route template を使い、`/api/jobs/{job_id}/metrics` のように正規化する（生の job_id がカーディナリティ爆発しない）。
- **Decision:** 2026-04-17 採択 (Issue #30 Phase 2)。Phase 3（system / GPU metrics）は別 Proposal。

---

### H-0066: ML ジョブ所要時間 Histogram とメトリクス仕上げ（Issue #30 Phase 3）
- **Status:** accepted
- **Scope:** API / Doc
- **Related:** BLUEPRINT.md §5.9（更新）
- **Context:** H-0065 で Prometheus メトリクスの土台を整えたが、`lizystudio_jobs_total` は終了カウントのみで「ジョブがどれだけ時間を食ったか」の分布が観測できない。本番監視で最重要なのは p95 / p99 の fit / tune 所要時間なので、Phase 3 として ML ワークロードに合わせた bucket の histogram を追加する。併せて、H-0065 実装後に実測した Content-Type の `version` 値が BLUEPRINT の記述（`0.0.4`）と一致しない（`prometheus-client>=0.25` のデフォルトは `1.0.0`）ため、ドキュメントを実測値に揃える。
- **Proposal:**
  1. `lizystudio_jobs_duration_seconds` Histogram を新設。ラベルは `job_type` ∈ `{fit, tune}` と `status` ∈ `{completed, failed, cancelled}`。bucket は ML ワークロードを意識して `(1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600, +Inf)` 秒。
  2. `JobStore.claim_active` が成功した時点から terminal status 確定時点までの経過秒を observe する。thread / subprocess 両モードで 1 回だけ emit する。
  3. BLUEPRINT §5.9 の Content-Type 例を `version=1.0.0` に修正し、メトリクス表に `lizystudio_jobs_duration_seconds` 行を追加。
  4. Phase 3 当初案で検討した `psutil` 依存追加は取りやめる（`prometheus_client` の default registry が既に `process_resident_memory_bytes` / `process_cpu_seconds_total` / `process_open_fds` 等を公開しているため重複）。GPU メトリクスは LizyStudio 側で扱わない（backend 固有なので別レイヤーで扱う）。
- **Impact:**
  - `src/lizystudio/metrics.py`: `JOBS_DURATION` Histogram 追加。`record_job_terminal` に `duration: float = 0.0` optional 引数を追加（既存 call site は後方互換）。
  - `src/lizystudio/services/training.py`: `_run_job_core` で `claim_active` 後に開始時刻を記録し、`_emit_terminal_metric` に経過秒を渡す。`_run_subprocess_job` の finally 側は `Job.created_at` ↔ `Job.completed_at` から算出。
  - `src/lizystudio/services/training_retune.py`: `_mark_retune_child_failed` でも duration を 0.0 fallback で記録（data missing は claim 前なので実測不能、fallback で可視化）。
  - `BLUEPRINT.md` §5.9 更新（行追加 + version fix）。
  - `tests/test_metrics_api.py`: Histogram presence + bucket 存在 test 追加。
- **Compatibility:** 非破壊的。`record_job_terminal` の新引数は default 付き。既存メトリクスのラベル / 名前は変わらない。
- **Alternatives:**
  1. **選択肢 A（却下）**: bucket を prometheus_client default (`0.005, 0.01, 0.025, ...`) のまま使う。デメリット: 分単位〜時間単位の ML ジョブでは `+Inf` bucket に全て落ちて histogram が役立たない。
  2. **選択肢 B（却下）**: `lizystudio_jobs_duration_seconds` を Summary にする。メリット: client 側で quantile 計算。デメリット: Summary は aggregation が難しく、複数プロセス環境（k8s replica 等）でのマージが不可能。Histogram の方が汎用性高い。
  3. **選択肢 C（採用、本提案）**: カスタム bucket Histogram。`status` ラベルで completed / failed / cancelled を切り分け、失敗ジョブが短命か長時間後に失敗するかまで分かる。
- **Acceptance Criteria:**
  - (a) `/api/metrics` 出力に `# TYPE lizystudio_jobs_duration_seconds histogram` が含まれる。
  - (b) fit / tune ジョブ 1 本完了後、該当ラベルの `lizystudio_jobs_duration_seconds_count` が 1 以上、`_sum` が正の値になる。
  - (c) bucket が ML ワークロード用のカスタム値で出力される（`le="60"` や `le="3600"` の bucket line が存在）。
  - (d) BLUEPRINT §5.9 の Content-Type 例が `version=1.0.0` と記述されている。
  - (e) subprocess mode / retune failure path からも duration が記録される（0.0 fallback 可）。
- **Decision:** 2026-04-17 採択 (Issue #30 Phase 3)。本 PR で Issue #30 は完了。

---

### H-0067: Re-tune / Resume / Lineage UI を Workspace と Jobs 画面の両方に提供する（Issue #159）
- **Status:** accepted
- **Scope:** Frontend / Doc
- **Related:** BLUEPRINT.md §4.2.3（Workspace Results）、§4.3.2（Jobs 詳細）、§4.3.3（Jobs アクション）
- **Context:**
  H-0062 Phase B で Re-tune / Resume / Lineage Tree を Workspace Results Panel にのみ実装したが、BLUEPRINT §4.3 は当初から「Jobs 画面からも系譜を辿って再チューニングできる」ことを要件としていた（2026-04-17 audit で Issue #159 として surfaced）。Workspace は「セッション中の現在結果」、Jobs は「履歴全体管理」というレイヤー責務があり、ユーザーからは「過去の Tune 一覧を辿って再チューン系譜を起こす」UX が現場で必要という判断が出た。
- **Proposal:**
  1. **コンポーネント共有化**: `frontend/src/components/workspace/retune/` を `frontend/src/components/retune/` に移動し、Workspace / Jobs 両画面から同一実装を import する。
  2. **Jobs/JobDetail.tsx 拡張**:
     - アクションバーに `Re-tune (+N trials)` / `Resume (X trials remaining)` ボタンを追加（Completed tune / Failed tune で state-gated）。
     - 右パネルの Accordion に `Lineage` セクションを追加（Config / Execution Log と並ぶ、読取り + クリック navigation）。
     - Re-tune / Resume で child job が作成されたら Jobs 画面内で自動選択（Workspace へは遷移しない）。
  3. **DeleteDialog に cascade オプション追加**: lineage に子孫がある場合のみ `Delete descendants too` チェックボックスを表示。API は `deleteJob(jobId, { cascade: true })` で既に対応済み。
  4. **BLUEPRINT 更新**: §4.2.3 の Workspace Results Panel に Retune / Resume / Lineage が常設されることを明記（現在 spec は §4.3 側のみ記述）。§4.3 側の記述はすでに正しい。
- **Impact:**
  - `frontend/src/components/retune/*.tsx` (9 ファイル移動、旧 path の参照も全置換)
  - `frontend/src/components/workspace/ResultsPanel.tsx`, `ResultsCompletedView.tsx` (import path 更新)
  - `frontend/src/components/jobs/JobDetail.tsx` (action bar 拡張 + Lineage accordion)
  - `frontend/src/components/jobs/DeleteDialog.tsx` (cascade checkbox + lineage precheck)
  - `BLUEPRINT.md` §4.2.3 追記
  - Vitest unit tests 追加（JobDetail actions / DeleteDialog cascade）
  - Playwright E2E 追加（Jobs から Re-tune → child が Jobs リストに出る）
- **Compatibility:** 非破壊的 API（新エンドポイント無し・既存 API の引数変更なし）。UI のみ拡張。既存の Workspace 側 UX は変化しない。
- **Alternatives:**
  1. **BLUEPRINT を code に合わせて書き換える（却下）**: Workspace のみに retune を置く仕様に変更。メリットは二重導線回避、しかしユーザーの「ジョブ履歴から直接再チューン」ワークフローを排除してしまう。
  2. **Lineage Tree のみ Jobs に追加、actions は Workspace のまま（却下）**: 導線を分割する中間案だが、「Jobs で Lineage を見て、別画面 (Workspace) へ移動してアクション」という余計なクリックが発生し、ユーザーの期待に反する。
  3. **両方に実装する（採用、本提案）**: コード共有で重複を回避しつつ、ユーザーはどちらの画面からでも retune できる。
- **Acceptance Criteria:**
  - (a) `frontend/src/components/retune/` が新規作成され、Workspace / Jobs 両方から import される。
  - (b) Jobs 画面のアクションバーに Completed tune で `Re-tune` ボタン、Failed tune で `Resume` ボタンが表示される。
  - (c) Jobs 詳細の Accordion に `Lineage` が現れ、ノードクリックで左パネルの選択が切り替わる。
  - (d) Jobs 画面から Re-tune した後、child job が Jobs リストに即座に現れ、自動選択される。
  - (e) DeleteDialog で lineage に子孫がある場合 `Delete descendants too` checkbox が表示され、cascade クエリで API が呼ばれる。
  - (f) 既存の Workspace 側 retune 導線の Vitest / Playwright テストが全て pass する（regression なし）。
  - (g) BLUEPRINT §4.2.3 に Workspace 側の retune UI が記述される。
- **Decision:** 2026-04-18 採択 (Issue #159)。

### H-0068: BackendAdapter 契約のクリーンアップ（Phase 2 coupling refactor）
- **Status:** proposed
- **Scope:** Backend | Adapter
- **Related:** BLUEPRINT.md §3.3（BackendAdapter Protocol）、docs/coupling-analysis.md A-1 / A-2 / A-5 / A-6
- **Context:** docs/coupling-analysis.md の監査により、`BackendAdapter` Protocol が 22 メソッドの一枚岩になっていること、`api/retune.py` / `services/training.py` が `backends.lizyml` から `PickleIncompatibleError` / `verify_pickle_compatibility` を直接 import していること、`backends/lizyml/lifecycle_mixin.py` が `services.training.CancelledError` を逆依存で import していること、`backends/registry.py` の型が `type[LizyMLAdapter]` 固定で 2nd backend を型エラーなしに登録できないこと、の 4 点が特定された。2nd ML backend 追加のコストを下げる前提として、これらの coupling を解消する。
- **Proposal:**
  1. `backends/exceptions.py` を新設し、`CancelledError` と新規 `CheckpointIncompatibleError` の正典定義をここに置く。`services/training` および `services/_training_core` は identity 互換のため re-export のみ残す。
  2. `BackendAdapter` Protocol を `BackendCore`（lifecycle: `info`/`get_config_schema`/`validate_config`/`create_model`/`fit`/`tune`/`predict`/`save_checkpoint`/`load_checkpoint`/`load_model`/`export_model`/`model_info`/`get_default_config`/`load_config_from_file`）/ `BackendEvaluator` / `BackendPlotter` / `BackendCodeExporter` / `BackendUiSchemaProvider` に分割する。既存の `BackendAdapter` は全 Protocol を継承した runtime_checkable alias として残し、現行の `adapter: BackendAdapter` 型注釈はすべて継続して動作する。
  3. `BackendAdapter` に `verify_checkpoint_compatibility(job_dir: Path) -> None` を追加し、実装を `LizyMLAdapter.verify_checkpoint_compatibility` に置く。`api/retune.py` / `services/training.py` は `backend.verify_checkpoint_compatibility(...)` を呼び、`CheckpointIncompatibleError` を catch する。`from backends.lizyml import PickleIncompatibleError, verify_pickle_compatibility` は削除する。
  4. `backends/registry.py` の `_ADAPTERS` を `dict[str, Callable[[], BackendAdapter]]` に緩和し、`register_backend(name, factory)` を公開する。既存 lizyml 登録は lazy factory `lambda: LizyMLAdapter()` に置き換える。
- **Impact:** `src/lizystudio/backends/base.py`, `backends/types.py`, `backends/registry.py`, `backends/lizyml/adapter.py`, `backends/lizyml/lifecycle_mixin.py`, `api/retune.py`, `services/training.py`, `services/_training_core.py`, 新規 `backends/exceptions.py`. Wire format / HTTP API / pickle 形式は変更しない。
- **Compatibility:** 非破壊的。HTTP レスポンス・WebSocket メッセージ・保存形式は変更なし。`BackendAdapter` は継承 alias として残り、既存の `adapter: BackendAdapter` 型注釈・`isinstance` チェックはすべて動作する。`CancelledError` は `services.training` 経由でも従来どおり import 可能（同一クラス）。
- **Alternatives:**
  - (a) Protocol を全廃して abstract base class に変更 → 却下。duck typing を失い、2nd backend がサードパーティ実装として提供しづらくなる。
  - (b) capability discovery パターン（`adapter.evaluator()` が `BackendEvaluator | None` を返す）→ 却下。`hasattr` より冗長で、Phase 2 の目的（契約の整理）を超えた過剰設計。
  - (c) registry を entry_points ベースの plugin discovery 化 → 却下。Phase 2 のスコープを超える。`register_backend()` の追加のみで将来拡張は可能。
- **Acceptance Criteria:**
  - (a) `grep -r "from lizystudio.backends.lizyml" src/lizystudio/api src/lizystudio/services` が 0 件。
  - (b) `grep -r "from lizystudio.services.*training.*import CancelledError" src/lizystudio/backends` が 0 件。
  - (c) `register_backend("fake", lambda: FakeAdapter())` + `get_adapter("fake")` の unit test が mypy strict でも pass する。
  - (d) `isinstance(adapter, BackendEvaluator)` 等の runtime_checkable チェックが `LizyMLAdapter` で True を返す。
  - (e) `from lizystudio.services.training import CancelledError` と `from lizystudio.backends.exceptions import CancelledError` が同一クラス（`is` 比較 True）。
  - (f) `uv run pytest -m "not slow"` と `pnpm test` が green、coverage ≥ 80% 維持。
  - (g) API smoke (`/workspace/fit` / `/workspace/tune` / `/jobs/{id}/retune`) が PR マージ前と同じレスポンスを返す。
- **Decision:** 2026-04-19 採択（PR #192）。

### H-0069: WebSocket 進捗メッセージ schema を Pydantic discriminated union で SSOT 化（Phase 2 coupling refactor）
- **Status:** proposed
- **Scope:** API | Frontend | Backend
- **Related:** BLUEPRINT.md §5.5（WebSocket progress protocol）、docs/coupling-analysis.md C-3
- **Context:** 現状、WS 進捗メッセージの schema は 3 経路に分散している: `ws/progress.py` の `send_progress` / `send_completed` / `send_error`（親→ブラウザ送信）、`services/subprocess_runner.py` の `_forward_progress` + `_FileBroadcaster.send_*`（子→親 JSONL ファイル経由）、`frontend/src/api/types.ts:191-212`（ブラウザ側の `WsMessage` 手書き定義）。監査の結果、手書き TS 側は `ProgressMessage` で `job_id` が欠落、`CompletedMessage` で `message` が欠落、`ErrorMessage` で `job_id` / `code` が欠落と、backend 送信実体と drift している。加えて backend 送出の `ping` が TS union に無く `try/catch` で黙殺されている。C-2 が確立した `response_model` + schema.d.ts パイプラインを WS 面にも拡張する。
- **Proposal:**
  1. `src/lizystudio/ws/messages.py` を新設し、`WsProgress` / `WsCompleted` / `WsError` / `WsPing` を `extra="forbid"` の Pydantic モデルとして定義する。`WsMessage` は `Annotated[Union[...], Field(discriminator="type")]` で discriminated union 化。`model_config = ConfigDict(extra="forbid")` とし、Optional field は `None` デフォルトで **かつ** `model_dump(exclude_none=True)` を使って wire に `null` を載せないことで bit-identical を維持。
  2. `ws/progress.py::ProgressBroadcaster.send_*` の内部 dict 組み立てを Pydantic モデル構築に置換し、`websocket.send_text(model.model_dump_json(exclude_none=True))` で送信。broadcaster のキュー要素は dict のまま（既存 back-pressure 実装と互換）、`send()` に渡す前に `model.model_dump(exclude_none=True)` で dict 化する。
  3. `frontend/src/api/schema.d.ts` に Python 側の `WsMessage` を露出させるため、`api/models.py` もしくは新規 `api/ws_models.py` で「documentation-only」な stub を追加する（OpenAPI `components.schemas` に登録され、openapi-typescript で TS 型に反映される）。HTTP endpoint は増やさない。
  4. `frontend/src/api/types.ts:191-212` の手書き `WsMessage`/`ProgressMessage`/`CompletedMessage`/`ErrorMessage` を削除し、生成された schema.d.ts から型を re-export。`ping` variant も union に含める。
  5. **経路 B（子→親 JSONL）は本 PR のスコープ外**。`_forward_progress` / `_FileBroadcaster` の既存 dict ベース処理は維持（JSONL はプロセス内部通信で一時ファイル、child process 側で `job_id` を持たない設計が残っているため、経路 A/C と wire 差異がある）。これを統一する場合、child 側に `job_id` を渡す別 refactor が必要になり scope が肥大化するため、別 PR で扱う。
- **Impact:** `src/lizystudio/ws/messages.py`（新規）、`ws/progress.py`、`frontend/src/api/types.ts`、`frontend/src/api/generated/schema.d.ts`、`frontend/src/api/websocket.ts` 等の WS 利用箇所、必要に応じて `api/models.py`（stub エンドポイント用）。backend → browser の wire format は bit-identical（golden JSON fixture で保証）、HTTP API は変更なし、pickle / 保存形式も変更なし。
- **Compatibility:**
  - Wire format: bit-identical（optional field は `exclude_none=True` で null を載せない）。既存ブラウザクライアントは無修正で動作。
  - 手書き `WsMessage` 型削除は TS 側 public API 変更だが、frontend モノレポ内でのみ使用されており外部配布なし。
  - `ping` variant が TS union に加わることで、既存の switch-case が網羅チェックに引っかかる可能性がある。該当箇所は `case 'ping': break` を追加する。
- **Alternatives:**
  - (a) TS を手書き維持、JSON Schema を docstring で共有 → 却下。drift を検知できない。
  - (b) 経路 B も同じ union で扱うため child に job_id を渡す → 却下。scope 肥大化。別 PR に分離。
  - (c) `response_model` のある dummy HTTP endpoint で schema 露出 → 採用（本 proposal 案 3）。openapi-typescript の自然な出力ルートを使う。
- **Acceptance Criteria:**
  - (a) `grep -rn "type.*progress\|type.*completed\|type.*error" frontend/src/api/types.ts` で手書き `WsMessage` 定義が 0 件（生成型からの re-export のみ）。
  - (b) `frontend/src/api/generated/schema.d.ts` に `WsMessage` / `WsProgress` / `WsCompleted` / `WsError` / `WsPing` 相当の型が出現する。
  - (c) `pytest tests/test_ws_messages.py` で INV-WS-1..4 が green。
  - (d) golden JSON fixture による bit-identical 検証が pass（既存 browser client が新 backend と無停止で通信）。
  - (e) `pnpm build` + `pnpm vitest run` + `api-types-drift` CI job が green。
  - (f) 経路 B の JSONL 送受信は wire format 未変更（regression なし）。
- **Decision:** 未決定。

### H-0070: `services/jobs.py` God Module 分割と model LRU キャッシュ（Phase 3 coupling refactor）
- **Status:** proposed
- **Scope:** Backend | Internal only（公開 API / wire format / 保存形式 変更なし）
- **Related:** docs/coupling-analysis.md A-7
- **Context:** `services/jobs.py` は 751 行の God Module で、disk CRUD（persistence）と `BackendAdapter` ディスパッチ（evaluate/plot/importance 等の結果変換）を同居させていた。結果変換関数は `Job + BackendAdapter → 結果データ` という責務で、persistence とは明確に層が異なる。さらに各関数が毎回 `backend.load_model(job.model_path)` を呼ぶため、同じ完了ジョブに対して `get_metrics_table` / `get_split_summary` / `get_importance_kinds` / `get_job_plot` … と複数エンドポイントが連続で叩かれると、その都度 disk read + deserialize が走る無駄が発生していた。
- **Proposal:**
  1. `src/lizystudio/services/job_results.py` を新設し、`load_job_model` / `get_metrics_table` / `get_split_summary` / `get_importance` / `get_importance_kinds` / `get_learning_curve_metrics` / `get_job_plot` / `get_available_plots` と private helper `_get_jobs_dir` / `_load_tuning_plot_from_file` を移動する。
  2. `load_job_model` に process-local LRU キャッシュ（`OrderedDict` + `threading.Lock`, `maxsize=8`）を追加。キーは `(backend_name, model_path)`。ロード本体も critical section 内で実行し、並列キャッシュミスで二重 load + ABA レースが起きないようにする。
  3. `clear_model_cache()` / `clear_model_cache_for(path)` を公開し、テスト fixture および将来の invalidation hook から利用可能にする。
  4. `JobStore.delete()` で削除対象の model キャッシュエントリを `clear_model_cache_for` で drop。rmtree 後の stale entry が次回 lookup を汚染しない。
  5. `services/jobs.py` 末尾で `from .job_results import …` による back-compat re-export を用意。既存の `from lizystudio.services.jobs import load_job_model` 系 import 全箇所（20+ テスト、複数 api/ modules）を書き換えない。
- **Impact:** `src/lizystudio/services/job_results.py`（新規, 143 行）、`src/lizystudio/services/jobs.py`（751 → 695 行）、`tests/test_job_results.py`（新規, 19 テスト）。公開 API / wire format / 保存形式 / BackendAdapter Protocol は変更なし。
- **Compatibility:**
  - import 互換: 既存の `from services.jobs import …` は re-export で継続動作。
  - wire format 変更なし。
  - キャッシュは process-local なため、multi-worker 配備でも workers 間の整合性に影響なし。
- **Alternatives:**
  - (a) `functools.lru_cache` を直接使う → 却下。インスタンス引数 (`Job` / `BackendAdapter`) 非ハッシャブルに対応できず、invalidation API も公開できない。
  - (b) per-key Event によるローディング中の並列待機（stampede 回避）→ 却下。キャッシュサイズ 8 / 小規模 deployment なら単一 lock の方が単純で十分。必要なら後続 PR で拡張。
  - (c) キャッシュ無しで分割のみ実施 → 却下。Results 画面の同時 4+ fetch が都度 disk read を引き起こすという実ボトルネックを放置するのは本質回避。
- **Acceptance Criteria:**
  - (a) 既存テスト 1136 件 + 新規 19 件 = 1138+ 件（jobs テストの置換分を考慮）が green。
  - (b) `uv run mypy src/lizystudio/` / `uv run ruff check .` / `uv run ruff format --check .` 全 clean。
  - (c) `services/jobs.py` の行数が 700 行以下、`services/job_results.py` の行数が 150 行以下。
  - (d) `load_job_model` の同一 `(backend_name, model_path)` 連続呼び出しで `backend.load_model` が 1 回のみ走る（LRU ヒット）。
  - (e) `JobStore.delete()` 後に同 path のキャッシュエントリが drop されている（regression: stale model hit 防止）。
- **Decision:** 2026-04-20 accepted — PR #194 で実装、1136+19=1144 件 pytest green、`services/jobs.py` 695 行 / `services/job_results.py` 143 行で受け入れ基準 (a)〜(e) を全て充足。

---

### H-0071: `JobSummary` / `JobDetail` 契約の SSOT 化（Phase 3 coupling refactor C-4）
- **Status:** accepted
- **Scope:** API | Frontend | Internal only（wire format は既存 response と互換）
- **Related:** docs/coupling-analysis.md C-4
- **Context:** `frontend/src/api/types.ts` の `JobSummary` / `JobDetail` / `FitResult` / `TuneResult` は手書きで、backend Pydantic (`api/models.py`) と生成 TypeScript (`schema.d.ts`) の 3 経路で独立に宣言されていた。さらに `JobSummaryResponse` / `JobDetailResponse` は `ConfigDict(extra='allow')` だったため生成 schema に `& { [key: string]: unknown }` のエスケープが付き、drift 検出が甘かった。副次的に `JobDetail.data_ref` / `JobDetail.model_path` は手書き型にのみ存在する dead field（実際の API レスポンスに含まれない、フロントエンドでも参照箇所なし）だった。
- **Proposal:**
  1. `api/models.py` に `FitResultResponse` / `TuneResultResponse` を新設し、`JobDetailResponse.fit_result` / `tune_result` を `dict[str, Any] | None` からこの concrete model に差し替える。`metrics` / `fold_count` / `best_params` 等のキーが生成 TS 型で見えるようになる。
  2. `JobSummaryResponse` / `JobDetailResponse` から `ConfigDict(extra='allow')` を削除し、`model_name` を `str | None = None` から `str = ""` に引き締める（`_job_summary` で既に常に空文字を埋めている実態に合わせる）。
  3. `frontend/src/api/types.ts` で `JobSummary` / `JobDetail` / `FitResult` / `TuneResult` を `components["schemas"]["…Response"]` 再エクスポートに置換。手書き `data_ref` / `model_path` / `FitResultParam[]` 形式の `params` を削除。
  4. Backend 側 contract test を 2 本追加し、`JobSummaryResponse` / `JobDetailResponse` の strict shape（未宣言フィールド・extra escape なし）を assert する。
- **Impact:** `src/lizystudio/api/models.py`（+50 行）、`tests/test_jobs_api.py`（+50 行: 2 本の contract test）、`frontend/src/api/types.ts`（-48 行）、`frontend/src/api/generated/schema.d.ts`（再生成: `& {[key: string]: unknown}` エスケープ削除 + `FitResultResponse` / `TuneResultResponse` 追加）、5 本の test ファイルから dead `data_ref` / `model_path` リテラルを削除。
- **Compatibility:**
  - wire format 変更なし（`_job_summary` / `get_job` の JSON 出力は以前と同一。`model_name` は以前も `""` で埋められていた）。
  - Pydantic Response model から `extra='allow'` を外したが、余計なフィールドを返す箇所は存在しない（`response_model` 側でフィルタされるだけ）。
  - 手書き型削除は frontend の consumer コードに一切変更不要（field アクセスの名前は全て維持）。`data_ref` / `model_path` を読むコードは元々なかった。
- **Alternatives:**
  - (a) `NonNullable<components["schemas"]["JobSummaryResponse"]>` ヘルパで `?` 記法を剥がす（メモリ内推奨）→ 却下。`extra='allow'` を剥がす root cause fix を選んだほうが永続的で、`model_name?: string | null` を `string = ""` に締められる。
  - (b) `JobDetail` に `data_ref` / `model_path` を正式に追加（backend 側にも response field を足す）→ 却下。フロントエンドで参照箇所が存在せず、追加する業務価値がない。将来必要になった時点で改めて提案する。
- **Acceptance Criteria:**
  - (a) backend pytest 1144+ 件 + 新規 contract 2 件が green。
  - (b) `pnpm generate:api` / `pnpm build` / `pnpm check` / vitest 1500+ 件 green。
  - (c) `frontend/src/api/types.ts` 内に `JobSummary` / `JobDetail` / `FitResult` / `TuneResult` の手書き `interface` が残っていない（`components["schemas"]…` 再エクスポートのみ）。
  - (d) `api-types-drift` CI ジョブが pass する（schema 再生成が commit に含まれている）。
- **Decision:** 2026-04-20 accepted — 提案通り実装。

---

### H-0072: `UiSchema` 契約の SSOT 化（Phase 3 coupling refactor C-5a）
- **Status:** accepted
- **Scope:** API | Frontend | Internal only（wire format は既存 response と互換）
- **Related:** docs/coupling-analysis.md C-5、H-0026
- **Context:** `GET /api/backends/ui-schema` は `response_model=` 未指定で `dict[str, Any]` passthrough だった。OpenAPI には `additionalProperties: true` しか載らず、frontend では `frontend/src/api/types.ts` に 22 行の手書き `UiSchema` / `ParameterHint` / `SearchSpaceCatalogEntry` interface を置いていた。backend の `build_ui_schema()` dict（`backends/lizyml_ui_schema.py`）と hand-written TS は独立定義のままで、どちらかが変わったとき drift を検知できない状態だった。
- **Proposal:**
  1. `api/models.py` に `UiSchemaResponse` / `UiSection` / `ParameterHintResponse` / `SearchSpaceRangeDefault` / `SearchSpaceCatalogEntryResponse` / `UiCapabilities` / `UiCapabilitiesTune` を新設。既存手書き TS interface と 1:1 で対応する shape にし、ネストの深い可変部分（`option_sets` の 2 階層 dict, `default` の scalar/list/dict 混在）は `dict[str, ...]` / `Any` のまま残す。
  2. `api/backends.py:25` の `get_ui_schema` endpoint に `response_model=UiSchemaResponse` を付与。
  3. `frontend/src/api/types.ts` の `UiSchema` / `ParameterHint` / `SearchSpaceCatalogEntry` を `components["schemas"]["…Response"]` 再エクスポートに置換（22 行 → 10 行）。
  4. 生成 TS は optional field を `?: T | null` で表現するため、既存 consumer 側が `string | null | undefined` を `string | undefined` に渡す 11 箇所（ConfigForm / DynParam / SearchSpaceTable / TuneTab）を `?? undefined` で吸収。`FormRow.description` prop は `string | null` を受け入れるように prop 型を広げる。
  5. Backend 側 contract test を 1 本追加。`UiSchemaResponse.model_validate(resp.json())` で strict shape をその場検証。
- **Impact:** `src/lizystudio/api/models.py`（+100 行）、`src/lizystudio/api/backends.py`（+6 行: response_model + docstring）、`tests/test_ui_schema.py`（+20 行: contract test）、`frontend/src/api/types.ts`（-48 行 → +12 行）、`frontend/src/api/generated/schema.d.ts`（再生成: `UiSchemaResponse` 等 7 型が追加）、`FormRow.tsx` / `ConfigForm.tsx` / `SearchSpaceTable.tsx` / `TuneTab.tsx`（null→undefined narrow）。
- **Compatibility:**
  - wire format 変更なし。`backend.get_ui_schema()` の出力 dict をそのまま通す（Pydantic は validate するだけ、フィールド数は不変、`extra="allow"` で前方互換）。
  - frontend consumer の prop 契約（`KeyValueEditor.additionalParams`, `CalibrationSection.calibrationMethods` など）は型拡張なしで、`?? undefined` で caller 側が受け渡し時に narrow。UX / 描画ロジック不変。
  - 定数整理（`METRICS_BY_TASK` / `CV_STRATEGY_FIELDS` の退役）は C-5b として別 PR に分離。
- **Alternatives:**
  - (a) Pydantic 側で Optional field を必須 (default 値) に絞って `| None` を排除 → 却下。将来別 backend が `capabilities` や `calibration_methods` を返さない可能性があるので、Optional を維持する方が前方互換。
  - (b) `response_model_exclude_none=True` で wire から null を消す → 部分的に有効だが、生成 TS は依然 `?: T | null` を出すため consumer 側の型不整合は解消しない。`?? undefined` の方が明示的。
  - (c) frontend 側で `type UiSchemaStrict = { [K in keyof Gen]-?: NonNullable<Gen[K]> }` ヘルパを作る → 却下。ネスト型（`capabilities` 等）で再帰が必要になり複雑化する割に、影響箇所が 11 カ所なので個別対応の方がコスト低。
- **Acceptance Criteria:**
  - (a) backend pytest 1146+1 = 1147 件 green、`uv run mypy src/lizystudio/` / ruff clean。
  - (b) `frontend/src/api/types.ts` 内に `UiSchema` / `ParameterHint` / `SearchSpaceCatalogEntry` の手書き `interface` が残っていない。
  - (c) `pnpm build` + `pnpm check` + vitest 1583 件 green。
  - (d) `api-types-drift` CI ジョブが pass（schema 再生成を同一 commit に含める）。
- **Decision:** 2026-04-20 accepted — 提案通り実装。

---

### H-0073: `JobStore.path_for` による on-disk layout SSOT 化（Phase 3 coupling refactor A-10）
- **Status:** accepted
- **Scope:** Backend | Internal only（保存レイアウト・wire format・BackendAdapter Protocol すべて不変）
- **Related:** docs/coupling-analysis.md A-10、BLUEPRINT.md §3.4.4
- **Context:** `{jobs_dir}/{job_id}/<artifact>` の path 構築が `services/jobs.py` / `services/training.py` / `services/_training_core.py` / `services/training_retune.py` / `services/job_results.py` / `api/retune.py` の 14+ 箇所に独立に散らばっていた。`JobStore._job_dir` は private helper で外部から使えず、`meta.json` / `execution.log` / `model/` / `tuning_plot.json` の filename が呼び出し側で直書きされているため、ファイル名変更や新しい artifact の追加時に漏れなく追跡する方法がなかった。
- **Proposal:**
  1. `services/jobs.py` にモジュール定数 `ArtifactKind` (`Literal[...]`) と `ARTIFACT_FILENAMES: dict[ArtifactKind, str]` を導入。BLUEPRINT §3.4.4 の全 artifact（`meta` / `fit_result` / `tune_result` / `model` / `log` / `tuning_plot` / `cancel_flag`）をここに集約。
  2. `JobStore` に public メソッド `job_dir(job_id)` / `path_for(job_id, kind)` を追加。どちらも path traversal guard 付きの `_job_dir` 経由で解決。
  3. `JobStore` インスタンスを持たない caller（`services/job_results.py`）向けに、module-level helper `artifact_path(jobs_dir, job_id, kind)` を公開。`job.model_path` から `jobs_dir` を逆算する既存経路と互換。
  4. 14+ 箇所の `jobs_dir / job_id / "..."` と `_job_dir(...)` 使用を `path_for(kind)` / `job_dir(job_id)` / `artifact_path(...)` に置換。
  5. tmp file の construction（`.cancel-{pid}.tmp`）は一時ファイルであり artifact ではないため対象外。`inference.py` が使う `{jobs_dir}/{job_id}/inferences/...` も別レイヤ（`InferenceStore`）なので本 PR スコープ外。
- **Impact:** `src/lizystudio/services/jobs.py`（+56 行: module constants + 2 methods + helper）、`src/lizystudio/services/training.py`（4 箇所置換）、`src/lizystudio/services/_training_core.py`（1 箇所置換）、`src/lizystudio/services/training_retune.py`（2 箇所置換）、`src/lizystudio/services/job_results.py`（1 箇所置換 + import 1 行）、`src/lizystudio/api/retune.py`（1 箇所置換）。
- **Compatibility:**
  - 保存 layout 変更なし。全置換は「構築経路のみ」の変更で、生成される `Path` は以前と bit-identical（同じ string 結果）。
  - wire format / BackendAdapter Protocol 変更なし。
  - 既存テスト 1146 件はすべて無修正で通過（contract test 追加分を除けば +1 件 = 1147 件）。
- **Alternatives:**
  - (a) `JobStore._job_dir` を public 化するだけで終える → 却下。filename の直書きが残ると SSOT にならない。
  - (b) `pathlib.Path` サブクラスで `Job.meta_path` 等のプロパティを生やす → 却下。`Job` dataclass が `JobStore` を知るのは逆向き依存。
  - (c) `Enum` を使って `ArtifactKind` を表現 → 却下。`Literal[...]` の方が mypy 上で caller 側が文字列リテラルを直接書けて簡潔。`dict[Literal[...], str]` は mypy で網羅性検証される。
- **Acceptance Criteria:**
  - (a) `grep -rn "jobs_dir.*/.*job" src/lizystudio/services` が `artifact_path` 実装本体と `_job_dir` 本体を除いて 0 件（inference.py 除く）。
  - (b) backend pytest 1146+1 件 = 1147 件 green。
  - (c) `uv run mypy src/lizystudio/` / `uv run ruff check .` / `uv run ruff format --check .` 全 clean。
  - (d) `ARTIFACT_FILENAMES` を `JobStore.path_for` / module-level `artifact_path` の両経路から共有。
- **Decision:** 2026-04-20 accepted — 提案通り実装。

### H-0074: `METRICS_BY_TASK` fallback 退役と `cv_default_strategy` の UiSchema 化（Phase 3 coupling refactor C-5b Part 1）
- **Status:** accepted
- **Scope:** Frontend | Internal only（wire format / BackendAdapter Protocol 不変、ユーザー体験は uiSchema ロード前の一瞬のみ変化）
- **Related:** docs/coupling-analysis.md C-5b、H-0026（UiSchema 契約）、H-0072（C-5a）
- **Context:** `frontend/src/components/workspace/constants.ts` に残る 3 種の "fallback" 定数（`METRICS_BY_TASK` / `CV_STRATEGY_FIELDS` / `getDefaultCvStrategy`）のうち、`METRICS_BY_TASK` は `MetricsChips` が `metricsByTask` prop（= `uiSchema.option_sets.metric`）を常に受け取る現状では uiSchema ロード前の一瞬しか使われておらず、また `getDefaultCvStrategy` は task → default CV strategy の map でバックエンド (`UiCapabilities.cv_default_strategy`) に SSOT が既に存在する。`CV_STRATEGY_FIELDS` は backend の `UiCapabilities.cv_strategy_fields` と**フィールド名が乖離**しており（UI internal name `folds`/`train_size_max` vs wire-format `n_splits`/`max_train_size`、`blocked_group_kfold` の fields は完全に別体系）、単純置換は破綻するため本 PR 対象外。
- **Proposal:**
  1. `MetricsChips.tsx` から `METRICS_BY_TASK` import と fallback ブロックを削除。`metricsByTask` が未指定の場合は `available=[]` になり、既存の早期 `return null` に到達する。
  2. `constants.ts` から `METRICS_BY_TASK` エクスポートを削除。`constants.test.ts` から `METRICS_BY_TASK` テストブロックを削除。
  3. `useDataPanel` に `uiSchema?: UiSchema` を受け取る既存 props を活性化し、`resolveDefaultCvStrategy(task)` helper で `uiSchema.capabilities?.cv_default_strategy?.[task] ?? getDefaultCvStrategy(task)` の順に引く。`handleTargetChange` / `handleTaskChange` 両方から使用。
  4. `getDefaultCvStrategy` は**残置**。uiSchema がまだ来ていない最初の render で `INITIAL_CV_STATE` から task 変更を受けた際の fallback としてまだ必要。
  5. `CV_STRATEGY_FIELDS` / `CV_STRATEGY_LABELS` は**残置**。前者は `cv-state.ts` の `buildSplitConfig` / `applyCvDataFields` が UI internal field name で依存しており、backend の `cv_strategy_fields` とフィールド名を揃える別 PR (C-5b Part 2) が必要。後者は表示名マップで backend に同等物が存在しない。
- **Impact:** `frontend/src/components/workspace/MetricsChips.tsx`（import 1 行削除、`useMemo` 9 行 → 4 行に縮約）、`frontend/src/components/workspace/constants.ts`（header コメント更新 + `METRICS_BY_TASK` 削除、-23 行）、`frontend/src/components/workspace/constants.test.ts`（`METRICS_BY_TASK` test block 削除 -21 行）、`frontend/src/components/workspace/MetricsChips.test.tsx`（fallback 依存テスト 8 件に `metricsByTask` prop 明示、新規テスト 1 件追加）、`frontend/src/hooks/useDataPanel.ts`（`resolveDefaultCvStrategy` helper 導入 +7 行、既存 `_uiSchema` prop 活性化、2 箇所の `getDefaultCvStrategy` 呼び出しを置換）、`frontend/src/hooks/useDataPanel.test.ts`（新規テスト 3 件）。
- **Compatibility:**
  - Backend 側変更なし。`UiCapabilities.cv_default_strategy` は既に H-0026 時点で公開済みで schema 変更なし。
  - `MetricsChips` が uiSchema ロード前に何も描画しない期間は従来 `METRICS_BY_TASK` fallback で 6 chip を見せていた一瞬が消える。実運用では `UiSchemaQuery` は `ConfigForm` mount と同時に走り、差は数 100ms 未満で視認困難。
  - wire format / BackendAdapter Protocol / storage layout / ユーザー設定ファイル変更なし。
- **Alternatives:**
  - (a) Phase 3 の `CV_STRATEGY_FIELDS` 退役も同 PR で実施 → 却下。UI internal name `folds` と wire name `n_splits` を揃えるために `cv-state.ts` の全面改修と `UiCapabilities.cv_strategy_fields` のフィールド名再設計が必要。2-3 日規模で C-5b Part 2 として別 PR 化。
  - (b) `METRICS_BY_TASK` を残して "loading 時の spinner 代わり" として維持 → 却下。実態として MetricsChips は初期状態で empty chips でも UX 問題がなく（Evaluation accordion が閉じている場合が多い）、SSOT 化の方が価値が高い。
  - (c) `getDefaultCvStrategy` も削除し `INITIAL_CV_STATE.strategy` を UiSchema 後に同期 → 却下。`INITIAL_CV_STATE` は module-level const で uiSchema に依存できない。hook 側で fallback するのが最小変更。
- **Acceptance Criteria:**
  - (a) `grep -rn 'METRICS_BY_TASK' frontend/src` が 0 件。
  - (b) `useDataPanel` が `uiSchema.capabilities.cv_default_strategy.{task}` を優先するテスト + 不在時は `stratified_kfold`/`kfold` に fallback するテストが両方 green。
  - (c) `MetricsChips` が `metricsByTask` undefined で `null` を返すテスト green。
  - (d) `pnpm test` / `pnpm check` / `pnpm tsc --noEmit` / `pnpm build` すべて clean、`uv run pytest` も変化なし。
- **Decision:** 2026-04-20 accepted — 提案通り実装。C-5b Part 2（`CV_STRATEGY_FIELDS` retirement）は別 issue として起票予定。

### H-0075: Prometheus メトリクスの per-app `MetricsRegistry` 化（Phase 3 coupling refactor A-9）
- **Status:** accepted
- **Scope:** Backend | Internal only（wire format / scrape 出力 / BackendAdapter Protocol すべて不変）
- **Related:** docs/coupling-analysis.md A-9、H-0065（メトリクス初版）、H-0066（jobs_duration histogram）
- **Context:** `src/lizystudio/metrics.py` の `Counter` / `Histogram` / `Gauge` は prometheus_client の default `REGISTRY` に module-level で登録されていた。このため pytest で 2 つの `FastAPI` app を同プロセスで作ると 2 度目の `create_app()` が `Duplicated timeseries in CollectorRegistry` で失敗する。また `ACTIVE_JOBS.set(0)` が process-wide state であり、テスト間で active-job gauge が leak していた。multi-backend ML 対応を見据えて、app ごとに独立したメトリクスバンドルを持ちたい。
- **Proposal:**
  1. `metrics.py` を書き換え、`MetricsRegistry` dataclass に全 6 instrument（`requests_total` / `request_duration` / `jobs_total` / `active_jobs` / `jobs_duration` / `progress_dropped_total`）をインスタンスフィールドとして束ねる。各 instrument は自前の `CollectorRegistry` に登録される。`record_job_terminal(job_type, status, duration)` はメソッド化。
  2. `server.py` (`create_app`) で `metrics = MetricsRegistry()` を 1 度だけ構築し、`app.state.metrics` に bind。`JobStore(jobs_dir, metrics=metrics)` と `ProgressBroadcaster(metrics=metrics)` にも注入。middleware は closure 経由で同じ `metrics` を参照。
  3. `api/deps.py` に `get_metrics(connection: HTTPConnection) -> MetricsRegistry` factory を追加。
  4. `api/metrics_api.py` は `Depends(get_metrics)` で受け取り `generate_latest(registry.registry)` を返す。
  5. `JobStore.record_job_terminal(job_type, status, duration)` は bound registry へのデリゲーション。`metrics=None` (subprocess child 経路) の場合は no-op。gauge 更新も `_set_active_gauge(value)` helper 経由。
  6. `_training_core.py` / `training_retune.py` / `api/workspace.py` の 8+ 箇所の `record_job_terminal(...)` 呼び出しを `job_store.record_job_terminal(...)` に置換。
  7. `ws/progress.py`: `ProgressBroadcaster(metrics=None)` + `self._record_drop()` メソッド化、`_enqueue` は `self` を使うため `@staticmethod` を外す。module-level lazy `_record_drop` helper 削除。
  8. `tests/test_metrics_registry.py` を新規追加。A-9 の acceptance core（2 app が同プロセスで共存、それぞれ独立した registry を持つ）を 5 test で validate。
  9. 既存テスト（`tests/test_metrics_api.py`、`tests/regression/test_reg_0151_*`、`tests/regression/test_reg_0154_*`）を `client.app.state.metrics` 経由に書き換え。
- **Impact:** `src/lizystudio/metrics.py`（module-level globals → dataclass、-30 / +90 行）、`src/lizystudio/server.py`（+6）、`src/lizystudio/api/deps.py`（+15）、`src/lizystudio/api/metrics_api.py`（Depends 化 +7）、`src/lizystudio/services/jobs.py`（+40: `metrics` 引数・`_set_active_gauge` helper・`record_job_terminal` delegation）、`src/lizystudio/services/_training_core.py`（+5 置換）、`src/lizystudio/services/training_retune.py`（+2 置換）、`src/lizystudio/api/workspace.py`（import 削除・4 箇所置換）、`src/lizystudio/ws/progress.py`（`metrics` 引数・`_record_drop` メソッド化・`@staticmethod` 削除）、テスト 4 ファイル更新 + 1 新規。
- **Compatibility:**
  - Prometheus scrape 出力（メトリクス名・labels・buckets）は bit-identical。
  - wire format / BackendAdapter Protocol / storage layout 変更なし。
  - **破壊的変更**: `from lizystudio.metrics import record_job_terminal` / `JOBS_TOTAL` / `ACTIVE_JOBS` / `PROGRESS_DROPPED_TOTAL` の module-level export は削除。これらを直接 import する外部統合（監視プラグイン等）は破綻するが、LizyStudio は内部パッケージで外部公開していないため shim は提供しない。
  - Subprocess child (`subprocess_runner.py` の `JobStore(jobs_dir)`) は `metrics=None` を受け取り、`record_job_terminal` / `_set_active_gauge` が no-op になる。子プロセスの Prometheus 出力は親がスクレイプしないため機能的に同等。親プロセスは subprocess 終了後に `_emit_terminal_metric(job_store, job, duration)` で正しい registry に counter を bump する。
- **Alternatives:**
  - (a) Module-level globals を維持し conftest で `REGISTRY._names_to_collectors.clear()` する → 却下。prometheus_client の private attribute に依存する fragile な approach で、library の minor version 変更で壊れる。
  - (b) `record_job_terminal(metrics, ...)` を caller から全関数に引数で threading する → 却下。`JobStore` に delegation させる方が caller 改修量が少なく、既存の DI (`Depends(get_job_store)`) と揃う。
  - (c) Deprecation shim (`metrics.__getattr__` で module-level 名を現 app の state から引く) を残す → 却下。global singleton を暗黙的に復活させ A-9 の目的を半減させる。
- **Acceptance Criteria:**
  - (a) `tests/test_metrics_registry.py::test_two_apps_can_coexist_in_the_same_process` が green（2 app 同時起動で counter 独立）。
  - (b) Prometheus scrape 出力に 6 instrument すべての `# TYPE` / `# HELP` ヘッダが含まれる（`test_metrics_api.py::test_metrics_contains_all_declared_series`）。
  - (c) `active_jobs` が fresh app で 0 を返す（`test_active_jobs_gauge_starts_at_zero`）。
  - (d) Issue #151 の overflow drop counter が自前 `MetricsRegistry` で increment する（`test_reg_0151_progress_queue_bounded`）。
  - (e) Issue #154 の slot-claim failure で failed counter が 1 増える（`test_reg_0154_failed_metric_on_slot_claim`）。
  - (f) `uv run pytest` / `uv run mypy src/lizystudio/` / `uv run ruff check .` / `uv run ruff format --check .` 全 clean、pytest 1152 green。
- **Decision:** 2026-04-20 accepted — 提案通り実装。`record_job_terminal` の module-level export 廃止は破壊的変更だが、内部パッケージのため shim なしで移行。

### H-0076: `CV_STRATEGY_FIELDS` 退役と `capabilities.cv_strategy_fields` の SSOT 化（Phase 3 coupling refactor C-5b Part 2）
- **Status:** accepted
- **Scope:** Backend | Frontend | Internal only（LizyConfig wire format 不変、BackendAdapter Protocol 不変、既存 `/api/backends/ui-schema` レスポンス shape 不変）
- **Related:** docs/coupling-analysis.md C-5b、H-0026（UiSchema 契約）、H-0072（C-5a）、H-0074（C-5b Part 1）
- **Context:** Part 1 までに `METRICS_BY_TASK` と `getDefaultCvStrategy` は SSOT 化されたが、`frontend/src/components/workspace/constants.ts::CV_STRATEGY_FIELDS` は残っていた。この map は UI の CV-section conditional-field rendering と `cv-state.ts::buildSplitConfig` / `applyCvDataFields` の wire-format 生成を両方支配しており、backend の `UiCapabilities.cv_strategy_fields` と **フィールド名が乖離** していた（`folds` vs `n_splits`、`train_size_max` vs `max_train_size`、`blocked_group_kfold` は完全に別体系）。さらに **内容自体も乖離**（FE の `stratified_kfold` に `shuffle` がない、FE の `time_series` に `time_col` がある等）していたため、単純置換では SSOT 化できず Part 1 の対象外となっていた。
- **Proposal:**
  1. Backend `lizyml_ui_schema.py::cv_strategy_fields` を「UI 表示判定 + wire field 一覧」の両用途をカバーする SSOT に書き換える。フィールド名は **LizyConfig schema 名**（`n_splits`, `train_size_max`, `time_col`, `group_col`, `min_train_rows`, `min_valid_rows`）で統一。`blocked_group_kfold` の UI 用フィールドを追加（`n_splits`, `time_col`, `group_col`, `min_train_rows`, `min_valid_rows` — wire の `blocks_col`/`groups_col`/`mode`/`train_window` は UI が別編集 UI 経由で個別生成するため含まない）。
  2. 順序調整（`kfold: n_splits, random_state, shuffle` 等）を UI 上下表示順と一致させる。順序の意味は UI presentation のみで consumer は set 扱い（backend にコメント追加）。
  3. `tests/test_ui_schema.py` に新規テスト `test_capabilities_cv_strategy_fields_ui_semantics` を追加し、全 8 strategy の期待 fields を locking。wire-format キー（`max_train_size`, `max_test_size`, `folds`）が map に漏れないことも assert。
  4. Frontend `cv-state.ts`: `buildSplitConfig(cv, blocked?, fields?)` と `applyCvDataFields(data, cv, fields?)` の third arg として fields を受け取る。`fields` が未指定のときは module-level `FALLBACK_CV_STRATEGY_FIELDS`（backend SSOT のミラー）から strategy で引く。未知 strategy は `["n_splits"]` に fall through。
  5. `CvSection.tsx` は `uiSchema.capabilities?.cv_strategy_fields?.[strategy]` を優先読み、無ければ `FALLBACK_CV_STRATEGY_FIELDS` を使う。`has("folds")` → `has("n_splits")` にフィールド名を揃える。`FALLBACK_CV_STRATEGY_FIELDS` は `cv-state.ts` から re-export された単一ソースを使用（重複を避ける）。
  6. `useConfigSync` が `uiSchema` prop を受け取り、`cv_strategy_fields[strategy]` を `buildSplitConfig` / `applyCvDataFields` に threading。`useEffect` の dedup key に fields suffix を付与し、UiSchema ロード後の初回 sync を発火させる。`preseedSyncKey` も同じ suffix を内部で付ける。
  7. `frontend/src/components/workspace/constants.ts` から `CV_STRATEGY_FIELDS` export 削除。`constants.test.ts` の該当テストブロック削除。
- **Impact:** `src/lizystudio/backends/lizyml_ui_schema.py`（`cv_strategy_fields` rewrite + 順序ドキュメント、+12 / -18 行）、`tests/test_ui_schema.py`（+77、全 strategy lock-in テスト）、`frontend/src/components/workspace/constants.ts`（-23、`CV_STRATEGY_FIELDS` 削除）、`frontend/src/components/workspace/constants.test.ts`（-48、該当テスト削除）、`frontend/src/components/workspace/cv-state.ts`（+58 / -14：`FALLBACK_CV_STRATEGY_FIELDS` export + `resolveFields` helper + `buildSplitConfig`/`applyCvDataFields` に fields 引数）、`frontend/src/components/workspace/CvSection.tsx`（+8 / -3：uiSchema 優先読み + `FALLBACK_CV_STRATEGY_FIELDS` import、`has("folds")`→`has("n_splits")`）、`frontend/src/components/workspace/cv-section.test.ts`（+58 / -8：local SSOT fixture + fields arg test cases）、`frontend/src/hooks/useConfigSync.ts`（+25 / -3：`uiSchema` prop + fields threading + key suffix）。
- **Compatibility:**
  - `/api/backends/ui-schema` レスポンス shape 不変（`capabilities.cv_strategy_fields` は既存 field でその content のみ拡張）。OpenAPI 型変更なし。
  - LizyConfig schema（wire format）変更なし。`split.n_splits` / `split.train_size_max` / `data.time_col` / `data.group_col` 等は従来通り。
  - FE の UI state（`cv.folds`, `cv.trainSizeMax` など）は変更なし — UI internal name と wire name の mapping は `buildSplitConfig` 内に閉じる。
  - 既存のユーザー config file（JSON/YAML）は touch しない。
- **Alternatives:**
  - (a) Backend の `cv_strategy_fields` を UI 用 / wire 用に 2 つ分ける → 却下。2 つの契約を同期する deuplication コストが大きい。1 map で両用途をカバーする方が clean。
  - (b) FE の UI internal name（`folds`）を LizyConfig 名（`n_splits`）に全面 rename → 却下。既存の `CvState.folds`, `resetCvState`, etc. が全面変更となりスコープ肥大。UI 内部と wire format の命名は分離したままが自然。
  - (c) fallback map を削除して uiSchema ロード前の render を blocker 化 → 却下。初回 render の a11y / CLS を悪化させる。fallback が backend SSOT とミラーされる限り問題なし（lock-in test で drift 検知）。
  - (d) `cv-state.ts` / `CvSection.tsx` でそれぞれ独立に fallback 定義 → 却下。`cv-state.ts` から export して単一 source に統一。
- **Acceptance Criteria:**
  - (a) `grep -rn 'CV_STRATEGY_FIELDS' frontend/src` が local test fixture と `cv-state.ts::FALLBACK_CV_STRATEGY_FIELDS` 以外に残らない。
  - (b) `tests/test_ui_schema.py::test_capabilities_cv_strategy_fields_ui_semantics` が全 8 strategy を green で lock-in。
  - (c) `CvSection` が `uiSchema.capabilities.cv_strategy_fields` を受け取って conditional field render。uiSchema 未ロード時は `FALLBACK_CV_STRATEGY_FIELDS` 使用。
  - (d) `useConfigSync` が UiSchema ロード後に初回 sync を発火させる（key suffix 経由）。
  - (e) `pnpm test` / `pnpm check` / `pnpm tsc --noEmit` / `pnpm build` / `uv run pytest` / `uv run mypy src/lizystudio/` / `uv run ruff check .` 全 clean。
- **Decision:** 2026-04-21 accepted — 提案通り実装。C-5b 完結（Part 1 = METRICS_BY_TASK + cv_default_strategy、Part 2 = CV_STRATEGY_FIELDS SSOT 化）。

### H-0077: `useDataPanel` のオーケストレーション化と `useTargetSelection` 抽出（Phase 3 coupling refactor B-5）
- **Status:** accepted
- **Scope:** Frontend | Internal only（外部 API `useDataPanel({...})` の戻り値 shape 不変、wire format / BackendAdapter Protocol 不変）
- **Related:** docs/coupling-analysis.md B-5、H-0074（Part 1 で `resolveDefaultCvStrategy` 初導入）、H-0076（Part 2 で `buildSplitConfig` の fields SSOT 化）
- **Context:** `useDataPanel.ts` が 217 行・26 戻り値のハブ hook として肥大化し、`handleTargetChange` 単独で 60 行超（fetch columns + task 検出 + merged config 生成 + updateConfig PUT + queryClient cache seed + preseedSyncKey + Radix focus ワークアラウンド rAF blur まで全部）。B-5 の方針は「orchestration のみに削り、target 変更時ロジックは `useTargetSelection` mutation hook に分離」。
- **Proposal:**
  1. `frontend/src/hooks/useTargetSelection.ts` を新規作成し、`handleTargetChange` の実装をそのまま移植。依存は全て props 経由で受け取る（`task`, `cv`, `blocked`, `dataPath`, `uiSchema`, 5 setters, 2 configSync callbacks, `onDataChanged`, `onTaskChanged`）。
  2. `useDataPanel.ts` は state cells の宣言 + 兄弟 hooks の wiring + 軽量な `handleTaskChange` のみに残す。`useTargetSelection` を呼んで `{ handleTargetChange }` を受け取り、戻り値 map に含める（shape 完全互換）。
  3. `resolveDefaultCvStrategy` の duplication（`useTargetSelection` と `useDataPanel::handleTaskChange` で同一 3 行）を `cv-state.ts::getEffectiveCvStrategy(task, uiSchema)` として抽出・export、両 hook から import。
  4. 新規 `useTargetSelection.test.ts` を追加（3 test: suppress-flag bookends / error path toast / uiSchema precedence）。既存 `useDataPanel.test.ts` は touch なしで 14 test 継続 pass → 戻り値 shape 保全の回帰ガード。
  5. `requestAnimationFrame` による blur が test harness に leak しないよう `beforeEach` で `vi.stubGlobal("requestAnimationFrame", ...)` + `afterEach` で `vi.unstubAllGlobals()`。
  6. Vitest `vi.fn()` の generic type が TS 5.x build で narrow signature と不整合を起こすため、test-local な `Fn<[Args]>` helper を定義してビルド互換性を確保。
- **Impact:** `frontend/src/hooks/useDataPanel.ts`（217→143 行、-74）、`frontend/src/hooks/useTargetSelection.ts`（+156 行、新規）、`frontend/src/hooks/useTargetSelection.test.ts`（+189 行、新規）、`frontend/src/components/workspace/cv-state.ts`（`getEffectiveCvStrategy` export +15 行）。
- **Compatibility:**
  - `useDataPanel` 戻り値 shape bit-identical。consumer（`DataPanel.tsx`）無変更。
  - `handleTargetChange` の挙動・エラーパス・state mutation 順序は同一。既存 `useDataPanel.test.ts` 14 件 touch なしで pass。
  - wire format / BackendAdapter Protocol / storage layout / ユーザー設定ファイル無変更。
- **Alternatives:**
  - (a) `setState` + `callbacks` の facade サブオブジェクト化 → 却下。14 params の explicit list は DI として自己文書的で、facade 化は over-engineering。
  - (b) `handleTargetChange` を `useMutation` に置き換える → 却下。state-sync 順序（setSyncSuppressed(true) → setTarget → fetch → setColumns → ...）を TanStack Query の mutation lifecycle に落とし込むと読みづらくなる。useCallback のままで十分。
  - (c) `resolveDefaultCvStrategy` を各 hook に残す duplication 許容 → 却下。3 行 × 2 箇所は抽出する価値ありと reviewer 指摘で確認。
- **Acceptance Criteria:**
  - (a) `useDataPanel.ts` が 150 行未満（143 行達成）。
  - (b) `useDataPanel.test.ts` 14 件 touch なしで継続 green（external contract 保全）。
  - (c) `useTargetSelection.test.ts` 3 件 green、`suppress bookends` / `error toast` / `uiSchema precedence` を individual に検証可能に。
  - (d) `getEffectiveCvStrategy` が `cv-state.ts` に export され両 hook から共有。
  - (e) `pnpm test` / `pnpm check` / `pnpm tsc --noEmit` / `pnpm build` 全 clean、1620 vitest pass。
- **Decision:** 2026-04-21 accepted — 提案通り実装。reviewer MEDIUM（duplication 抽出、rAF leak 対策）修正済み。

### H-0078: semantic status token の導入と raw Tailwind color class 退役（Phase 3 coupling refactor B-9, Part 1）
- **Status:** accepted
- **Scope:** Frontend | Internal only（wire format / BackendAdapter Protocol / storage layout 不変、visual regression は Nightly で自動検知）
- **Related:** docs/coupling-analysis.md B-9、Issue #90（`--lzs-accent` WCAG 調整）、Issue #168（`bg-green-700` WCAG AA 要件）
- **Context:** `components/ui/design-tokens.css` は `--lzs-accent` 等の UI control token + `lzs-*` class を提供していたが、status 系（success / warning / danger / info / degraded）の semantic token は未定義。各 consumer が `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200` / `text-red-700 dark:text-red-400` 等の raw Tailwind palette class を直書きしており、dark mode 切り替えと WCAG コントラスト調整が 18 ファイルに散らばって drift していた。
- **Proposal:**
  1. `design-tokens.css` に 5 状態の semantic token を追加（success / warning / danger / info / degraded）。各状態は `bg / fg / border` triplet、加えて `success` のみ `solid-bg / solid-fg`（Jobs "completed" badge の濃緑 + 白テキスト用、#168 の WCAG AA 要件に合致する hsl 値）。dark mode は `.dark` scope で同時定義。値は既存 Tailwind palette 相当を HSL 近似し、WCAG AA コントラスト（4.5:1）を両テーマで維持。
  2. `tailwind.config.ts` の `theme.extend.colors` に `success` / `warning` / `danger` / `info` / `degraded` を追加。`DEFAULT` / `fg` / `border` の命名で `bg-success` / `text-success-fg` / `border-success-border` が使用可能に。
  3. 12 consumer ファイルの raw color class を semantic class に一括置換:
     - `jobs/`: JobList.tsx（status icon color）, JobDetail.tsx（Delete button + Completed badge）, DeleteDialog.tsx（cascade warning box）
     - `workspace/`: ResultsCompletedView.tsx, ResultsRunningView.tsx, ResultsPanel.tsx（Queued badge）, ConfigEditorBody.tsx（running info bar）, ConfigDiffBadge.tsx, TuneTrialsSection.tsx（best trial row）, FoldProgressList.tsx
     - `retune/`: ConvergenceSignalPanel.tsx, JobLineageTree.tsx, RoundHistoryTable.tsx, SearchSpaceEvolutionPanel.tsx
     - `inference/`: ScoreTable.tsx, SetupPanel.tsx, ResultsPredOnly.tsx, ResultsWithGT.tsx
  4. ScoreTable.test.tsx / RoundHistoryTable.test.tsx の className assertion を新 semantic class 名に更新。
  5. **Out of scope (palette-as-identity)**: `DistributionBar.tsx`（15 色 series palette）, `FoldPreview.tsx`（train/test 区別用 blue/orange 2 色 palette）, `SearchSpaceEvolutionPanel.tsx:190`（cutoff bar marker）は意味的な「状態」ではなく series 区別のための palette なので据え置き。
- **Impact:** `frontend/src/components/ui/design-tokens.css`（+40 行：semantic token triplet × 5 状態 × 2 テーマ）、`frontend/tailwind.config.ts`（+35 行：`theme.extend.colors` 拡張）、18 consumer files（各 1〜3 箇所 raw → semantic 置換、净 -40 行程度）、2 test files（class name assertion 更新）。
- **Compatibility:**
  - Visual はほぼ pixel-identical（HSL 近似が Tailwind palette の ±2 L% 内、意図的に #168 等の WCAG 調整は `--lzs-success-solid-bg` で保全）。Nightly visual regression が検知可能。
  - wire format / BackendAdapter Protocol / storage layout / ユーザー設定ファイル変更なし。
  - Consumer の TSX は public API / props / state 変更なし — className string のみ差し替え。
- **Alternatives:**
  - (a) Biome lint rule で raw color class を ban → 却下。Biome は Tailwind-specific plugin を持たない。代わりに Part 2（別 PR）で `scripts/check-raw-colors.sh` + CI integration を計画。
  - (b) `DistributionBar` palette も semantic 化 → 却下。15 色 series は意味的な状態ではなく区別用の identity palette で、semantic token の責務外。
  - (c) Tailwind v4 の `@theme` 構文で CSS-native 化 → 却下。現在 v3.4.19、アップグレードは別 PR。
  - (d) HSL 近似ではなく正確な Tailwind 色値をそのまま CSS var に書く → 却下。現 HSL 定義と一貫させるため近似で統一。
- **Acceptance Criteria:**
  - (a) `grep -rn '(bg|text|border)-(blue|green|red|yellow|amber|rose|emerald|orange)-[0-9]{2,3}' frontend/src/components` が palette scope-out 4 ファイル（DistributionBar, FoldPreview, SearchSpaceEvolutionPanel の cutoff bar, design-tokens.css の history comment）以外 0 件。
  - (b) 全 vitest pass（1620 件、既存 14 + 新規 3 も含む）。
  - (c) `pnpm check` / `pnpm tsc --noEmit` / `pnpm build` 全 clean。
  - (d) WCAG AA コントラスト（#168 の `bg-success-solid` + 白テキスト 4.5:1）が semantic token で維持。
- **Decision:** 2026-04-21 accepted — Part 1（token 整備 + 18 ファイル書き換え）のみ本 PR で実施。Part 2（raw color ban の CI/lint ガード）は別 PR で実装予定。

### H-0079: raw Tailwind color class の CI guard（B-9 Part 2）
- **Status:** accepted
- **Scope:** CI / Tooling | Internal only（src 変更は ResultsPanel の 1 箇所 cleanup のみ、wire format / Protocol / storage 不変）
- **Related:** H-0078 Part 1（semantic token 導入）、docs/coupling-analysis.md B-9 Part 2
- **Context:** H-0078 で `frontend/src/components/**` の raw Tailwind color class（`bg-green-100`, `text-red-600` 等）を semantic token に移行したが、Biome には Tailwind-aware な lint rule がなく、PR 中に再び raw class が入り込んでも自動検知できない。Part 1 の scope-out は `DistributionBar` / `FoldPreview` / `SearchSpaceEvolutionPanel` の 3 ファイル（palette-as-identity）だけが対象だったが、その後の調査で `JobList.tsx:194` の fit/tune badge（job-type identifier）と `JobDetail.tsx:386` の historical WCAG comment、`design-tokens.css` の token-to-Tailwind mapping comment も同様に identity/documentation 目的で残存していることが判明。`ResultsPanel.tsx:203` の `bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200` は shadcn `Badge variant="secondary"` のデフォルトと完全に重複していたため、Part 1 時点で漏れた取りこぼし。
- **Proposal:**
  1. `frontend/scripts/check-raw-colors.sh` を追加。`grep -rEHn` で `src/**` を走査し、`(bg|text|border|ring|fill|stroke|from|to|via)-(blue|green|red|...|stone)-[0-9]{2,3}` パターンを検出。allowlist 外で 1 件でも hit したら exit 1。
  2. allowlist は shell variable `ALLOWLIST_REGEX` に集約（`DistributionBar.tsx` / `FoldPreview.tsx` / `SearchSpaceEvolutionPanel.tsx` / `JobList.tsx` / `JobDetail.tsx` / `design-tokens.css` の 6 ファイル）。追加する際はスクリプト冒頭のコメントブロックで justification を明記するルールを導入。
  3. `.github/workflows/ci.yml` に `raw-color-guard` job を追加。checkout のみで pnpm/node セットアップは不要（純 bash + grep）。
  4. Part 1 の取りこぼし `ResultsPanel.tsx:203` を `<Badge variant="secondary">Cancelled</Badge>` に簡素化（`bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200` が secondary variant のデフォルト `bg-secondary text-secondary-foreground` と機能的に等価）。
- **Impact:** `frontend/scripts/check-raw-colors.sh`（新規 80 行）、`.github/workflows/ci.yml`（+14 行で 1 job 追加）、`frontend/src/components/workspace/ResultsPanel.tsx`（-6 行、visual は unchanged）。
- **Compatibility:** wire format / Protocol / storage 不変、ResultsPanel の cancelled badge は shadcn default と同じレンダリング結果になるため visual regression なし（既存の Nightly ゴールデンが検知可能）。
- **Alternatives:**
  - (a) `ripgrep` を使う → 却下。Ubuntu CI runner には標準で入っていないため `rg: command not found` が silent success になるリスクがあり（初回実装で実際に遭遇）、`grep -rE` に切り替え。
  - (b) Biome custom rule で実装 → 却下。Biome v2 は external custom rule を未サポート、Tailwind plugin も未提供。
  - (c) stylelint + `declaration-property-value-disallowed-list` → 却下。Biome に統一する方針（CLAUDE.md §3「ESLint / Prettier は使用禁止」）と矛盾し、依存を 1 つ増やすコストに見合わない。
  - (d) Part 1 で Acceptance Criterion に含めた grep 判定を CI jobs に埋め込む → 却下。shell script として切り出す方が allowlist 管理が読みやすく、ローカル `bash scripts/check-raw-colors.sh` で再現可能。
- **Acceptance Criteria:**
  - (a) clean tree で `bash scripts/check-raw-colors.sh` が exit 0 + `OK: no raw ...` を出力。
  - (b) 故意に `bg-blue-500` を任意ファイルに入れると exit 1 で違反行を表示（ローカルで確認済み）。
  - (c) `raw-color-guard` job が `.github/workflows/ci.yml` の PR blocking ジョブに組み込まれ、develop/main 向け PR で自動実行される。
  - (d) vitest 1620 pass / biome / tsc / pnpm build 全 clean（ResultsPanel 変更の regression 確認）。
- **Decision:** 2026-04-21 accepted — H-0078 の self-defending guard として実装。allowlist に JobList/JobDetail を追加した差分は Part 1 の scope-out 漏れとして扱い、新規の色使用ポリシー変更ではない。

### H-0080: openapi-fetch 導入で frontend の URL パス手書きを廃止する計画（Phase 3 coupling refactor C-6）
- **Status:** proposed (plan doc only — no code change in this PR)
- **Scope:** Frontend | Internal only（wire format / BackendAdapter Protocol / storage layout 不変、公開 API 契約不変）
- **Related:** docs/coupling-analysis.md C-6、docs/c6-openapi-fetch-plan.md（本 PR で新規作成）、H-0068（C-1 `response_model` 完全化）、H-0071（C-4 SSOT JobSummary/JobDetail）、H-0072（C-5a SSOT UiSchema）
- **Context:** C-6 は 2026-04-17 の coupling-analysis 時点で未着手として残っていた最大項目。現状 `frontend/src/api/{jobs,inference,workspace,files}.ts` の 46 call site が URL を文字列結合 + `apiFetch<T>(url)` の型パラメータを手書きで指定しており、`server.py:184-200` の prefix 変更や Pydantic `response_model` の変更が TS で検出されない。既に `openapi-typescript@^7.13.0` で `generated/schema.d.ts` を出力しており、`paths` / `operations` / `components` は完備しているので、`openapi-fetch`（同一作者・+4.7 KB gzipped）を採用すれば URL + request + response を 1 箇所の型から推論できる。46 call site と 51 consumer import に一括で手を入れると diff が肥大化するため Phase 分割する。
- **Proposal:**
  1. `docs/c6-openapi-fetch-plan.md` を作成し、採用技術比較（openapi-fetch / openapi-typescript-fetch / Zodios / ky / 手書き builder）、Phase 分割（0–5 の 6 PR）、ApiError middleware 方針、MSW handler typing、破綻リスクと緩和策、全 Phase 完了時 acceptance を集約。
  2. `docs/coupling-analysis.md` の C-6 entry に plan doc へのリンクと H-0080 参照を追記。
  3. 本 Proposal を HISTORY.md に記録し、Phase 1 以降の実装 PR で各 Phase 完了時に本 entry の **Decision** を更新していく。
  4. Phase 1 は `pnpm add openapi-fetch` + `apiClient` 併設 + `files.ts` (2 call site) のみ、最小スコープで migration pattern を確立。
- **Impact:** `docs/c6-openapi-fetch-plan.md`（+172 行の新規）、`docs/coupling-analysis.md` C-6 entry（+1 行）、本 HISTORY.md entry。コード変更・依存追加・wire format 変更は一切なし。
- **Compatibility:** ゼロ差分（docs のみ）。後続 Phase 1-5 の実装 PR は individual に review & rollback 可能、途中 state でも既存 `apiFetch` と新 `apiClient` が並行稼働するため機能停止なし。
- **Alternatives:**
  - (a) 1 PR で全 46 call site 一括置換 → 却下。diff ~1500+ 行で review 負担が大きく、問題発生時の bisect が困難。
  - (b) openapi-typescript-fetch（openapi-fetch の前身）→ 却下、メンテ停止。
  - (c) Zodios / oRPC / tRPC → 却下、FastAPI 生成 OpenAPI 経由では middleware が必要で依存増大、現 stack (React Query + openapi-typescript) との整合コストが型推論の利益を上回る。
  - (d) ky / axios ラッパー → 却下、path 型推論がないため URL 手書きは残る。C-6 の本質に効かない。
  - (e) 手書き URL builder 関数で型を付ける → 却下、`paths` interface と重複実装になり、generated 型の二重定義問題が発生。
  - (f) 実装を proposal 省略で直接開始 → 却下、bundle size / error middleware パターン / MSW typing / Phase 境界を事前合意しないと Phase 間で方針漂流しやすい。
- **Acceptance Criteria:**（本 Proposal PR）
  - (a) `docs/c6-openapi-fetch-plan.md` が reviewer から approach / Phase 分割 / risk 緩和について合意を得る。
  - (b) `docs/coupling-analysis.md` C-6 entry に plan doc link が入り、将来の調査者が H-0080 にたどり着ける。
  - (c) この PR はコード変更・依存追加・wire format 変更を含まず、CI は既存通り green。
- **Acceptance Criteria:**（全 Phase 完了時）
  - (a) `grep -rn 'apiFetch(' frontend/src/` が 0 件。
  - (b) `grep -rn "\`/[a-z]" frontend/src/api/*.ts` がゼロ（URL 直書き消滅）。
  - (c) Bundle size 増加 +5 KB 以内（gzip）。
  - (d) 既存 CI gate（`api-types-drift`, `raw-color-guard`, `e2e-chromium`, `frontend`, `backend`）全 green を維持。
- **Decision:**
  - 2026-04-21 **Phase 0 accepted** — plan doc (`docs/c6-openapi-fetch-plan.md`) を merge (PR #223)。
  - 2026-04-22 **Phase 1 accepted** — `pnpm add openapi-fetch@^0.17.0` で依存追加（gzip +2.47 KB、uncompressed +7.59 KB で +5 KB gate クリア）。`client.ts` に `apiClient` を併設（`apiFetch` は Phase 5 まで保持）、`throwOnErrorMiddleware` で non-2xx を `ApiError` へ変換、既存 51 consumer の catch 形状を保全。`files.ts` の `fetchDirectory` を `apiClient.GET("/api/files", ...)` に migrate、型は generated `components["schemas"]["DirectoryListing"]` を SSOT として re-export（手書き `FileEntry` / `DirectoryListing` 除去）。**重要な発見:** generated `schema.d.ts` の `paths` interface は `/api/*` prefix 込みの key を持つため `openapi-fetch` の `baseUrl` は空文字固定 (plan doc §4 の例示は `baseUrl: "/api"` としていたが実装時に訂正、本コミットで plan doc の該当箇所を修正)。テスト戦略は `vi.mock("./client")` から MSW 経由の integration style に切替、migration 前後で同一 wire 挙動を確認。1627 vitest pass / 2 skipped、biome / tsc / pnpm build / raw-color-guard 全 clean。
  - 2026-04-22 **Phase 2 accepted** — `inference.ts` 10 call site を全て `apiClient` に migration（`runInference`, `uploadInferenceData`, `fetchInferenceHistory`, `fetchInferenceRecord`, `fetchInferencePredictions`, `fetchInferenceMetrics`, `fetchInferencePlot`, `fetchInferenceShapPlot`, `fetchInferenceComparison`）。`getInferenceDownloadUrl` は pure URL builder として apiClient 不使用のまま保持（anchor href 用、response を受け取らない）。`fetchInferenceShapPlot` は `fetchInferencePlot` を呼ぶ thin wrapper に変更し、`/api/inference/{inf_id}/plot/{plot_type}` path を 1 箇所に集約。`uploadInferenceData` では `bodySerializer: (body) => body as unknown as BodyInit` で FormData を pass-through（browser に multipart boundary 生成を任せる）。SSOT 化: `InferenceRecord` → `components["schemas"]["InferenceRecordResponse"]`、`PredictionsResponse` → generated 同名 schema へ re-export。**ComparisonStats は hand-written のまま据え置き:** backend の `ComparisonGroupStats` schema は構造体 `{mean, std, min, max, count}` + `extra='allow'` だが frontend consumer (`ResultsPredOnly.tsx`) は `Object.keys(current).filter(k => k !== "count")` で動的 key 走査 (`Record<string, number>` 前提) — この乖離解消は C-7 系の別タスク、本 Phase 2 のスコープ外。副次修正: `ResultsPredOnly.test.tsx` / `ResultsWithGT.test.tsx` の fixture で `source_type: "file"` を使っていた 3 箇所を `"upload"` に訂正（generated schema は `"path" | "upload"` narrow、hand-written では `string` だったため既存テストが false-positive pass していた）。Bundle delta from Phase 1: gzip **+0.25 KB**（累計 Phase 0→2: +2.72 KB、budget +5 KB 余裕）。1627 vitest pass / 2 skipped、biome / tsc / pnpm build / raw-color-guard 全 clean。
  - 2026-04-22 **Phase 3 accepted** — `workspace.ts` 16 call site を全て `apiClient` に migration（`loadDataFromPath`, `uploadData`, `fetchPreview`, `fetchColumns`, `fetchColumnStats`, `fetchSplitPreview`, `fetchConfigSchema`, `fetchConfigDefaults`, `fetchConfig`, `updateConfig`, `validateConfig`, `uploadConfig`, `runFit`, `runTune`, `fetchBackends`, `fetchUiSchema`）。`getConfigDownloadUrl` は pure URL builder として apiClient 不使用のまま保持。FormData upload 2 箇所（`uploadData` / `uploadConfig`）に Phase 2 で確立した `bodySerializer: (body) => body as unknown as BodyInit` pattern を再利用、browser に multipart boundary 生成を任せる。AbortSignal 伝播 2 箇所（`fetchConfig` / `updateConfig`）は openapi-fetch の第 2 引数 option `signal` をそのまま渡すだけで機能することを MSW pre-aborted signal テスト 2 件で検証。types.ts の hybrid re-export は不変（`BackendInfo` / `PreviewResponse` / `SplitPreviewResponse` / `ColumnsResponse` / `UiSchema` は既に generated、`DataRef` / `WorkspaceStatus` / `ColumnStatsResponse` / `ConfigUpdateResponse` / `ConfigError` は narrow 保持のため hand-written のまま）。副次作業: `error-handling.test.ts` の workspace block 10 件が `vi.mock("./client")` の `apiFetch` mock に依存していたため MSW 400 response に書き換え（jobs block は Phase 4 まで vi.mock を維持）。`vi.mock("./client")` は `importOriginal` spread に変更し、`apiFetch` のみを mock 化して `apiClient` / `ApiError` の実体は残す。Bundle delta from Phase 2: gzip **-0.04 KB**（minification variance、累計 Phase 0→3: **+2.68 KB**、+5 KB budget 大幅余裕）。1630 vitest pass / 2 skipped（+3 from Phase 2: workspace.test.ts 21 → parity 維持、error-handling 10 rewritten、同数）、biome / tsc / pnpm build / raw-color-guard 全 clean。
  - 2026-04-22 **Phase 4 accepted** — `jobs.ts` 17 call site を全て `apiClient` に migration（`fetchJobs`, `fetchJob`, `fetchJobImportance`, `fetchJobImportanceKinds`, `fetchJobLearningCurveMetrics`, `fetchJobPlot`, `fetchJobPlots`, `fetchJobSplitSummary`, `fetchJobLog`, `cancelJob`, `deleteJob`, `retuneJob`, `resumeJob`, `fetchJobLineage`, `exportJob`）。**Trailing slash:** `fetchJobs` は `apiClient.GET("/api/jobs/", ...)`（schema key に合わせる、従来 `apiFetch("/jobs")` と異なる wire shape になる — migration 前の MSW parity baseline がこれで一時的に red になったが、migration 後は schema key と一致して green）。**Multi-query:** `fetchJobPlot` の `metrics: string | string[]` は `,` join した単一 string に正規化してから `query.metrics` に渡し、backend の generated spec (`metrics?: string | null`) に適合。`kind` も同様に optional query。**DELETE with query:** `deleteJob` は `apiClient.DELETE("/api/jobs/{job_id}", { params: { path, query: { cascade } } })` で cascade フラグを透過。**Typed POST bodies:** `retuneJob` / `resumeJob` / `exportJob` は生成された `RetuneRequest` / `ResumeRequest` / `ExportRequest` schema に body が自動適合。hand-written response types (`RetuneResponse`, `LineageNode`) は保持 — backend 側に response_model が未定義（`{[key: string]: string | unknown}` としか typed されない）。副次作業: `error-handling.test.ts` の jobs block 10 件を Phase 3 の workspace block と同じ MSW 400 pattern に書き換え、同時に `vi.mock("./client")` と `apiFetch` import を完全削除（fetcher layer の全 4 module が `apiClient` に移行したため mock が不要）。**Phase 5 への準備完了**: `grep -rn 'apiFetch(' frontend/src/api/{files,inference,workspace,jobs}.ts` が 0 件、残存は `client.ts` の実装と `client.test.ts` の 8 apiFetch tests のみ。Bundle delta from Phase 3: gzip **-0.09 KB**（minification variance、累計 Phase 0→4: **+2.59 KB**、+5 KB budget 余裕）。1630 vitest pass / 2 skipped（同数維持、jobs.test.ts 23 + error-handling jobs 10 を書き換え）、biome / tsc / pnpm build / raw-color-guard 全 clean。
  - 2026-04-22 **Phase 5 accepted (C-6 complete)** — `apiFetch` 関数と `BASE_URL` 定数を `frontend/src/api/client.ts` から完全削除。ファイルは `apiClient` + `ApiError` + `throwOnErrorMiddleware` のみ残る構成に縮約、docstring を追加。`client.test.ts` の 8 件の `apiFetch` describe block を削除し、`apiClient` block に non-JSON error body (`ApiError.body` が `null` になる保証) と network-error path の 2 件を追加して edge case coverage を維持（13 → 7 tests、net -6）。再発防止に `frontend/scripts/check-no-apifetch.sh` (grep-based) と `.github/workflows/ci.yml` に `no-apifetch-guard` job を追加。guard は `apiFetch\s*[<(]` と `(import\|export)...\bapiFetch\b` の両方を検出、コメント内の historical 言及は match しないので docs/test 説明コメントと共存可能。ローカルで clean tree pass + 故意違反 exit 1 を両方確認済み。**MSW handlers 型強化** (plan §5 予定作業): `frontend/src/test/mocks/handlers.ts` の 3 handler response を `HttpResponse.json<components["schemas"]["..."]>` で明示的に型付け。**drift 発見**: `/api/workspace/status` handler の fixture に backend schema 必須の `has_result: boolean` が欠落していたため追加（backend response とのズレが Phase 5 で初めて顕在化、型強化の効果そのもの）。Bundle delta from Phase 4: **変化なし**（`apiFetch` は未使用コードとして tree shaking で既に削除済みだった、source cleanup は source 上のみ影響。build hash も Phase 4 と同一 `index-CnR1UQjY.js`）。累計 Phase 0→5: **+2.59 KB gzip**、+5 KB budget 大幅余裕。1624 vitest pass / 2 skipped（Phase 4 比 -6、client.test.ts の apiFetch block 退役分）、biome / tsc / pnpm build / raw-color-guard / no-apifetch-guard 全 clean。**全 Acceptance Criteria 達成:** (a) `grep -rn 'apiFetch(' frontend/src/` = 0 件 ✅ (`apiFetch` export 自体が client.ts に存在しない)、(b) `frontend/src/api/*.ts` の URL 直書き消滅 ✅ (fetcher は全て `apiClient.GET/POST/PUT/DELETE` で path を typed 引数として受ける)、(c) bundle +2.59 KB gzip ≤ +5 KB budget ✅、(d) 既存 CI gate（`api-types-drift`, `raw-color-guard`, `e2e-chromium`, `frontend`, `backend`）+ 新 `no-apifetch-guard` 全 green ✅。

### H-0081: JSON 保存物への `format_version` 導入（Phase 3 coupling refactor C-9 Proposal）
- **Status:** proposed (docs-only; implementation PR に続く)
- **Scope:** Backend / Storage | **change-gate 対象** (storage format / compatibility に直接影響)
- **Related:** docs/coupling-analysis.md C-9、既存の `backends/lizyml/pickle_compat.py:PICKLE_SCHEMA_VERSION`（backend 固有、本 Proposal の対象外で保持）、H-0068（checkpoint mixin での `model_meta.json` 検証ロジック）
- **Context:** 現状 `frontend/src/api/generated/schema.d.ts` が示す public API 契約は C-1/C-4/C-5 で整備済みだが、**on-disk の JSON 保存物**は version field を持たない。具体的に以下 5 種類の JSON が version なしでシリアライズされており、将来「`config` の key を rename する」「`fit_result.metrics` の構造を変える」「`InferenceRecord.data_ref` の shape を変える」等の破壊的変更をしたい場合、旧 workspace を読み込むと silent に壊れる（fallback 値が入ってしまう / `dataclass(**meta)` が missing/extra key で crash する）:
  1. `{jobs_dir}/{job_id}/meta.json` — Job レコード（`job_id`, `status`, `backend_name`, `config`（dict 埋込）, `data_ref`, `job_type`, `created_at`, `completed_at`, `model_path`, `error`, `parent_job_id`）。`services/jobs.py:696` で書込、`:711` で読込。
  2. `{jobs_dir}/{job_id}/fit_result.json` / `tune_result.json` — `FitSummary` / `TuningSummary` の `asdict`。`services/jobs.py` で `FitSummary(**d)` / `TuningSummary(**d)` として復元。
  3. `{jobs_dir}/{job_id}/inferences/{inf_id}/meta.json` — `InferenceRecord` の `asdict`。`services/inference.py:68` で書込、`:84` で読込。`data_ref.shape` が tuple → list → tuple と手で変換されている既知の脆弱ポイント。
  4. `{jobs_dir}/{job_id}/inferences/{inf_id}/metrics.json` — 評価指標 dict（現在 backend-dependent な key set）。
  5. `{jobs_dir}/{job_id}/model_meta.json` — checkpoint sidecar。**既に `pickle_schema: PICKLE_SCHEMA_VERSION = 1` を持つ**が、これは backend 固有（lizyml の cloudpickle 互換チェック用）で、`lizyml_version` / `lightgbm_version` / `optuna_version` / `saved_at` も含む。Studio 共通の `format_version` とは別系統として継続保持する。
- **Proposal:**
  1. **Studio 共通定数を導入**: `src/lizystudio/storage/versions.py`（新規 ~40 行）に `STUDIO_FORMAT_VERSION: int = 1` を定義。各保存物ごとの定数は作らず単一の Studio 全体 version に統一する（ファイル別 version は YAGNI、定数の数が増えるだけで意思決定の粒度が変わらない）。
  2. **writer 側**: 上記 1–4 の書込箇所（`services/jobs.py` の `_write_meta` と fit/tune result writer、`services/inference.py:save` の meta + metrics）で `{"format_version": STUDIO_FORMAT_VERSION, ...existing_fields}` の順で埋め込む。5 の `model_meta.json` は touch しない（別ドメイン）。
  3. **reader 側**: `storage/versions.py` に `read_versioned_json(path: Path) -> tuple[int, dict]` helper を置く。戻り値は `(detected_version, migrated_data)`。ロジック:
     - `format_version` キーが存在しない → **v0 とみなす**（既存 workspace は全て v0 として扱われる、後方互換維持）。
     - `format_version` が既知範囲（現時点では 1 のみ）→ そのまま返す。
     - `format_version` が未知（例えば v2 で書いた workspace を v1 runtime で開く）→ `IncompatibleFormatVersionError` を raise（新規 exception、`backends/exceptions.py` と同じレイヤに置く）。
  4. **migration pipeline skeleton**: `storage/migrations.py`（新規）に `MIGRATIONS: dict[int, Callable[[dict], dict]] = {0: _migrate_v0_to_v1, 1: _identity}` を置き、`_migrate_v0_to_v1 = lambda d: d` （現時点では v0 と v1 の structure は同一なので no-op）。将来 structure を変える際は:
     - まず new writer を v2 に bump
     - `_migrate_v1_to_v2` を pure function で書く
     - reader が自動的に chain 適用
     の 3 ステップで進める。**migration chain は pure function として unit test 可能**という invariant を最初から確立する。
  5. **deprecation 計画**: v0 (無版本) の自動 migration サポートは **3 minor release 継続**。その後 明示的な `IncompatibleFormatVersionError` に切り替え、ユーザーに「CLI migration tool を実行してください」というエラーメッセージを出す方針（tool 自体は deprecation 前に別 PR で提供する）。3 release は LizyStudio の現リリースサイクル（月 1 回程度を想定）で約 3 ヶ月の猶予、既存ユーザーが自然に update できる期間として妥当。
- **Impact:**
  - 新規: `src/lizystudio/storage/versions.py`（~40 行）、`src/lizystudio/storage/migrations.py`（~30 行）、`src/lizystudio/backends/exceptions.py` に `IncompatibleFormatVersionError` 追加（~5 行）。
  - 修正: `services/jobs.py`（writer/reader 各 1 箇所）、`services/inference.py`（writer/reader 各 1 箇所）、FitSummary/TuningSummary 読込箇所。
  - 追加テスト: `tests/test_storage_versions.py`（v0 backward compat / v1 roundtrip / unknown version rejection、各 3 件、合計 ~9 cases）。
  - wire format（REST API response）: 変更なし（JSON 永続化層のみ、`response_model` は不変）。
  - `BackendAdapter` Protocol: 変更なし。
  - `model_meta.json` の `pickle_schema`: 触らない（backend 固有、H-0068 の契約を保持）。
- **Compatibility:**
  - **既存 v0 workspace は全て読める**: reader が `format_version` 欠落を v0 と判定、`_migrate_v0_to_v1` (no-op) を通して v1 として処理。ユーザーには透過。
  - **新 writer が書いた v1 workspace は古い runtime では読めない**: 旧 runtime は `format_version` キーを無視する（extra key として drop）ので、**偶発的に読めてしまう可能性がある**。これは forward-compat の制約で、C-9 の本 Proposal では後方互換のみを保証する（forward は structure が変わった時点で断線する）。
  - 初回実装では structure を変更しないので、v1 書込 workspace を v0 として旧 runtime で読むことも（現時点は）possible。以後 v2 で structure を変えた時点で旧 runtime は明確に壊れる。
- **Alternatives considered:**
  - (a) **中央集権型 (A案)** vs **ファイル別 version (B案)**: B案を却下。ファイル別定数（`JOB_META_VERSION`, `INFERENCE_META_VERSION` 等）は意思決定の粒度が変わらず、ただ数が増えるだけで管理コスト増。採用の C案（ハイブリッド）は「Studio 共通 version + backend 固有 `pickle_schema` は別レイヤ」で最小の抽象。
  - (b) **現状維持**: 却下。C-9 の根本問題は「将来の破壊的変更が silent に壊れる」こと。version フィールドがない限り自動 migration を安全に設計できない。
  - (c) **schema library 導入**（pydantic の discriminated union 等）: 却下。Studio の内部永続化で外部ライブラリに lock-in する価値は低く、pydantic はすでに API layer で使っている。dict ベースの simple migration chain で十分。
  - (d) **v0 を即 drop**: 却下。既存ユーザーの workspace が一斉に読めなくなる。deprecation 期間なしは運用上受け入れられない。
  - (e) **一度に全 5 種類を version bump**: 採用。ファイル単位で段階的に入れると migration chain のテストが複雑化する（`meta.json` だけ v1、`inference/meta.json` は v0、等）。同じ Studio runtime で書き込むなら同じ version にする方が invariant が明快。
- **Acceptance Criteria（実装 PR 完了時）:**
  - (a) 新規 writer 経由の全 JSON 保存物（meta.json / fit_result.json / tune_result.json / inference/meta.json / inference/metrics.json）に `format_version: 1` が埋まる。
  - (b) 既存 v0 workspace（fixture で 1 つ用意）が reader 経由で loss なく load できる（既存の読込テスト全 pass）。
  - (c) 未知 `format_version`（例: 99）の JSON を読ませると `IncompatibleFormatVersionError` が raise される（明示的 error、silent なフォールバックではない）。
  - (d) `_migrate_v0_to_v1` が pure function で、unit test で direct call 可能。
  - (e) 既存 pytest 全 pass（1153+）、ruff / ruff format / mypy / biome / tsc / pnpm build / raw-color-guard / no-apifetch-guard 全 clean。
  - (f) `model_meta.json` の `pickle_schema` は touch せず、H-0068 の checkpoint 検証ロジックは回帰しない。
- **Decision:**
  - 2026-04-22 **Proposed** — Proposal のみ PR #229 で merge、実装は後続 PR。着手前に reviewer 合意を得るためのゲート entry。
  - 2026-04-22 **Implemented** — `src/lizystudio/storage/` パッケージを新規作成（`__init__.py` / `versions.py` / `migrations.py`）、`STUDIO_FORMAT_VERSION = 1` + `write_versioned_json` / `read_versioned_json` helper + `MIGRATIONS` chain + `migrate_to_current`。`backends/exceptions.py` に `IncompatibleFormatVersionError` 追加。`services/jobs.py` の `_write_json` / `_read_json` helper を versioned I/O に委譲（`_save_meta` と `update(fit_result / tune_result)` が全て自動で version 埋込）。`services/inference.py` の `save` (meta.json 書込) と `_load_record` (meta.json 読込) を versioned helper に置換。`format_version` は JSON の**先頭 key** として埋込（grep / head 友好的）。**Scope 調整** (Proposal §5 からの乖離): `inferences/{inf_id}/metrics.json` のみ **versioned 化から除外**。理由は backend-dependent な flat `{mae: 0.3, rmse: 0.5, ...}` 構造で、先頭 key 埋込は将来 `format_version` という metric と衝突、envelope 化は frontend の `fetchInferenceMetrics: Promise<Record<string, unknown>>` 契約を破壊するため。代わりに writer 箇所に NOTE コメントで revisit 条件（metrics.json が backend で Pydantic `response_model` を持った時）を明記。これにより対象は 4 種類に縮減 (meta.json / fit_result.json / tune_result.json / inference/meta.json)。Acceptance Criteria 達成状況: (a) 4 種類の writer 全てで `format_version: 1` 埋込 ✅（metrics.json は scope 外として明示）、(b) `tests/regression/test_reg_0081_v0_workspace_backward_compat.py` で pre-C-9 workspace が `JobStore.get` / `InferenceStore.get` から load できることを確認 ✅、(c) `format_version: 99` 等 unknown を読ませると `IncompatibleFormatVersionError` が raise される (`tests/test_storage_versions.py::test_unknown_version_raises_incompatible_error`) ✅、(d) `_migrate_v0_to_v1` は pure function で direct 呼び出し test 済 ✅、(e) 1164 pytest pass / ruff / ruff format / mypy / biome / tsc / pnpm build / raw-color-guard / no-apifetch-guard 全 clean ✅、(f) `model_meta.json` の `pickle_schema` は触らず H-0068 checkpoint 検証ロジック回帰なし ✅。

### H-0082: Versioned JSON writer の atomic-write 保証（C-9 follow-up、Issue #232 / #239）
- **Status:** proposed
- **Scope:** Backend / Storage | **change-gate 対象** (write contract の invariant 追加、INV-level)
- **Related:** H-0081 (C-9 / `write_versioned_json` / `read_versioned_json` 導入)、Issue #232（non-atomic `_write_json` race）、Issue #239（migration chain gap 未テスト）、CLAUDE.md `rules/common/invariants-first.md`
- **Context:** H-0081 で導入した `write_versioned_json` は `path.write_text(text)` を直接使っている。これは POSIX では open-truncate-write の 3 ステップであり **atomic ではない**。concurrent reader が writer の truncate 直後に `path.read_text()` を呼ぶと空 / 部分バイトを掴み、`json.loads` が `JSONDecodeError` を raise する。実測: 2000 writer round × 8 reader で 14,152 件の `JSONDecodeError`（約 11% の reader が corruption を観測）。既存 `tests/test_job_state_transitions.py::TestConcurrentOperations::test_status_update_atomicity` は `PytestUnhandledThreadExceptionWarning` という形でこの race の発生を既に記録しているが、warning 止まりで assertion にはなっていない。本番では WS + polling の 2 系統で reader が常時走っているため、**random に job load が失敗するが retry で隠れている**状態と推定される。併せて Issue #239: `storage/migrations.py:66-71` の "No migration registered" RuntimeError パスが未到達（coverage 89%）。将来 `STUDIO_FORMAT_VERSION` を 2 に bump した際に `MIGRATIONS[1]` を書き忘れる回帰を CI で検出できない。H-0081 Acceptance Criteria (f) の補強として必要。
- **Invariants:**
  - INV-1: `write_versioned_json(path, payload)` 完了後、concurrent reader は**旧 payload 全体**か**新 payload 全体**のいずれかのみを観測する。部分バイト / 空ファイル状態を観測しない。
  - INV-2: `migrate_to_current(data, from_version=N)` は `MIGRATIONS[N]` が存在しない場合、必ず `RuntimeError` を明示的に raise する（silent pass-through しない）。
- **Proposal:**
  1. **write_versioned_json を atomic 化**: `path.with_suffix(path.suffix + ".tmp")` に書いてから `os.replace(tmp, path)` で rename。POSIX と Windows の両方で rename は atomic。tmp ファイルは同一ディレクトリに置く（`os.replace` が cross-device でない保証）。suffix collision 対策として `os.getpid()` 等は入れない（writer はモジュール外からは単一 caller、pid 混在は起こらない）。
  2. **INV-1 を docstring と test で明示**: "A reader observes either the prior payload or the new payload; never a partial byte sequence."
  3. **Issue #239 対応の gap test 追加**: `tests/test_storage_versions.py::test_migrate_to_current_raises_when_chain_has_gap` — `monkeypatch` で `STUDIO_FORMAT_VERSION=3` にし、`MIGRATIONS={0: identity}` のまま `migrate_to_current({}, from_version=0)` → `RuntimeError` が "No migration registered for version 1" を含むメッセージで raise。
- **Impact:**
  - 修正: `src/lizystudio/storage/versions.py` の `write_versioned_json` 内 ~4 行（tmp path + `os.replace`）。
  - 追加テスト: `tests/test_storage_versions.py` に 2 件（`test_write_versioned_json_is_atomic_under_concurrent_readers` + `test_migrate_to_current_raises_when_chain_has_gap`）。
  - wire format / API 契約 / migration chain 定義: 不変。
  - 既存 1164 tests の挙動変化: `test_status_update_atomicity` の `PytestUnhandledThreadExceptionWarning` 消失のみ（assertion は既に green）。
- **Compatibility:**
  - 既存 on-disk ファイルへの影響なし（読み書きのエンコーディング / 構造は不変）。
  - tmp ファイルがクラッシュで残る可能性: 理論上あるが、`os.replace` は atomic で rename 前の tmp はパス違いなので reader は拾わない。次回 writer 呼出時に同名 tmp を上書きするだけ（cleanup は best-effort、data loss にはならない）。
  - `Path.write_text` → `Path.with_suffix + os.replace` への置換は caller API 不変。
- **Alternatives considered:**
  - (a) **`fcntl.flock` による reader/writer mutex**: 却下。Windows 非対応、`lizystudio` は cross-platform で動く必要がある（PyPI 配布）。
  - (b) **directory-level lock (filelock 外部依存)**: 却下。H-0081 の "dict ベース simple migration chain で十分" 原則と逆行、依存追加は overkill。
  - (c) **`os.replace` による atomic rename** (採用): 標準ライブラリのみで完結、POSIX + Windows 対応、パフォーマンス影響なし（1 回の write_text が 1 回の write + 1 回の rename に変わるだけ）。
  - (d) **double-write + checksum verify**: 却下。reader が JSONDecodeError を catch して retry する案は C-9 の "silent fallback を避ける" 原則に反する。
- **Acceptance Criteria:**
  - (a) `write_versioned_json` が tmp path + `os.replace` 経由で書き込む。
  - (b) 新テスト `test_write_versioned_json_is_atomic_under_concurrent_readers`: writer×1 + reader×4 が 500 round 並走して `JSONDecodeError` 0 件、読み取り payload は旧 payload か新 payload のみ（partial state なし）を assert。
  - (c) 既存 `test_status_update_atomicity` の `PytestUnhandledThreadExceptionWarning` が消える。
  - (d) 新テスト `test_migrate_to_current_raises_when_chain_has_gap` が pass、`storage/migrations.py` coverage が 100% に到達。
  - (e) 既存 1164 + 2 新規 test 全 pass、ruff / ruff format / mypy / biome / tsc / pnpm build 全 clean。
  - (f) tmp ファイル残留がテスト実行後に存在しない（`os.replace` が成功時に消す、explicit cleanup は不要）。
- **Decision:**
  - 2026-04-22 **Proposed & Implemented** — 本 PR で Proposal + 実装 + 2 件の test を同時 merge。change-gate 最小構成として HISTORY 追記を伴う。
