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
