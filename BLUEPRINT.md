## 0. ステータスとスコープ

### スコープ内
- ML ワークフロー（Config→学習→評価→推論→管理）のWeb GUI
- Workspace: 1画面でデータ設定→モデル設定→Fit→結果確認を反復
- Jobs: 全ジョブのライフサイクル管理・結果閲覧・Export
- Inference: 学習済みモデルで新データを分析
- ジョブのディスク永続化（サーバー再起動後も保持）
- 複数 ML バックエンドのアダプター対応（初期は LizyML）

### スコープ外
- ML 本体のロジック（LizyStudio は GUI のみ。各バックエンドライブラリに委譲）
- マルチユーザー・認証・権限管理
- リモートサーバーでのジョブ実行
- ジョブ間の比較機能（初期リリース後に検討）
- モバイル対応

---

## 1. 目的

ML分析ワークフロー（Config編集→学習→評価→推論→管理）を、コードを書かずにブラウザから操作できる GUI を提供する。
`pip install lizystudio && lizystudio` でローカルサーバーが起動し、ブラウザで全操作が完結する。

初期バックエンドは LizyML だが、アダプター層により他の ML ライブラリにも拡張可能な設計とする。

---

## 2. 設計原則

| # | 原則 | 説明 |
|---|------|------|
| 1 | **バックエンドに忠実** | GUI独自のMLロジックを持たない。バックエンドライブラリの公開APIをそのまま呼び出す |
| 2 | **責務分離** | フロントエンド（表示・操作）→ API（HTTP境界）→ Service → Adapter（バックエンド呼び出し）の4層 |
| 3 | **型安全** | Pydantic Schema → OpenAPI → TypeScript型の自動連携チェーンを維持する |
| 4 | **シングルユーザー** | ローカル実行を前提とし、セッション管理は単一インメモリ状態で十分とする |
| 5 | **バックエンドの仕様が正** | ML機能の仕様（Config schema, Result 型等）は各バックエンドライブラリが正。LizyStudio側で再定義しない |
| 6 | **バックエンド非依存** | API・フロントエンドはバックエンド固有の型・概念に直接依存しない。Adapter層で抽象化する |

---

## 3. アーキテクチャ

### 3.1 全体構成

```
┌──────────────┐     HTTP/WS      ┌──────────────────────────────┐
│   Browser    │ ◄──────────────► │       FastAPI Server          │
│  React SPA   │   localhost:8501  │                              │
│ (shadcn/ui)  │                  │  api/      ← Router           │
│              │                  │  services/ ← Session & 調整    │
│              │                  │  backends/ ← Adapter 層        │
│              │                  │  ws/       ← Progress          │
└──────────────┘                  └──────┬───────────────────────┘
                                         │ Python import
                                  ┌──────┴───────────────────────┐
                                  │      BackendAdapter          │
                                  │  (Protocol / 抽象インターフェース)  │
                                  ├──────────────┬───────────────┤
                                  │ LizyML       │  Future       │
                                  │ Adapter      │  Adapters     │
                                  └──────────────┴───────────────┘
```

### 3.2 レイヤー責務

| レイヤー | 場所 | 責務 | 禁止事項 |
|---------|------|------|---------|
| **Page** | `frontend/src/pages/` | 画面レイアウト、ルーティング | API直接呼び出し（api/ 経由にする） |
| **Component** | `frontend/src/components/` | 再利用可能なUI部品 | ビジネスロジック |
| **API Client** | `frontend/src/api/` | HTTP通信、型付きリクエスト/レスポンス | 状態管理 |
| **Router** | `src/lizystudio/api/` | リクエスト検証、レスポンス整形 | バックエンドライブラリの直接呼び出し |
| **Service** | `src/lizystudio/services/` | セッション状態管理、Adapter呼び出しの調整 | HTTP/WebSocket の知識、バックエンド固有の型 |
| **Adapter** | `src/lizystudio/backends/` | バックエンドライブラリの呼び出し、共通型への変換 | HTTP/セッション状態の知識 |
| **WebSocket** | `src/lizystudio/ws/` | リアルタイム進捗配信 | ビジネスロジック |

### 3.3 Backend Adapter 設計

バックエンドライブラリとの接続を抽象化するアダプター層を設ける。

#### 3.3.1 共通型（バックエンド非依存）

Service 層と API 層は以下の共通型のみを扱う。バックエンド固有の型（LizyML の `FitResult` 等）は Adapter 内部に閉じる。

```python
# src/lizystudio/backends/types.py

@dataclass
class BackendInfo:
    """バックエンド識別情報。"""
    name: str                          # "lizyml", "veldraml", ...
    version: str                       # バックエンドのバージョン

@dataclass
class ConfigSchema:
    """Config の JSON Schema。フォーム生成用。"""
    json_schema: dict[str, Any]        # JSON Schema形式

@dataclass
class FitSummary:
    """学習結果のサマリー。"""
    metrics: dict[str, Any]            # メトリクス (構造はバックエンド依存、dictで渡す)
    fold_count: int                    # fold数
    params: list[dict[str, Any]]       # パラメータテーブル (行のリスト)

@dataclass
class TuningSummary:
    """チューニング結果のサマリー。"""
    best_params: dict[str, Any]
    best_score: float
    trials: list[dict[str, Any]]       # trial history (行のリスト)
    metric_name: str                   # 最適化対象メトリクス名 (H-0013)
    direction: str                     # "minimize" | "maximize" (H-0013)

@dataclass
class PredictionSummary:
    """推論結果のサマリー。"""
    predictions: pd.DataFrame          # 予測結果テーブル
    warnings: list[str]                # 警告メッセージ

@dataclass
class PlotData:
    """Plotly 図のJSON表現。"""
    plotly_json: str                   # fig.to_json() の結果
```

#### 3.3.2 BackendAdapter Protocol

```python
# src/lizystudio/backends/base.py

class BackendAdapter(Protocol):
    """ML バックエンドとのインターフェース。"""

    @property
    def info(self) -> BackendInfo: ...

    # --- Config ---
    def get_config_schema(self) -> ConfigSchema: ...
    def get_default_config(self, task: str, target: str) -> dict: ...  # 完全なデフォルト Config (H-0025)
    def validate_config(self, config: dict) -> list[dict]: ...  # エラー一覧 (空=valid)
    def load_config_from_file(self, content: bytes, filename: str) -> dict: ...

    # --- Model lifecycle ---
    def create_model(self, config: dict, dataframe: pd.DataFrame) -> Any: ...  # 内部モデルオブジェクト
    def fit(self, model: Any, *, params: dict | None = None, on_progress: Callable | None = None) -> FitSummary: ...  # params: H-0012
    def tune(self, model: Any, *, on_progress: Callable | None = None) -> TuningSummary: ...
    def predict(self, model: Any, data: pd.DataFrame, *, return_shap: bool = False) -> PredictionSummary: ...  # return_shap: H-0012

    # --- Evaluation ---
    def evaluate_table(self, model: Any) -> list[dict]: ...
    def split_summary(self, model: Any) -> list[dict]: ...
    def importance(self, model: Any, kind: str) -> dict[str, float]: ...
    def confusion_matrix(self, model: Any, threshold: float) -> dict[str, Any]: ...
    def plot(self, model: Any, plot_type: str) -> PlotData: ...
    def available_plots(self, model: Any) -> list[str]: ...

    # --- Persistence ---
    def export_model(self, model: Any, path: str) -> str: ...  # 保存先パス
    def load_model(self, path: str) -> Any: ...
    def model_info(self, model: Any) -> dict[str, Any]: ...
```

#### 3.3.3 Adapter 登録

```python
# src/lizystudio/backends/registry.py

# バックエンド名 → Adapter のマッピング
# 初期状態では LizyML のみ。新バックエンドは Adapter 実装 + 登録で追加。
```

起動時のバックエンド選択:
- デフォルトは `lizyml`
- CLI オプション `lizystudio --backend lizyml` で明示指定可能
- 将来的に画面上でバックエンド切り替え UI を追加する余地を残す

### 3.4 状態管理

状態は**揮発（Workspace）**と**永続（Jobs）**の2層に分かれる。

#### 3.4.1 Workspace 状態（揮発・インメモリ）

ブラウザセッション中のみ有効。ブラウザを閉じるとリセットされる。

| 状態 | 型 | ライフサイクル |
|------|-----|--------------|
| `backend` | `BackendAdapter` | サーバー起動時に決定 |
| `workspace_config` | `dict \| None` | Config設定時に生成 |
| `workspace_data` | `DataRef \| None` | データ指定時に生成 |
| `workspace_result` | `Job \| None` | 現セッション中の直近fit結果のみ |

- `workspace_result` は現セッション中にWorkspaceからfitした場合のみセットされる
- ブラウザ再アクセス時は `workspace_result = None`（右パネル空）
- 過去のJob結果は表示しない（混乱防止）

#### 3.4.2 Job 状態（永続・ディスク）

全fit/tuneの実行はJobとして登録・ディスク保存される。

| 状態 | 型 | 説明 |
|------|-----|------|
| `job_id` | `str` | 一意識別子 |
| `status` | `pending \| running \| completed \| failed` | ジョブの実行状態 |
| `backend_name` | `str` | 使用バックエンド名 |
| `config` | `dict` | 使用Config |
| `data_ref` | `DataRef` | データ参照（パス + フィンガープリント） |
| `job_type` | `fit \| tune` | ジョブ種別 |
| `created_at` | `datetime` | 作成日時 |
| `completed_at` | `datetime \| None` | 完了日時 |
| `fit_result` | `FitSummary \| None` | Fit 実行結果。Tune Job の場合は Best Params での自動 fit 結果 |
| `tune_result` | `TuningSummary \| None` | Tune 実行結果（Fit Job の場合は `None`） |
| `model_path` | `Path \| None` | 学習済みモデルの保存パス |
| `error` | `str \| None` | エラーメッセージ（失敗時） |

#### 3.4.3 DataRef（データ参照）

```python
@dataclass
class DataRef:
    """データの参照情報。データ自体はコピーしない。"""
    source_type: Literal["path", "upload"]
    path: str                          # ローカルパス or アップロード先の一時パス
    filename: str                      # 元のファイル名
    fingerprint: str                   # データのハッシュ（再現性追跡用）
    shape: tuple[int, int]             # (行数, 列数)
```

- `source_type="path"`: ユーザーがローカルパスを指定した場合
- `source_type="upload"`: ブラウザからアップロードした場合（サーバーの一時ディレクトリに保存）

#### 3.4.4 Job 保存場所

```
{jobs_dir}/
├── job_001/
│   ├── meta.json              # job_id, status, config, data_ref, timestamps
│   ├── model/                 # BackendAdapter.export_model() の出力
│   ├── fit_result.json         # FitSummary のシリアライズ（Fit/Tune 共通）
│   └── tune_result.json        # TuningSummary のシリアライズ（Tune Job のみ）
├── job_002/
│   └── ...
└── ...
```

- デフォルト: `.lizystudio/jobs/`（カレントディレクトリ相対）
- CLI オプション `lizystudio --jobs-dir /path/to/jobs` で変更可能
- 設定ファイルでも指定可能

#### 3.4.5 Inference 履歴（永続・ディスク）

推論結果は実行元の Job ディレクトリ配下に永続化される。

| 状態 | 型 | 説明 |
|------|-----|------|
| `inf_id` | `str` | 推論の一意識別子 |
| `job_id` | `str` | 使用した Job の ID |
| `data_ref` | `DataRef` | 推論データの参照 |
| `has_ground_truth` | `bool` | 正解ラベルの有無 |
| `created_at` | `datetime` | 実行日時 |
| `row_count` | `int` | 予測データの行数 |

**保存場所:**

```
{jobs_dir}/{job_id}/inferences/
├── inf_001/
│   ├── meta.json              # inf_id, job_id, data_ref, has_ground_truth, created_at, row_count
│   ├── predictions.parquet    # 予測結果テーブル
│   └── metrics.json           # 評価メトリクス（正解あり時のみ）
├── inf_002/
│   └── ...
└── ...
```

---

## 4. 画面仕様

### 4.1 ナビゲーション構成

3画面構成。サイドバー + メインコンテンツ。

```
┌──────────┬──────────────────────────────────────┐
│          │                                      │
│ Sidebar  │         Main Content Area             │
│ (220px)  │                                      │
│          │                                      │
│ Workspace│                                      │
│ Jobs     │                                      │
│ Inference│                                      │
│          │                                      │
└──────────┴──────────────────────────────────────┘
```

| 画面 | パス | 役割 | 状態の寿命 |
|------|------|------|-----------|
| **Workspace** | `/` | インタラクティブなモデル構築・試行 | セッション限り（揮発） |
| **Jobs** | `/jobs` | ジョブの管理・結果閲覧・Export | ディスク保存（永続） |
| **Inference** | `/inference` | 学習済みモデルで新データを分析 | 操作単位 |

**画面間の導線:**

```
Workspace ── fit ──► Job作成 ──► Jobs一覧に反映
                                   │
                            Job選択 ├── 結果閲覧
                                   ├── Export
                                   └── Inference ▸ へ遷移
```

### 4.2 Workspace (`/`)

**目的:** データ設定→モデル設定→Fit→結果確認を1画面で反復する。

**3パネルレイアウト:**

```
┌───────────────────┬────────────────┬──────────────────────────┐
│  Data Panel (左)   │ Model Panel(中)│  Results Panel (右)       │
│                   │                │                          │
│  [Data Source]     │ Backend:lizyml │  (fit完了後に表示)         │
│  /data/train.csv  │                │                          │
│  1000行 × 20列     │ Model          │  [Metrics] [Plots]       │
│                   │ name: lgbm     │  ┌──────────────────┐    │
│  [Target / Task]   │ lr: 0.1        │  │                  │    │
│  target / Binary  │ num_leaves: 31 │  │  メトリクス表 /    │    │
│                   │                │  │  プロット         │    │
│  [Column Settings] │ [Edit Config]  │  └──────────────────┘    │
│  Features:15 Exc:3│                │                          │
│                   │ [Fit]          │                          │
│  [CV] SKFold k=5  │                │                          │
└───────────────────┴────────────────┴──────────────────────────┘
```

#### 4.2.1 Data Panel（左パネル）

データ読み込みから特徴量定義・CV設定までを段階的に設定する。各セクションは Accordion 形式で折りたたみ可能。

```
┌────────────────────────────────┐
│ ▸ Data Source                   │
│   ● Path  ○ Upload             │
│   [/data/train.csv        ][📁]│
│   1000行 × 20列                │
│                                │
│ ▸ Target / Task                │
│   Target [target           ▼]  │
│   Task   [Binary ▼] ⚡auto     │
│                                │
│ ▸ Column Settings              │
│   ┌────────┬─────┬─────┬─────┐│
│   │Column  │Uniq │Excl │Type ││
│   ├────────┼─────┼─────┼─────┤│
│   │id      │1000 │ ☑   │──[ID]│
│   │const1  │1    │ ☑   │──[C] │
│   │gender  │2    │ ☐   │Cat ▼ │
│   │city    │15   │ ☐   │Cat ▼ │
│   │age     │50   │ ☐   │Num ▼ │
│   │income  │980  │ ☐   │Num ▼ │
│   └────────┴─────┴─────┴─────┘│
│                                │
│ ▸ Cross Validation             │
│   [Stratified KFold ▼] [5]fold │
│                                │
│ ── Features: 15列 ──           │
│ 数値: 10  カテゴリ: 5           │
│ 除外: 3 (ID:1, Const:1, 手動:1)│
└────────────────────────────────┘
```

##### Data Source

| 要素 | 説明 |
|------|------|
| データソース選択 | ローカルパス入力 or ブラウザアップロードの Radio 切替 |
| パス入力 | テキスト入力 + Browse ボタン（サーバー側のファイル一覧） |
| アップロード | CSV/Parquet のドラッグ&ドロップまたはファイル選択 |
| プレビュー | データの形状（行数×列数）。展開で先頭数行表示 |

##### Target / Task

| 要素 | 動作 |
|------|------|
| Target | 全カラムのドロップダウン。ユーザーが必須選択 |
| Task | Target 選択時に自動判定。ドロップダウンで変更可能 |

Target を選択すると Column Settings / Cross Validation が自動設定される。

##### Column Settings

Target 以外の全カラムを単一テーブルで表示する。

| 列 | 説明 |
|-----|------|
| Column | カラム名 |
| Uniq | ユニーク数 |
| Excl | 除外チェックボックス。ON で特徴量から除外 |
| Type | Excl OFF 時: Numeric / Categorical のドロップダウン。Excl ON 時: グレーアウト |
| バッジ | 自動除外理由 `[ID]` `[Const]` を表示（手動除外にはバッジなし） |

**自動設定（Target 選択時に一括実行）:**

| 条件 | 設定 |
|------|------|
| ユニーク数 = 行数 | Excl ON + `[ID]` バッジ |
| ユニーク数 = 1 | Excl ON + `[Const]` バッジ |
| dtype が object / string / category / bool | Type = Categorical |
| dtype が数値 かつ ユニーク数 ≤ `max(20, 行数 × 0.05)` | Type = Categorical |
| 上記以外 | Type = Numeric |

ユーザーは自動設定後に任意のカラムの Excl / Type を変更できる。

##### Cross Validation

**Strategy セレクタ（Segment buttons, 折返し可）:**

LizyML の全 8 split method を `capabilities.cv_strategies` から動的表示する。

| Strategy | 表示名 | 説明 |
|----------|--------|------|
| `kfold` | KFold | ランダム分割 |
| `stratified_kfold` | StratifiedKFold | 層化分割（classification デフォルト） |
| `group_kfold` | GroupKFold | グループ境界分割 |
| `stratified_group_kfold` | StratifiedGroup | 層化 + グループ |
| `time_series` | TimeSeriesSplit | 時系列分割 |
| `purged_time_series` | PurgedTimeSeries | 時系列 + パージ + エンバーゴ |
| `group_time_series` | GroupTimeSeries | グループ時系列 |
| `blocked_group_kfold` | BlockedGroup | 期間ブロック × グループ |

Task に応じたデフォルト: binary / multiclass → `stratified_kfold`、regression → `kfold`。

**条件付きフィールド（Strategy に応じて動的表示）:**

| フィールド | 対象 Strategy | コンポーネント | デフォルト |
|-----------|-------------|-------------|----------|
| Folds | 全 Strategy | NumberInput（stepper） | 5 |
| Random State | kfold, stratified_kfold, stratified_group_kfold | NumberInput | 42 |
| Shuffle | kfold | Switch | true |
| Group Column | group_kfold, stratified_group_kfold, group_time_series, blocked_group_kfold | Select（非除外カラム） | null |
| Time Column | time_series, purged_time_series, group_time_series, blocked_group_kfold | Select（非除外カラム） | null |
| Gap | time_series, group_time_series | NumberInput | 0 |
| Purge Gap | purged_time_series | NumberInput | 0 |
| Embargo | purged_time_series | NumberInput | 0 |
| Train Size Max | time_series, purged_time_series, group_time_series | NumberInput（nullable） | null |
| Test Size Max | time_series, purged_time_series, group_time_series | NumberInput（nullable） | null |
| Blocks (col/cutoffs/mode/train_window) | blocked_group_kfold | 専用サブフォーム | null |
| Groups (col/n_splits/stratify/shuffle) | blocked_group_kfold | 専用サブフォーム | null |
| Min Train Rows | blocked_group_kfold | NumberInput（nullable） | null |
| Min Valid Rows | blocked_group_kfold | NumberInput（nullable） | null |

##### Feature Summary

常時表示。Data Panel の設定結果をリアルタイム反映する。

```
特徴量: N列 (数値: X, カテゴリ: Y)
除外: M列 (ID: a, Const: b, 手動: c)
```

##### Task 自動判定ルール（LizyStudio 側で定義）

| 目的変数の条件 | 判定 |
|--------------|------|
| ユニーク数 = 2 | binary |
| dtype が object / category かつ ユニーク数 > 2 | multiclass |
| dtype が数値 かつ ユニーク数 ≤ `max(20, 行数 × 0.05)` | multiclass |
| dtype が数値 かつ ユニーク数 > 上記閾値 | regression |

##### Data Panel → Config 自動反映

Data Panel の設定は Config の `data` / `features` / `split` セクションに自動マッピングされる。

| Data Panel | Config フィールド |
|------------|-----------------|
| Data Source パス | `data.path` |
| Target | `data.target` |
| Task | `data.task` |
| Column Settings (Type=Categorical, Excl OFF) | `features.categorical` |
| Column Settings (Excl=ON) | `features.exclude` |
| CV Strategy | `split.method` |
| CV Folds | `split.n_splits` |
| CV Group column | `data.group_col` |
| CV Time column | `data.time_col` |
| CV Random State | `split.random_state` |
| CV Shuffle | `split.shuffle` |
| CV Gap | `split.gap` |
| CV Purge Gap | `split.purge_gap` |
| CV Embargo | `split.embargo` |
| CV Train Size Max | `split.train_size_max` |
| CV Test Size Max | `split.test_size_max` |
| CV Blocks | `split.blocks` |
| CV Groups | `split.groups` |
| CV Min Train/Valid Rows | `split.min_train_rows`, `split.min_valid_rows` |

##### トリガーフロー

```
Data Load ──► カラム一覧取得、Preview 表示
    │
Target 選択 ──► Task 自動判定
              ├► Column Settings 自動設定 (Excl + Type)
              ├► CV デフォルト設定 (Task に応じた Strategy)
              └► Feature Summary 更新
    │
以降すべて即時編集可能（確認ステップなし）
```

#### 4.2.2 Model Panel（中央パネル）

モデル設定・学習実行を行う。**Fit タブ**と **Tune タブ**でワークフローを完全に分離する。
Fit タブと Tune タブは**同一の Config オブジェクト**を操作するが、Config 内の担当セクションが異なる。

**Config と UI セクションの対応:**

| Config パス | 担当 | 説明 |
|-------------|------|------|
| `task` | Data Panel | Data Panel の Target/Task で決定。Model Panel は読み取り専用で参照 |
| `data.*` | Data Panel | パス・ターゲット等 |
| `features.*` | Data Panel | カラム設定 |
| `split.*` | Data Panel | CV 設定 |
| `model.*` | Fit タブ Model セクション | モデル選択 + ハイパーパラメータ |
| `training.*` | Fit タブ Training セクション | Early stopping 等 |
| `evaluation.*` | Fit タブ Evaluation セクション | メトリクス選択 |
| `calibration` | Fit タブ Calibration セクション | binary 時のみ。`null` = 無効 |
| `tuning.optuna.params.*` | Tune タブ Settings セクション | n_trials, direction, timeout |
| `tuning.optuna.space` | Tune タブ Search Space セクション | パラメータ探索範囲 |

##### パネルヘッダー（sticky）

タブ切替とアクションボタンを同一行に配置し、パネル上部に sticky 固定する。スクロール位置に関係なくボタンが常に操作可能。

```
┌──────────────────────────────────┐
│ ┌─────┬───────┐    [━━ Fit ━━]  │
│ │▶Fit │ Tune  │  lizyml v0.x.x  │ ← sticky header
│ └─────┴───────┘                  │
└──────────────────────────────────┘
```

| 要素 | コンポーネント | 説明 |
|------|-------------|------|
| タブ | shadcn Tabs | Fit / Tune を切替。ボタンラベルはアクティブタブに連動 |
| 実行ボタン | Button (primary) | Fit タブ → `Fit`、Tune タブ → `Tune` |
| Backend バッジ | Badge (secondary) | `/api/backends` から取得。`lizyml v{version}` |

##### Fit タブ

指定したハイパーパラメータで学習を実行するワークフロー。Accordion セクションで構成。

```
┌──────────────────────────────────┐
│ ┌─────┬───────┐    [━━ Fit ━━]  │
│ │▶Fit │ Tune  │  lizyml v0.x.x  │ ← sticky
│ └─────┴───────┘                  │
│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ ▸ Model               ← config.model │
│   name   [lgbm             ▼]   │ ← discriminator
│   ── Smart Params ──             │
│   auto_num_leaves     [ON ]     │
│   num_leaves_ratio    [1.0  ]   │ ← auto=ON時のみ
│   min_data_in_leaf_ratio [0.01] │
│   min_data_in_bin_ratio  [0.01] │
│   feature_weights     [OFF]     │ ← Toggle → Multi-row editor
│   balanced            [Auto ✓]  │ ← nullable Toggle
│   ── Model Params ──             │
│   objective  [binary|cross_entropy] │ ← Segment buttons
│   metric     ☑auc ☑binary_logloss │ ← Chip buttons
│   n_estimators        [1000 ]   │
│   learning_rate       [0.1  ]   │
│   max_depth           [-1   ]   │
│   ...                            │
│   ── Additional Params ──        │
│   [param_select ▼]  [value] [×] │ ← カタログ選択
│   [＋ Add]                       │
│                                  │
│ ▸ Training             ← config.training │
│   seed                [42   ]   │
│   ▸ Early Stopping              │
│     enabled           [ON ]     │
│     rounds            [150  ]   │
│     validation_ratio  [0.1  ]   │
│     inner_valid [holdout    ▼]  │ ← enabled=ON時のみ
│                                  │
│ ▸ Evaluation           ← config.evaluation │
│   ☑ AUC  ☑ LogLoss              │ ← ui_schema.option_sets.metric から
│   ☐ Accuracy  ☐ F1              │
│                                  │
│ ▸ Calibration          ← config.calibration │
│   [ON|OFF]                      │ ← binary 時のみ表示
│   method [platt           ▼]   │ ← ui_schema.calibration_methods から
│   n_splits            [5    ]   │ ← ※非推奨注記
│                                  │
│ [Import YAML] [Export YAML]      │
│ [Raw Config]                     │
└──────────────────────────────────┘
```

**Model セクション（config.model）— Widget 準拠の3サブグループ構成（H-0030）:**

LizyML の Config Schema は `model` を `oneOf` + discriminator (`model.name`) で定義する。現在 `lgbm`（LGBMConfig）のみ。

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| モデル選択 | Select | `model.name` | `oneOf` の discriminator 値から選択肢を生成。現在は `lgbm` のみ |

Model セクション内を3つのサブグループに Separator で視覚分離する:

**── Smart Params ──**（スキーマフィールド、`model.*` 直下）

JSON Schema から動的生成する LGBMConfig 固有フィールド。

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| auto_num_leaves | Switch | `model.auto_num_leaves` | ON: 自動計算、OFF: 手動 |
| num_leaves_ratio | NumberInput (float) | `model.num_leaves_ratio` | `auto_num_leaves=true` 時のみ表示（conditional_visibility） |
| num_leaves | NumberInput (int) | `model.params.num_leaves` | `auto_num_leaves=false` 時のみ表示 |
| min_data_in_leaf_ratio | NumberInput (float, nullable) | `model.min_data_in_leaf_ratio` | nullable → Auto chip パターン |
| min_data_in_bin_ratio | NumberInput (float, nullable) | `model.min_data_in_bin_ratio` | nullable → Auto chip パターン |
| feature_weights | Toggle + Multi-row editor | `model.feature_weights` | OFF=null。ON: column dropdown + weight stepper の行追加 |
| balanced | Toggle (nullable) | `model.balanced` | OFF=null（Auto）、ON=true |

**Feature Weights Editor（feature_weights Toggle=ON 時）:**

| 要素 | コンポーネント | 説明 |
|------|-------------|------|
| 行 | column Select + NumberInput (weight, default=1.0) + × 削除ボタン | 非除外カラムから選択 |
| 追加ボタン | `[+ Add]` | 新規行を追加。weight > 0 を強制 |

**── Model Params ──**（`model.params` の既知パラメータ、`ui_schema.parameter_hints` から）

`parameter_hints` のうち `kind` に応じたコンポーネントで描画する:

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| objective | Segment buttons（task 別） | `model.params.objective` | `ui_schema.option_sets.objective[task]` から選択肢生成 |
| metric | Chip buttons（multi-select） | `model.params.metric` | `ui_schema.option_sets.model_metric[task]` から選択肢生成 |
| n_estimators | NumberInput (int, step=100) | `model.params.n_estimators` | |
| learning_rate | NumberInput (float, step=0.001) | `model.params.learning_rate` | |
| max_depth | NumberInput (int, step=1) | `model.params.max_depth` | |
| max_bin | NumberInput (int, step=1) | `model.params.max_bin` | |
| feature_fraction | NumberInput (float, step=0.05) | `model.params.feature_fraction` | |
| bagging_fraction | NumberInput (float, step=0.05) | `model.params.bagging_fraction` | |
| bagging_freq | NumberInput (int, step=1) | `model.params.bagging_freq` | |
| lambda_l1 | NumberInput (float, step=0.0001) | `model.params.lambda_l1` | |
| lambda_l2 | NumberInput (float, step=0.0001) | `model.params.lambda_l2` | |
| first_metric_only | Switch | `model.params.first_metric_only` | |

step 値は `ui_schema.step_map` から取得。値が未設定の場合は placeholder にデフォルト値を表示。空の params は `model.params` に含めない。

**── Additional Params ──**（`ui_schema.additional_params` カタログからの選択）

| 要素 | コンポーネント | 説明 |
|------|-------------|------|
| パラメータ選択 | Select（ドロップダウン） | `ui_schema.additional_params` リストから未使用のパラメータを選択 |
| 値入力 | NumberInput / TextInput | step は `step_map` から。型は `parameter_hints` がある場合はそこから判定 |
| 削除 | × ボタン | 行を削除 |
| 追加 | `[+ Add]` ボタン | 新規行を追加 |

> 注: Model Params と Additional Params の境界は `parameter_hints` に定義されているか否か。`parameter_hints` にあるパラメータは Model Params に常時表示、それ以外は Additional Params でオンデマンド追加。

モデル変更時は全ハイパーパラメータがデフォルト値にリセットされる。

**Training セクション（config.training）:**

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| seed | NumberInput（integer） | `training.seed` | ランダムシード。デフォルト 42 |
| Early Stopping | Accordion（入れ子） | `training.early_stopping` | 以下のフィールドを含む |
| → enabled | Switch | `training.early_stopping.enabled` | ON/OFF |
| → rounds | NumberInput（integer） | `training.early_stopping.rounds` | デフォルト 150。enabled=true 時のみ編集可能 |
| → validation_ratio | NumberInput（float, 0.0–1.0） | `training.early_stopping.validation_ratio` | デフォルト 0.1。enabled=true 時のみ編集可能 |
| → inner_valid | Select | `training.early_stopping.inner_valid.method` | enabled=true 時のみ表示。選択肢: `ui_schema.inner_valid_options`（holdout / group_holdout / time_holdout）。null の場合は Backend デフォルト |

**Evaluation セクション（config.evaluation）:**

`evaluation.metrics` は `string[]` 型。選択肢は `ui_schema.option_sets.metric[task]` から動的取得する（フロントエンドにハードコードしない）。

| 要素 | コンポーネント | 説明 |
|------|-------------|------|
| メトリクス | Chip グループ（Toggle） | `ui_schema.option_sets.metric[task]` から選択肢を生成。Task 変更時にデフォルト選択にリセット。クリックで ON/OFF |

Data Panel で Task が変更されたとき、`evaluation.metrics` をそのタスクのデフォルト値にリセットする。空選択の場合は Backend のランタイムデフォルトが使用される。

**Calibration セクション（config.calibration）:**

| 条件 | 表示 |
|------|------|
| Task ≠ binary | セクション非表示 |
| Task = binary かつ calibration = null | セクション表示、トグル OFF、フォーム非表示 |
| Task = binary かつ calibration ≠ null | セクション表示、トグル ON、フォーム表示 |

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| 有効/無効 | Switch | `calibration` | OFF → `calibration = null`、ON → `calibration = {method: "platt", params: {}}`（`ui_schema.defaults.calibration` から初期値） |
| method | Select | `calibration.method` | `ui_schema.calibration_methods` から選択肢生成（platt / isotonic / beta）。デフォルト `platt` |
| n_splits | NumberInput（integer） | `calibration.n_splits` | デフォルト 5。※LizyML v0.2.0 以降では非推奨（outer CV splits を再利用するため無視される）。UI に注記を表示 |

**Fit ボタン有効条件:**

| 条件 | チェック方法 |
|------|------------|
| Data Panel 完了 | `workspace/status` の `has_data = true` |
| Config 設定済み | `model.name` が選択されている |
| Config 検証通過 | `/api/workspace/config/validate` のエラーが 0 件 |
| 実行中でない | `running = false` |

##### Tune タブ

ハイパーパラメータの探索空間を定義し、最適なパラメータを自動探索するワークフロー。全操作がマウスで完結するよう設計する。

Fit タブと Tune タブは**同一の Config オブジェクト**の異なるセクションを編集する。Tune タブは `tuning` セクションを担当し、`model` / `training` は Fit タブの値を共有する。

```
┌──────────────────────────────────┐
│ ┌─────┬───────┐    [━━ Tune ━━] │
│ │ Fit │▶Tune  │  lizyml v0.x.x  │ ← sticky
│ └─────┴───────┘                  │
│┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│
│ ▸ Settings      ← config.tuning.optuna.params │
│   n_trials  [50 ▼] [100] [200] [カスタム]    │
│   timeout   [None ▼] [300] [600] [カスタム]  │
│                                  │
│ ▸ Search Space  ← config.tuning.optuna.space │
│   ── Model Params ──             │ ← group 分け
│   ┌────────────────┬────────┬──────────┐    │
│   │ Param          │ Mode   │ Summary  │    │
│   ├────────────────┼────────┼──────────┤    │
│   │ objective      │Fixed ▼ │ binary   │    │
│   │▸learning_rate  │Range ▼ │ .01~.3   │    │
│   │  min:[.01] max:[.3] dist:[Log ▼]  │    │
│   │ ...            │        │          │    │
│   ── Smart Params ──                    │
│   │▸num_leaves_ratio│Range ▼│ 0.5~2.0 │    │
│   │ ...            │        │          │    │
│   ── Training ──                        │
│   │ seed           │Fixed ▼ │ 42       │    │
│   │▸early_stop.rounds│Range▼│ 50~300  │    │
│   └────────────────┴────────┴──────────┘    │
│   [＋ Add ▼]                     │ ← additional_params から追加
│                                  │
│ ▸ Evaluation     ← config.tuning.evaluation │
│   Optimization Metric            │
│   [auc] [logloss] [f1]          │ ← Segment(single)
│   Additional Metrics             │
│   ☑ logloss  ☐ accuracy         │ ← Chip(multi)
│                                  │
│ [Import YAML] [Export YAML]      │
│ [Raw Config]                     │
└──────────────────────────────────┘
```

**Settings セクション（config.tuning.optuna.params）:**

| 要素 | コンポーネント | Config パス | 選択肢 | デフォルト |
|------|-------------|------------|--------|----------|
| n_trials | SegmentedControl + カスタム NumberInput | `tuning.optuna.params.n_trials` | `ui_schema.n_trials_presets` から（デフォルト: 10/50/100/200/500）+ カスタム | 50 |
| timeout | SegmentedControl + カスタム NumberInput | `tuning.optuna.params.timeout` | None / 300 / 600 / 1800 / カスタム（秒） | null (None) |

SegmentedControl: プリセット値をボタン群で表示し、「カスタム」を選ぶと NumberInput が出現する。

> 注: `direction` は廃止。Optimization Metric の選択に応じて `ui_schema.option_sets.metric_direction[task][metric]` から自動判定する（H-0031）。

**Search Space セクション（config.tuning.optuna.space）:**

Search Space は `model.params` のキーに対応する探索範囲を定義する。`tuning.optuna.space` は以下の形式の辞書:

```yaml
# config.tuning.optuna.space の構造
tuning:
  optuna:
    space:
      learning_rate:          # パラメータ名 = model.params のキー
        type: float           # float | int | categorical
        low: 0.01             # Range: 下限
        high: 0.3             # Range: 上限
        log: true             # Range: Log-uniform 分布
      num_leaves:
        type: int
        low: 10
        high: 100
        step: 1               # integer の step（optional）
      boosting_type:
        type: categorical
        choices: [gbdt, dart] # Choice: 選択肢リスト
      n_estimators:           # Fixed = space に含めない（model.params の値を使用）
        # (エントリなし = Fixed)
```

**パラメータ一覧の生成ルール:**

Search Space テーブルに表示するパラメータは `ui_schema.search_space_catalog` から生成し、`group` フィールドでグループ分け表示する（H-0031）。

| ステップ | 処理 |
|---------|------|
| 1 | `search_space_catalog` の全エントリをテーブル行として表示。`group` でグループ分離（── Model Params ──, ── Smart Params ──, ── Training ──） |
| 2 | 各行の初期 Mode は `Fixed`。**Fixed 値は Tune タブ初回遷移時に Fit config から取り込む**（以後は独立して編集可能） |
| 3 | ユーザーが Mode を `Range` / `Choice` に変更すると `tuning.optuna.space` にエントリを追加 |
| 4 | Mode を `Fixed` に戻すと `space` からエントリを削除 |
| 5 | `[+ Add]` ボタンで `ui_schema.additional_params` から追加パラメータを Search Space に追加可能 |

**Mode 選択肢（パラメータ型で決まる）:**

| パラメータ型 | 選択可能な Mode | 判定方法 |
|------------|---------------|---------|
| `float` | Fixed / Range | プリセット定義の型が float |
| `integer` | Fixed / Range | プリセット定義の型が integer |
| `categorical`（文字列選択肢あり） | Fixed / Choice | プリセット定義に `choices` がある場合 |

**Mode = Fixed（全型共通）:**

| 要素 | コンポーネント | 説明 |
|------|-------------|------|
| 値表示 | テキスト（読み取り専用） | `model.params` の現在値を表示。Fit タブで編集する |

Fixed パラメータは `space` に含めず、`model.params` の値がそのまま使われる。行は折りたたみ状態で表示。

**Mode = Range（float / integer）:**

行を展開して以下のフォームを表示。

| 要素 | コンポーネント | space エントリ | 説明 |
|------|-------------|---------------|------|
| min | NumberInput（ステッパー付き） | `low` | 探索範囲の下限 |
| max | NumberInput（ステッパー付き） | `high` | 探索範囲の上限 |
| distribution | Select | `log: true/false` | Uniform（`log: false`）/ Log-uniform（`log: true`） |
| step | NumberInput（integer のみ） | `step` | ステップ幅。省略可。float には表示しない |

Range のデフォルト初期値:

| パラメータ | low | high | log | step |
|-----------|-----|------|-----|------|
| learning_rate | 0.005 | 0.3 | true | — |
| num_leaves | 10 | 200 | false | 1 |
| n_estimators | 100 | 3000 | false | 100 |
| max_depth | 3 | 12 | false | 1 |
| subsample | 0.5 | 1.0 | false | — |
| colsample_bytree | 0.5 | 1.0 | false | — |
| reg_alpha | 1e-8 | 10.0 | true | — |
| reg_lambda | 1e-8 | 10.0 | true | — |

**Mode = Choice（categorical）:**

| 要素 | コンポーネント | space エントリ | 説明 |
|------|-------------|---------------|------|
| 選択肢 | Chip グループ（ON/OFF） | `choices: [...]` | 探索対象の値を複数選択。最低1つ選択必須 |

**Tune Evaluation セクション（config.tuning.evaluation）— H-0031:**

Tune 時の評価メトリクスを Fit の `evaluation.metrics` とは独立して設定する。2段構成:

| 要素 | コンポーネント | Config パス | 説明 |
|------|-------------|------------|------|
| Optimization Metric | Segment buttons（single select） | `tuning.evaluation.metrics[0]` | Optuna の objective として使用されるメトリクス。`ui_schema.option_sets.metric[task]` から選択肢生成。`direction` は `metric_direction[task][metric]` から自動判定 |
| Additional Metrics | Chip buttons（multi-select） | `tuning.evaluation.metrics[1..]` | Optuna が全メトリクスを計算するが objective は metrics[0] のみ。Optimization Metric は候補から除外 |

**Tune ボタン有効条件:**

| 条件 | チェック方法 |
|------|------------|
| Data Panel 完了 | `workspace/status` の `has_data = true` |
| Config 設定済み | `model.name` が選択されている |
| 実行中でない | `running = false` |

> 注: 「探索パラメータあり」の条件は廃止（H-0031）。全 Fixed（empty space）でも Tune 可能。`capabilities.tune.allow_empty_space = true` の場合、LizyML がデフォルトの探索空間を自動生成する。

##### フォーム動的生成

Fit タブのフォームフィールドは Backend の Config JSON Schema から動的に生成する。

**JSON Schema → コンポーネントマッピング:**

| JSON Schema 型 | コンポーネント | 備考 |
|----------------|-------------|------|
| `number` / `integer` | NumberInput（ステッパー付き） | `minimum`/`maximum` がある場合は範囲制約を表示 |
| `boolean` | Switch | |
| `string` + `enum` | Select | enum 値をドロップダウンに |
| `string`（enum なし） | TextInput | |
| `array` of `string` | TagInput（カンマ区切り入力 + タグ表示） | `evaluation.metrics` 等 |
| `anyOf: [T, null]` | T のコンポーネント + 「Auto」チップ | null = Backend デフォルト使用。チップ ON → null を送信 |
| `object` + named properties | Accordion（入れ子） | `training.early_stopping` 等 |
| `object` + `additionalProperties` のみ | Key-Value エディタ | `model.params` 等。後述 |
| `const` | 非表示 | `model.name = "lgbm"`, `config_version = 1` |
| `oneOf` + discriminator | Select（discriminator 値） + 動的フォーム | `model` セクション |

**anyOf null パターンの扱い:**

LizyML の Schema は多くのフィールドを `anyOf: [{type: T}, {type: null}]` で定義する。`null` は「Backend デフォルトに任せる」を意味する。

| 値 | UI 表示 |
|-----|---------|
| `null` | 「Auto」チップが ON。入力フィールドは disabled で placeholder にデフォルト値を表示 |
| 数値/文字列 | 「Auto」チップが OFF。入力フィールドが enabled で値を表示 |

ユーザーが「Auto」チップをクリックすると値を `null` に設定し、Config に `null` を送信する。

**その他のルール:**

- `default` 値 → フォーム初期値
- `description` → ツールチップ表示（info アイコンをフィールド横に配置）
- `config_version` は固定値（`const: 1`）。ユーザーには非表示
- フォーム変更時に 500ms デバウンスして `PUT /api/workspace/config` で自動保存。保存前に `POST /api/workspace/config/validate` でバリデーションし、エラーがある場合は保存せずエラーをインラインで表示
- Accordion セクションの開閉状態はローカル state で管理。Config には影響しない

##### Config Import / Export

各タブ内の Action Button 上に配置。どちらのタブから操作しても対象は同じ（フル Config）。

| 操作 | コンポーネント | 説明 |
|------|-------------|------|
| Import YAML | Button → ファイル選択ダイアログ | YAML/JSON ファイルを読み込み、`POST /api/workspace/config/upload` で送信。data / features / split の値は Data Panel の state に反映（Target/Task/CV 等を更新）、model / training / evaluation / calibration / tuning は Model Panel の Config に反映 |
| Export YAML | Button → ダウンロード | `GET /api/workspace/config/download` で現在の全 Config を YAML としてダウンロード |
| Raw Config | Button → Dialog | フル Config を YAML テキストで表示するモーダル。読み取り専用。コピーボタン付き |

##### デザイン仕様

Model Panel 全体のコンポーネントスタイルを定義する。shadcn/ui + Tailwind CSS で統一。

**Sticky ヘッダー:**

```
┌──────────────────────────────────────────────┐
│ ┌──────────────────┐              [━ Fit ━]  │
│ │ ▶ Fit  │  Tune   │  ┌─────────────────┐   │
│ └──────────────────┘  │lizyml v0.5.2    │   │
│                       └─────────────────┘   │
└──────────────────────────────────────────────┘
  ← TabsList (w-full)     Badge(secondary)
                            Button(default, sm)
```

| 要素 | Tailwind クラス | 備考 |
|------|----------------|------|
| ヘッダー外枠 | `sticky top-0 z-10 border-b bg-background p-3` | パネル内スクロール時に固定 |
| タブ行 | `flex items-center justify-between gap-2` | タブとボタンを左右に配置 |
| TabsList | shadcn `TabsList` + `w-full` を**使わない** → `w-auto` | タブ幅はコンテンツ幅に合わせる |
| TabsTrigger | shadcn `TabsTrigger` + `px-6` | Fit / Tune の2つ |
| 実行ボタン | `Button size="sm"` (default variant) | ラベルはアクティブタブに連動 |
| 実行ボタン (disabled) | `opacity-50 cursor-not-allowed` | 条件未達時は自動で disabled スタイル |
| Backend バッジ | `Badge variant="secondary"` + `text-xs` | タブ行の下、左寄せ。`mt-1.5` |

**Accordion セクション:**

```
▸ Model                              ← AccordionTrigger
  ┌──────────────────────────────┐
  │ name         [lgbm       ▼] │   ← Select (h-8)
  │ ──────────── separator ──── │
  │ auto_num_leaves    [━━ON━]  │   ← Switch
  │ num_leaves_ratio   [1.0   ] │   ← NumberInput
  │ balanced           [Auto ✓] │   ← nullable → Auto chip
  │ ──────────── separator ──── │
  │ LightGBM params              │   ← Label (text-xs, muted)
  │ learning_rate  [0.1      ]  │   ← Input (h-8)
  │ num_leaves     [31       ]  │   ← Input (h-8)
  │ ...                          │
  │ [＋ Add parameter]           │   ← Button ghost, sm
  └──────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| Accordion | shadcn `Accordion type="multiple"` | — | 複数セクション同時展開可 |
| セクション名 | `AccordionTrigger` | `text-sm font-medium` | Model / Training / Evaluation / Calibration |
| セクション内容 | `AccordionContent` | `space-y-3 pt-2` | フィールド間のスペース統一 |
| セパレータ | `<Separator />` または `<div>` | `border-t my-3` | スキーマフィールドと params の間 |
| デフォルト開閉 | Model: open, Training: open, Evaluation: open, Calibration: closed | — | `defaultValue={["model","training","evaluation"]}` |

**フォームフィールド共通レイアウト:**

各フィールドは Label + Input の2段構成。ラベルとインプットは同一行に配置するか、幅に応じて縦積みする。

```
┌─────────────────────────────────────┐
│ learning_rate ⓘ        [  0.1    ] │
│ ← Label (text-xs)       Input (h-8)│
│   + tooltip icon         w-24      │
└─────────────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| フィールド行 | `<div>` | `flex items-center justify-between gap-2` | ラベル左、入力右 |
| Label | shadcn `Label` | `text-xs text-muted-foreground truncate` | パラメータ名。長い場合は truncate |
| ツールチップアイコン | lucide `Info` (14px) | `h-3.5 w-3.5 text-muted-foreground/60 cursor-help` | `description` がある場合のみ表示 |
| ツールチップ | shadcn `Tooltip` | — | hover で `description` テキスト表示 |

**NumberInput（数値入力）:**

```
┌──────────────────────┐
│ [−] [  0.1      ] [+]│
│  ← stepper buttons    │
│     Input (h-8, w-20) │
└──────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| 外枠 | `<div>` | `flex items-center gap-1` | |
| −/＋ ボタン | `Button variant="outline" size="icon"` | `h-7 w-7` | lucide `Minus` / `Plus` (12px) |
| 入力フィールド | shadcn `Input` | `h-8 w-20 text-center text-xs tabular-nums` | `type="number"`, step は型に応じて設定 |
| float の step | — | — | 0.01（learning_rate 等）、0.1（ratio 等） |
| integer の step | — | — | 1 |

**Switch（真偽値）:**

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| Switch | shadcn `Switch` | デフォルト | ON = primary color、OFF = muted |
| ラベル配置 | Label + Switch | `flex items-center justify-between` | ラベル左、スイッチ右 |

**Select（ドロップダウン）:**

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| Select | shadcn `Select` | — | |
| SelectTrigger | shadcn `SelectTrigger` | `h-8 text-xs` | |
| SelectContent | shadcn `SelectContent` | — | Portal でオーバーフロー回避 |
| SelectItem | shadcn `SelectItem` | `text-xs` | |

**Auto チップ（nullable フィールド）:**

```
┌───────────────────────────────────┐
│ balanced   [Auto ✓]  [  ─  ]     │
│            ← chip     disabled    │
│            primary/sm  when Auto  │
│                                   │
│ balanced   [Auto  ]  [ true ━]   │
│            ← chip     enabled     │
│            outline/sm  when set   │
└───────────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| Auto チップ (ON) | `Badge variant="default"` | `cursor-pointer text-xs px-2 py-0.5` | クリックで OFF に切替。値を `null` にリセット |
| Auto チップ (OFF) | `Badge variant="outline"` | `cursor-pointer text-xs px-2 py-0.5` | クリックで ON に切替（Auto = null） |
| 入力フィールド | 型に応じた Input | Auto ON 時: `opacity-40 pointer-events-none` | Auto ON → disabled + placeholder にデフォルト値表示 |

**Evaluation メトリクスチップ:**

```
┌────────────────────────────────────┐
│ ☑ AUC   ☑ LogLoss   ☐ Accuracy   │
│ ☐ F1    ☐ Precision  ☐ Recall    │
│ ← Badge toggles, wrap             │
└────────────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| チップ (選択) | `Badge variant="default"` | `cursor-pointer text-xs` | クリックでトグル |
| チップ (非選択) | `Badge variant="outline"` | `cursor-pointer text-xs` | クリックでトグル |
| コンテナ | `<div>` | `flex flex-wrap gap-1.5` | チップを折り返し配置 |

**Calibration トグル:**

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| AccordionTrigger 内トグル | Switch（AccordionTrigger の右端） | `ml-auto` | トグルクリックで `calibration = null ↔ {method: "platt", ...}` |
| OFF 時 | AccordionContent 非表示 | — | Accordion を閉じた状態で固定 |
| ON 時 | AccordionContent 表示 | — | method Select + n_splits NumberInput |

**Model セクション 3グループ構成（H-0030）:**

```
┌──────────────────────────────────────┐
│ name        [lgbm            ▼]     │ ← discriminator
│ ── Smart Params ──                   │ ← Separator + Label
│ auto_num_leaves    [━━ON━]          │
│ num_leaves_ratio   [1.0   ]         │ ← auto=ON時のみ
│ min_data_in_leaf_ratio [0.01]       │
│ min_data_in_bin_ratio  [0.01]       │
│ feature_weights    [OFF]            │ ← Toggle → Multi-row
│ balanced           [Auto ✓]         │
│ ── Model Params ──                   │ ← Separator + Label
│ objective  [binary|cross_entropy]   │ ← Segment buttons
│ metric     ☑auc ☑binary_logloss    │ ← Chip buttons
│ n_estimators [1000 ]                │
│ learning_rate [0.1  ]               │
│ ...                                  │
│ ── Additional Params ──              │ ← Separator + Label
│ [param_select ▼] [value ] [×]       │ ← カタログ選択
│ [＋ Add]                             │
└──────────────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| グループ見出し | `<p>` | `text-xs text-muted-foreground font-medium mb-2` | "Smart Params", "Model Params", "Additional Params" |
| セパレータ | `<Separator />` | `border-t my-3` | グループ間の視覚分離 |
| Model Params 行 | Label + NumberInput | 前述のフォームフィールド仕様 | `parameter_hints` から生成。step は `step_map` から |
| Objective | Segment buttons | 前述の SegmentedControl 仕様 | `option_sets.objective[task]` から選択肢 |
| Metric | Chip buttons | 前述のメトリクスチップ仕様 | `option_sets.model_metric[task]` から選択肢 |
| Additional Params 選択 | `Select` | `h-7 w-40 text-xs` | `ui_schema.additional_params` から未使用のパラメータ |
| Additional Params 値 | NumberInput / Input | `h-7 w-24 text-xs text-right` | step は `step_map` から |
| 削除ボタン | `Button variant="ghost" size="icon"` | `h-6 w-6` | lucide `X` (12px) |
| 追加ボタン | `Button variant="ghost" size="sm"` | `text-xs text-muted-foreground` | lucide `Plus` (12px) + "Add" |

**Tune タブ — Settings セクション:**

```
┌──────────────────────────────────────┐
│ n_trials                             │
│ [50] [100] [200] [500] [カスタム▸]   │ ← SegmentedControl
│                          [  150  ]   │ ← カスタム選択時に表示
│                                      │
│ timeout                              │
│ [None] [300] [600] [1800] [カスタム▸]│
└──────────────────────────────────────┘
```

> 注: `direction` は廃止。Optimization Metric 選択時に `metric_direction` マップから自動判定する（H-0031）。

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| SegmentedControl | `<div>` + 複数 `Button` | `flex flex-wrap gap-1` | プリセット値ボタン群 |
| プリセットボタン (選択) | `Button variant="default" size="sm"` | `h-7 text-xs px-3` | |
| プリセットボタン (非選択) | `Button variant="outline" size="sm"` | `h-7 text-xs px-3` | |
| 「カスタム」ボタン | `Button variant="outline" size="sm"` | `h-7 text-xs px-3` | 選択すると NumberInput が出現 |
| カスタム NumberInput | `Input` | `h-8 w-24 text-xs mt-1.5` | `type="number"` |

**Tune タブ — Search Space テーブル:**

```
┌──────────────┬──────────┬──────────────────┐
│ Param        │ Mode     │ Summary          │ ← ヘッダー行
├──────────────┼──────────┼──────────────────┤
│▸learning_rate│ Range  ▼ │ 0.01 ~ 0.3 (log)│ ← サマリー行
│  min  [.01 ] max [.3  ] dist [Log   ▼]    │ ← 展開行
│                                            │
│ n_estimators │ Fixed  ▼ │ 1000             │ ← Fixed は展開不可
│                                            │
│▸boosting_type│ Choice ▼ │ gbdt, dart       │ ← サマリー行
│  ☑ gbdt  ☑ dart  ☐ goss                   │ ← 展開行（チップ群）
└──────────────┴──────────┴──────────────────┘
```

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| テーブル外枠 | `<div>` | `rounded-md border` | |
| ヘッダー行 | `<div>` | `flex items-center border-b bg-muted/50 px-3 py-1.5 text-xs font-medium text-muted-foreground` | 3列: Param / Mode / Summary |
| サマリー行 | `<div>` | `flex items-center px-3 py-2 border-b hover:bg-muted/30 cursor-pointer` | クリックで展開 |
| サマリー行 (Range/Choice) | — | `font-medium text-foreground` | 展開可能を示す `▸` アイコン |
| サマリー行 (Fixed) | — | `text-muted-foreground` | 展開不可。値を直接表示 |
| Mode Select | shadcn `Select` | `h-7 w-24 text-xs` | Fixed / Range / Choice |
| Summary テキスト | `<span>` | `text-xs text-muted-foreground tabular-nums` | Range: `0.01 ~ 0.3 (log)`、Choice: `gbdt, dart` |
| 展開行 | `<div>` | `px-6 py-2 border-b bg-muted/20 space-y-2` | indent + 背景色で視覚的区別 |
| 展開行: Range | NumberInput × 2 + Select | 前述の NumberInput スタイル | min, max, distribution, step |
| 展開行: Choice | Badge 群 | 前述のメトリクスチップと同じスタイル | ON/OFF トグル |
| 展開アイコン | lucide `ChevronRight` / `ChevronDown` | `h-3.5 w-3.5 mr-1.5 transition-transform` | 展開時に回転 |

**Config Import/Export ボタン群:**

```
┌─────────────────────────────────────┐
│ [📥 Import YAML] [📤 Export YAML]  │
│ [📄 Raw Config]                     │
└─────────────────────────────────────┘
```

| 要素 | コンポーネント | Tailwind | アイコン | 備考 |
|------|-------------|----------|---------|------|
| コンテナ | `<div>` | `mt-6 flex flex-wrap gap-2` | — | Accordion の下に配置 |
| Import YAML | `Button variant="outline" size="sm"` | — | lucide `FileUp` (12px) + `mr-1` | hidden file input をトリガー |
| Export YAML | `Button variant="outline" size="sm"` | — | lucide `Download` (12px) + `mr-1` | `window.open()` でダウンロード |
| Raw Config | `Button variant="outline" size="sm"` | — | lucide `FileText` (12px) + `mr-1` | Dialog をトリガー |

**Raw Config ダイアログ:**

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| Dialog | shadcn `Dialog` | `max-h-[80vh] max-w-2xl overflow-auto` | |
| タイトル | `DialogTitle` | — | "Raw Config (read-only)" |
| YAML テキスト | `<pre>` | `max-h-[60vh] overflow-auto rounded bg-muted p-4 text-xs font-mono` | YAML フォーマット表示 |
| コピーボタン | `Button variant="outline" size="sm"` | `absolute top-2 right-2` | lucide `Copy` (12px)。クリックで `navigator.clipboard.writeText()` → toast "Copied" |

**バリデーションエラー表示:**

| 要素 | コンポーネント | Tailwind | 備考 |
|------|-------------|----------|------|
| エラーコンテナ | `<div>` | `mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3` | Accordion の上に表示 |
| エラー行 | `<p>` | `text-xs text-destructive` | `{path}: {message}` 形式 |
| インラインエラー | `<p>` | `text-xs text-destructive mt-0.5` | 各フィールドの下にバリデーションエラーを表示（将来対応） |

**レスポンシブ:**

Model Panel は中央パネル（デフォルト幅 35%、min 25%、max 45%）で表示される。
幅が狭い場合（< 300px）は以下を適用:
- フィールド行を縦積みに変更（Label 上、Input 下）
- NumberInput のステッパーボタンを非表示
- SegmentedControl を2行に折り返し

#### 4.2.3 Results Panel（右パネル）

現セッション中の直近の Fit / Tune 結果を表示する。パネルの表示はジョブの状態に応じて4つのモードを持つ。

##### 初期状態（未実行）

```
┌────────────────────────────────────┐
│                                    │
│            Results                 │
│                                    │
│   1. Data Panel でデータを設定      │
│   2. Model Panel でモデルを選択     │
│   3. Fit / Tune を実行             │
│                                    │
│   結果がここに表示されます            │
│                                    │
└────────────────────────────────────┘
```

操作手順のガイドテキストを表示。

##### 実行中

```
┌────────────────────────────────────┐
│ Fit #4 ── LightGBM                 │
│                                    │
│ ████████████░░░░░░ Fold 3 / 5      │
│ Elapsed: 00:42                     │
│                                    │
│ Fold 1  AUC=0.889  ✓              │
│ Fold 2  AUC=0.901  ✓              │
│ Fold 3  training...                │
│ Fold 4  ─                          │
│ Fold 5  ─                          │
│                                    │
│ [Cancel]                           │
└────────────────────────────────────┘
```

| 要素 | 説明 |
|------|------|
| ヘッダー | ジョブ種別・番号・モデル名 |
| プログレスバー | 完了 fold / 全 fold。WebSocket で受信し更新 |
| 経過時間 | ジョブ開始からの経過時間 |
| Fold ログ | 完了した fold のメトリクスをリアルタイム追加表示 |
| Cancel | 実行中のジョブを中止 |

Tune 実行中は Fold の代わりに Trial の進捗を表示（`Trial 12 / 100  Best AUC=0.905`）。

##### Fit 完了

タブ分割せず、Score → Learning Curve → 評価プロット → 詳細情報を**1つのスクロールビュー**にまとめる。

```
┌────────────────────────────────────┐
│ Fit #4 ── LightGBM ── ✓ Completed │
│                                    │
│ ── Score ──                        │
│ ┌──────┬───────┬───────┬────────┐ │
│ │      │  IS   │  OOS  │OOS Std │ │ ← CV時
│ ├──────┼───────┼───────┼────────┤ │
│ │ AUC  │ 0.952 │ 0.892 │ 0.012  │ │
│ │ LogL │ 0.198 │ 0.341 │ 0.008  │ │
│ └──────┴───────┴───────┴────────┘ │
│                                    │
│ ── Learning Curve ──               │
│ ┌──────────────────────────────┐   │
│ │       (Plotly chart)         │   │
│ └──────────────────────────────┘   │
│                                    │
│ ── Plots [ROC Curve         ▼] ── │ ← selector
│ ┌──────────────────────────────┐   │
│ │       (Plotly chart)         │   │
│ └──────────────────────────────┘   │
│                                    │
│ ▸ Feature Importance               │ ← Accordion
│   ┌──────────────────────────────┐ │
│   │  (Importance bar chart)      │ │
│   └──────────────────────────────┘ │
│                                    │
│ ▸ Fold Details                     │ ← CV時のみ表示
│   ┌──────┬───────┬───────┬──────┐ │
│   │ Fold │ AUC   │ LogL  │ Size │ │
│   │ 1    │ 0.889 │ 0.343 │ 200  │ │
│   │ 2    │ 0.901 │ 0.331 │ 200  │ │
│   │ ...  │       │       │      │ │
│   └──────┴───────┴───────┴──────┘ │
│                                    │
│ ▸ Parameters                       │ ← Accordion
│   model: LightGBM                  │
│   learning_rate: 0.1               │
│   num_leaves: 31  ...              │
└────────────────────────────────────┘
```

**Score:**

| 列 | 説明 |
|-----|------|
| IS (In Sample) | 学習データでのメトリクス |
| OOS (Out of Sample) | 検証データでのメトリクス（CV 時は OOF 値） |
| OOS Std | OOS の Fold 間標準偏差。**CV 時のみ表示**（CV 無しでは列自体を非表示） |

CV 無し（Holdout 等）の場合:

```
┌──────┬───────┬───────┐
│      │  IS   │  OOS  │
├──────┼───────┼───────┤
│ AUC  │ 0.952 │ 0.878 │
│ LogL │ 0.198 │ 0.361 │
└──────┴───────┴───────┘
```

**Learning Curve:**

常時表示。学習の収束状況を確認する。

**Plots（評価プロット）:**

セレクタ（ドロップダウン）で切替表示。Task に応じて選択肢が変わる。

| プロット | 条件 |
|---------|------|
| OOS 分布 | 全タスク |
| 残差 | regression |
| ROC 曲線 | binary |
| キャリブレーション曲線 | binary + calibration 有効 |
| 確率ヒストグラム | binary |

**Accordion セクション（展開で詳細表示）:**

| セクション | 内容 | 表示条件 |
|-----------|------|---------|
| Feature Importance | 特徴量重要度の棒グラフ（Plotly） | 常時 |
| Fold Details | Fold 別メトリクスとデータサイズのテーブル | CV 時のみ |
| Parameters | 学習に使用したハイパーパラメータ一覧 | 常時 |

##### Tune 完了

Fit 完了と同じ評価項目に加え、探索結果（Best Params・収束推移・Trial テーブル）を表示する。Best Params で学習したモデルの評価結果を Fit と同じ形式で確認できる。タブ分割せず**1つのスクロールビュー**にまとめる。

```
┌────────────────────────────────────┐
│ Tune #5 ── LightGBM ── ✓ Completed│
│ Best AUC: 0.905                    │
│                                    │
│ ── Optimization History ──         │
│ ┌──────────────────────────────┐   │
│ │    (convergence plot)        │   │
│ └──────────────────────────────┘   │
│                                    │
│ ── Best Params ──                  │
│ ┌────────────────┬────────────┐   │
│ │ Param          │ Value      │   │
│ ├────────────────┼────────────┤   │
│ │ learning_rate  │ 0.05       │   │
│ │ num_leaves     │ 45         │   │
│ │ n_estimators   │ 1000       │   │
│ │ max_depth      │ 7          │   │
│ └────────────────┴────────────┘   │
│ [Apply to Fit ▸]                   │
│                                    │
│ ── Score ──                        │
│ ┌──────┬───────┬───────┬────────┐ │
│ │      │  IS   │  OOS  │OOS Std │ │
│ ├──────┼───────┼───────┼────────┤ │
│ │ AUC  │ 0.961 │ 0.905 │ 0.010  │ │
│ │ LogL │ 0.172 │ 0.310 │ 0.007  │ │
│ └──────┴───────┴───────┴────────┘ │
│                                    │
│ ── Learning Curve ──               │
│ ┌──────────────────────────────┐   │
│ │       (Plotly chart)         │   │
│ └──────────────────────────────┘   │
│                                    │
│ ── Plots [ROC Curve         ▼] ── │
│ ┌──────────────────────────────┐   │
│ │       (Plotly chart)         │   │
│ └──────────────────────────────┘   │
│                                    │
│ ▸ Trial Results                    │
│   ┌──────┬───────┬──────┬───────┐ │
│   │Trial │ Score │ lr   │ n_lvs │ │
│   │ 1    │ 0.871 │ 0.20 │ 31    │ │
│   │ 2    │ 0.889 │ 0.05 │ 50    │ │
│   │★ 3   │ 0.905 │ 0.05 │ 45    │ │ ← best
│   │ ...  │       │      │       │ │
│   └──────┴───────┴──────┴───────┘ │
│ ▸ Feature Importance               │
│ ▸ Fold Details                     │ ← CV時のみ
│ ▸ Parameters                       │
└────────────────────────────────────┘
```

**Optimization History:** 横軸: Trial 番号、縦軸: スコア。探索の収束推移を確認する Plotly チャート。

**Best Params:**

| 要素 | 説明 |
|------|------|
| パラメータテーブル | 探索で見つかった最適パラメータの一覧 |
| Apply to Fit | Tune 実行時の **全 Config snapshot を復元**（best_params だけでなく全設定）し、Fit タブに切替。Widget 準拠: best_params を model.params に設定した上で、training / evaluation / calibration 等も Tune 時の設定を引き継ぐ |

**Score:** Fit 完了と同じ仕様（IS / OOS / OOS Std）。Best Params で学習したモデルの評価値。

**Learning Curve:** Best Params モデルの学習曲線。Fit 完了と同じ仕様。

**Plots（評価プロット）:** Fit 完了と同じ仕様・同じ選択肢。Best Params モデルの評価プロット。

**Accordion セクション:**

| セクション | 内容 | 表示条件 |
|-----------|------|---------|
| Trial Results | 全 Trial のスコアとパラメータ。Best 行はハイライト表示。スコア降順ソート | 常時 |
| Feature Importance | Best Params モデルの特徴量重要度の棒グラフ | 常時 |
| Fold Details | Fold 別メトリクスとデータサイズのテーブル | CV 時のみ |
| Parameters | Best Params の全パラメータ一覧（Best Params セクションと同内容、Config 全体を含む） | 常時 |

##### エラー

```
┌────────────────────────────────────┐
│ Fit #4 ── LightGBM ── ✗ Failed    │
│                                    │
│ ┌──────────────────────────────┐   │
│ │ BACKEND_ERROR                │   │
│ │ Feature 'age' has            │   │
│ │ unsupported dtype            │   │
│ └──────────────────────────────┘   │
│                                    │
│ [View Full Log]                    │
└────────────────────────────────────┘
```

| 要素 | 説明 |
|------|------|
| エラーコード | `BACKEND_ERROR` 等（§6.1 参照） |
| エラーメッセージ | 要約表示 |
| View Full Log | 完全なエラーログをモーダルで表示 |

##### ヘッダー共通仕様

全状態で Results Panel 上部にヘッダーを表示する。

| 要素 | 説明 |
|------|------|
| ジョブ種別・番号 | `Fit #4` / `Tune #5` |
| モデル名 | `LightGBM` 等 |
| ステータス | `Running` / `✓ Completed` / `✗ Failed` |
| プライマリメトリクス | 完了時のみ。OOF スコア（Fit）/ Best Score（Tune） |
| Export Code ボタン | 完了時のみ。`[Export Code]`。LizyML 非依存のコードを ZIP ダウンロード（H-0027）。`POST /api/jobs/{job_id}/export-code` を呼び出す |

##### Workspace の状態ルール

- Results Panel は現セッション中の直近の Fit / Tune 結果のみ表示する
- ブラウザを閉じて再アクセスした場合、Results Panel は空（初期状態に戻る）
- 過去の Job 結果は Workspace には表示しない（Jobs 画面で閲覧する）

#### 4.2.4 Fit 実行フロー

全 fit/tune はJobとして登録される（§3.4.2）。

```
[Fit] クリック
  ↓
Job作成（status: running）→ ディスク保存
  ↓
バックグラウンドで adapter.fit() 実行
  ↓
  ├── 完了 → Job更新（status: completed）→ Results Panel に結果表示
  └── 失敗 → Job更新（status: failed）→ Results Panel にエラー表示
```

- Fit 実行中も Data Panel / Model Panel は操作可能（パラメータ調整の準備ができる）
- 実行中に別の Fit をクリックした場合は新しいJobとして登録（前のJobは継続）

### 4.3 Jobs (`/jobs`)

**目的:** 全ジョブのライフサイクル管理と結果閲覧。Workspace の Results Panel がセッション内の直近結果のみ表示するのに対し、Jobs 画面はすべての過去結果を永続的に閲覧・管理できる。

**左右2パネルレイアウト:**

```
┌────────────────────┬─────────────────────────────────────┐
│ Jobs               │ Fit #5 ── LightGBM ── ✓ Completed   │
│ (All)(Done)(Run)(F)│                                      │
│ [Type ▼]           │ ── Score ──                          │
│ ────────────────── │ ┌──────┬───────┬───────┬────────┐  │
│ ✓ #5 fit LGB 0.905│ │      │  IS   │  OOS  │OOS Std │  │
│ ● #4 tun LGB  ... │ │ AUC  │ 0.961 │ 0.905 │ 0.010  │  │
│ ✓ #3 fit LGB 0.871│ │ LogL │ 0.172 │ 0.310 │ 0.007  │  │
│ ✓ #2 fit LGB 0.42 │ └──────┴───────┴───────┴────────┘  │
│ ✗ #1 fit LGB  —   │                                      │
│                    │ ── Learning Curve ──                 │
│                    │ ┌─────────────────────────────────┐ │
│                    │ │        (Plotly chart)            │ │
│                    │ └─────────────────────────────────┘ │
│                    │                                      │
│                    │ ── Plots [ROC Curve         ▼] ──   │
│                    │ ┌─────────────────────────────────┐ │
│                    │ │        (Plotly chart)            │ │
│                    │ └─────────────────────────────────┘ │
│                    │                                      │
│                    │ ▸ Feature Importance                 │
│                    │ ▸ Fold Details           ← CV時のみ │
│                    │ ▸ Parameters                         │
│                    │ ▸ Config                 ← Jobs固有 │
│                    │ ▸ Execution Log          ← Jobs固有 │
│                    │                                      │
│                    │ [Inference▸][Export▸][Re-fit▸][Delete]│
└────────────────────┴─────────────────────────────────────┘
```

- **左パネル（固定幅 360px）:** ジョブ一覧。フィルタ + カード形式のリスト。独立スクロール
- **右パネル（残り幅）:** ジョブ詳細。フルハイトの独立スクロール。Workspace Results Panel と同じ表示パターン

#### 4.3.1 ジョブ一覧（左パネル）

##### ヘッダー・フィルタ

```
┌────────────────────┐
│  Jobs              │
│ (All)(Done)(Run)(F)│
│ [Type ▼]           │
└────────────────────┘
```

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| ステータスフィルタ | SegmentedControl（横1行） | `All` / `Done` / `Run` / `Fail`。デフォルト: `All` |
| タイプフィルタ | Select | `All Types` / `Fit` / `Tune`。デフォルト: `All Types` |

##### ジョブリスト

リスト形式で縦に並ぶ。新しい順（降順）。選択行はハイライト表示。1行1ジョブのコンパクトリスト。

```
┌────────────────────┐
│ ✓ #5 fit LGB 0.905│
│ ● #4 tun LGB  ... │
│ ✓ #3 fit LGB 0.871│
│ ✓ #2 fit LGB 0.42 │
│ ✗ #1 fit LGB  —   │
└────────────────────┘
```

各行: `[Status] [ID] [Type] [Model] [Score]`

**行内の要素:**

| 要素 | 説明 |
|------|------|
| ステータスアイコン | `✓`（green）/ `●`（blue + pulse）/ `✗`（red） |
| ID | `#5` 等。ジョブ連番 |
| Type | `fit`（blue）/ `tun`（violet）。短縮テキスト + 色で区別 |
| モデル名 | 短縮表示（`LGB` / `XGB` / `RF` 等）。ホバーでフルネーム |
| スコア | プライマリメトリクスの OOS 値。Running は `...`、Failed は `—` |
| 時間 | 行には非表示。ホバーで `3m ago (2026-03-09 14:32)` をツールチップ表示 |

**カードの操作:**

| 操作 | 動作 |
|------|------|
| クリック | 右パネルに詳細表示 |
| Running カード | ステータスアイコンが pulse アニメーション |

**空状態:** ジョブが 0 件の場合、カード領域に「No jobs yet. Run Fit or Tune from the Workspace.」と表示。

#### 4.3.2 ジョブ詳細（右パネル）

ジョブ詳細は**1つのスクロールビュー**で表示する（タブ分割しない）。Workspace Results Panel と同じ表示パターンを使用し、Jobs 固有のセクション（Config・Execution Log）を Accordion に追加する。

##### ヘッダー

Workspace Results Panel のヘッダーと同一フォーマット。

| 要素 | 説明 |
|------|------|
| ジョブ種別・番号 | `Fit #5` / `Tune #4` |
| モデル名 | `LightGBM` 等 |
| ステータス | `Running` / `✓ Completed` / `✗ Failed` |
| プライマリメトリクス | 完了時のみ。OOS スコア（Fit）/ Best Score（Tune） |

##### Fit 完了ジョブ

Workspace の Fit 完了表示（§4.2.3）と同一レイアウト:

Score → Learning Curve → Plots（セレクタ） → Accordion（Feature Importance / Fold Details / Parameters）

上記に加え、Jobs 固有の Accordion セクション:

| セクション | 内容 |
|-----------|------|
| Config | ジョブ実行時の Config 全体をツリー表示（読み取り専用） |
| Execution Log | 実行ログのテキスト表示。タイムスタンプ付き |

##### Tune 完了ジョブ

Workspace の Tune 完了表示（§4.2.3）と同一レイアウト:

Optimization History → Best Params → Score → Learning Curve → Plots（セレクタ） → Accordion（Trial Results / Feature Importance / Fold Details / Parameters）

上記に加え、Jobs 固有の Accordion セクション（Config / Execution Log）を末尾に追加。

**注:** Jobs 画面での Best Params セクションには `Apply to Fit` ボタンを表示しない。代わりにアクションバーの `Re-fit` を使用する。

##### Running ジョブ

**Tune Running:**

```
┌─────────────────────────────────────────┐
│ Tune #4 ── LightGBM ── ● Running       │
│                                         │
│ ── Progress ──                          │
│ Trial 12 / 50                           │
│ ████████████░░░░░░░░░░░░  24%           │
│ Elapsed: 2m 34s                         │
│ Best so far: AUC 0.891 (Trial #8)       │
│                                         │
│ ▸ Config                                │
│                                         │
│ [Cancel]                                │
└─────────────────────────────────────────┘
```

**Fit Running:**

```
┌─────────────────────────────────────────┐
│ Fit #5 ── LightGBM ── ● Running        │
│                                         │
│ ── Progress ──                          │
│ ████████░░░░░░░░░░░░░░░░  Fitting...    │
│ Elapsed: 0m 45s                         │
│                                         │
│ ▸ Config                                │
│                                         │
│ [Cancel]                                │
└─────────────────────────────────────────┘
```

| 要素 | 説明 |
|------|------|
| Progress | Fit: プログレスバー（取得可能な場合）。Tune: Trial 進捗 `n / total` |
| Elapsed | 経過時間（リアルタイム更新） |
| Best so far | Tune のみ。現時点のベストスコアと Trial 番号 |
| Config | Accordion。実行中の Config を確認可能 |
| Cancel | ジョブのキャンセル。確認ダイアログあり |

##### Failed ジョブ

```
┌─────────────────────────────────────────┐
│ Fit #1 ── LightGBM ── ✗ Failed         │
│                                         │
│ ── Error ──                             │
│ BACKEND_ERROR                           │
│ ValueError: Target column 'y' contains  │
│ NaN values                              │
│ [View Full Log]                         │
│                                         │
│ ▸ Config                                │
│                                         │
│ [Re-fit ▸]  [Delete]                    │
└─────────────────────────────────────────┘
```

| 要素 | 説明 |
|------|------|
| Error | エラーコード + メッセージの要約表示 |
| View Full Log | 完全なエラーログをモーダルで表示 |
| Config | Accordion。失敗したジョブの Config を確認可能 |

##### 未選択状態

左パネルでジョブが未選択の場合、右パネルにプレースホルダーを表示:

```
┌─────────────────────────────────────────┐
│                                         │
│        Select a job to view details     │
│                                         │
└─────────────────────────────────────────┘
```

ページ初回アクセス時は最新のジョブを自動選択する。

#### 4.3.3 ジョブアクション

詳細パネル下部のアクションバーに配置。ジョブの状態により表示するアクションが変わる。

| アクション | 説明 | 表示条件 |
|-----------|------|---------|
| **Inference ▸** | Inference 画面に遷移。このジョブのモデルを自動選択 | Completed（Fit / Tune） |
| **Export ▸** | Export ダイアログを開く | Completed（Fit / Tune） |
| **Re-fit ▸** | Config を Workspace の Model Panel にロードし、Workspace に遷移 | Completed / Failed |
| **Delete** | ジョブの削除。確認ダイアログあり | 全状態（Running 以外） |
| **Cancel** | 実行中ジョブのキャンセル。確認ダイアログあり | Running |

**Re-fit の動作:**
1. 選択ジョブの Config（data / features / split / model / training / evaluation）を Workspace の各パネルに反映
2. Workspace 画面（`/`）に遷移
3. ユーザーは必要に応じてパラメータを調整し、Fit / Tune を実行

**Delete 確認ダイアログ:**

```
┌────────────────────────────────────────┐
│  Delete Job #5?                        │
│                                        │
│  This action cannot be undone.         │
│  The trained model file will also be   │
│  deleted.                              │
│                                        │
│              [Cancel]  [Delete]         │
└────────────────────────────────────────┘
```

#### 4.3.4 Export（ダイアログ）

Jobs 詳細画面のアクションとして実行する。独立画面は設けない。

```
┌────────────────────────────────────────┐
│  Export Job #5                         │
│                                        │
│  Format                                │
│  ( Model ) ( Report )                  │
│                                        │
│  ── Model ──                           │
│  Includes: pkl + metadata JSON         │
│                                        │
│  Output Path                           │
│  [./exports/job_5_model      ] [📁]    │
│                                        │
│              [Cancel]  [Export]         │
└────────────────────────────────────────┘
```

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| Format | SegmentedControl | `Model` / `Report`。選択に応じて説明が切替 |
| Model 説明 | Text | `pkl + metadata JSON` — 学習済みモデルとメタデータ |
| Report 説明 | Text | `HTML` — メトリクス・プロットを含む評価レポート |
| Output Path | TextInput + ファイルピッカー | 出力先パス。デフォルト: `./exports/job_{id}_{format}` |
| Export ボタン | Button | 実行 → 成功時にトースト通知 |

### 4.4 Inference (`/inference`)

**目的:** 学習済みモデル（完了した Job）に新データを適用し予測を行う。予測データに正解ラベルが含まれる場合は精度評価、含まれない場合は過去推論との比較と結果ダウンロードが主な用途。

**左右2パネルレイアウト:**

```
┌────────────────────┬─────────────────────────────────────┐
│ Inference          │ Inf #3 ── Job #5 LightGBM           │
│                    │ 500 rows ── Ground Truth: 'y'        │
│ ── Model ──        │                                      │
│ [Job #5        ▼]  │ ── Score ──                          │
│ fit LightGBM       │ ┌──────┬───────┬───────┬───────┐   │
│ AUC 0.905          │ │      │  IS   │  OOS  │  Inf  │   │
│                    │ │ AUC  │ 0.961 │ 0.905 │ 0.879 │   │
│ ── Data ──         │ │ LogL │ 0.172 │ 0.310 │ 0.351 │   │
│ (Path)(Upload)     │ └──────┴───────┴───────┴───────┘   │
│ [/data/new.csv  ]  │                                      │
│                    │ ── Plots [ROC Curve         ▼] ──   │
│ ── Evaluation ──   │ ┌─────────────────────────────────┐ │
│ ✓ Target 'y'       │ │        (Plotly chart)            │ │
│   detected         │ └─────────────────────────────────┘ │
│ [☑ Evaluate]       │                                      │
│                    │ ▸ Prediction Distribution            │
│ ── Options ──      │ ▸ Predictions              [DL CSV]  │
│ [☐ SHAP values]    │ ▸ SHAP Summary                       │
│                    │ ▸ Warnings                           │
│ [Run Inference]    │                                      │
│ ────────────────── │                                      │
│ ── History ──      │                                      │
│ #3 500rows GT  now │                                      │
│ #2 500rows    2h   │                                      │
│ #1 1000rows   1d   │                                      │
└────────────────────┴─────────────────────────────────────┘
```

- **左パネル（固定幅 360px）:** セットアップフォーム + 推論履歴リスト。独立スクロール
- **右パネル（残り幅）:** 推論結果。フルハイトの独立スクロール。正解有無で表示が切り替わる

#### 4.4.1 Setup Panel（左パネル）

##### モデル選択

```
┌────────────────────┐
│ ── Model ──        │
│ [Job #5        ▼]  │
│ fit LightGBM       │
│ AUC 0.905          │
└────────────────────┘
```

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| Job Select | Select | 完了済み Job（Fit / Tune）のドロップダウン。`#5 fit LightGBM` 形式 |
| Job 情報 | Text | 選択 Job の種別・モデル名・プライマリスコアを表示 |

Jobs 画面から `Inference ▸` で遷移した場合、該当 Job が自動選択される。

##### データソース

Workspace と同じ2way（ローカルパス / アップロード）。

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| 入力方式 | SegmentedControl | `Path` / `Upload` |
| パス入力 | TextInput | ローカルファイルパス |
| アップロード | Dropzone | CSV / Parquet のドラッグ&ドロップ |

##### 正解ラベル検出・評価設定

データ読み込み時に、学習時の Target カラムと同名のカラムが予測データに存在するかを自動検出する。

```
── 正解ラベルあり ──          ── 正解ラベルなし ──
┌────────────────────┐       ┌────────────────────┐
│ ── Evaluation ──   │       │ ── Evaluation ──   │
│ ✓ Target 'y'       │       │ Target 'y' not     │
│   detected         │       │   found in data    │
│ [☑ Evaluate]       │       │ Prediction only    │
└────────────────────┘       └────────────────────┘
```

| 状態 | 表示 | 動作 |
|------|------|------|
| Target カラムあり | `✓ Target '{col}' detected` + Evaluate チェックボックス（デフォルト ON） | 評価モードで実行 |
| Target カラムなし | `Target '{col}' not found in data` / `Prediction only` | 予測のみモードで実行 |

Evaluate チェックボックスを OFF にすると、正解ラベルが存在しても予測のみモードで実行できる。

##### オプション

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| SHAP values | Checkbox | SHAP による予測説明を計算。デフォルト OFF |

##### Run ボタン

| 条件 | 状態 |
|------|------|
| Model 未選択 or Data 未指定 | disabled |
| 両方セット済み | enabled。ラベル: `Run Inference` |

##### 推論履歴（History）

セットアップフォームの下に配置。過去の推論実行を1行1件のコンパクトリストで表示。

```
┌────────────────────┐
│ ── History ──      │
│ #3 500rows GT  now │ ← selected
│ #2 500rows    2h   │
│ #1 1000rows   1d   │
└────────────────────┘
```

| 要素 | 説明 |
|------|------|
| ID | 推論連番 `#3` 等 |
| 行数 | 予測データの行数 |
| GT | Ground Truth あり時に表示。正解ラベル付き推論のマーカー |
| 時間 | 相対時間。ホバーで絶対時刻 |
| クリック | 右パネルにその推論結果を表示 |

**空状態:** 履歴 0 件の場合は History セクション自体を非表示。

#### 4.4.2 Results Panel（右パネル）── 正解ラベルあり

正解ラベル付きデータで推論した場合の結果表示。学習時の OOS 評価と同等の精度評価をインフェレンスデータに対して行い、モデルの汎化性能を確認する。

```
┌─────────────────────────────────────┐
│ Inf #3 ── Job #5 LightGBM           │
│ 500 rows ── Ground Truth: 'y'        │
│                                      │
│ ── Score ──                          │
│ ┌──────┬───────┬───────┬───────┐   │
│ │      │  IS   │  OOS  │  Inf  │   │
│ ├──────┼───────┼───────┼───────┤   │
│ │ AUC  │ 0.961 │ 0.905 │ 0.879 │   │
│ │ LogL │ 0.172 │ 0.310 │ 0.351 │   │
│ └──────┴───────┴───────┴───────┘   │
│                                      │
│ ── Plots [ROC Curve         ▼] ──   │
│ ┌─────────────────────────────────┐ │
│ │        (Plotly chart)            │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ▸ Prediction Distribution            │
│ ▸ Predictions              [DL CSV]  │
│ ▸ SHAP Summary                       │
│ ▸ Warnings                           │
└─────────────────────────────────────┘
```

##### ヘッダー

| 要素 | 説明 |
|------|------|
| 推論 ID | `Inf #3` |
| Job 情報 | `Job #5 LightGBM` |
| 行数 | `500 rows` |
| モード | `Ground Truth: '{col}'` — 正解カラム名を表示 |

##### Score

学習時のスコアと推論データでのスコアを3列で並べ、モデル性能の推移を確認する。

| 列 | 説明 |
|----|------|
| IS | 学習時の In Sample スコア（Job の評価結果から取得） |
| OOS | 学習時の Out of Sample スコア（Job の評価結果から取得） |
| Inf | 推論データの正解ラベルに対するスコア |

IS → OOS → Inf の順に並べることで、学習→検証→本番の性能推移を左から右に追える。Inf の値が OOS から大きく劣化している場合、警告色（orange）で表示する。

##### Plots（評価プロット）

Workspace の Fit 完了と同じセレクタパターン。推論データに対する評価プロット。

| プロット | 条件 |
|---------|------|
| 予測分布 | 全タスク |
| 残差 | regression |
| ROC 曲線 | binary |
| キャリブレーション曲線 | binary + calibration 有効 |
| 確率ヒストグラム | binary |
| 混同行列 | binary / multiclass |

##### Accordion セクション

| セクション | 内容 | 表示条件 |
|-----------|------|---------|
| Prediction Distribution | 予測値/確率の分布ヒストグラム（Plotly） | 常時 |
| Predictions | 予測結果テーブル（idx / actual / pred / proba）。ページネーション（50行/ページ）。ヘッダー右に `[Download CSV]` ボタン | 常時 |
| SHAP Summary | SHAP 値のサマリープロット（beeswarm / bar） | SHAP 有効時 |
| Warnings | カラム型不一致、欠損値等の警告一覧 | 警告がある場合のみ |

#### 4.4.3 Results Panel（右パネル）── 正解ラベルなし

正解ラベルがないデータで推論した場合の結果表示。予測結果の確認・ダウンロードと、過去推論との分布比較が主な用途。

```
┌─────────────────────────────────────┐
│ Inf #2 ── Job #5 LightGBM           │
│ 500 rows ── Prediction Only          │
│                                      │
│ ── Predictions ──                    │
│ ┌─────┬──────┬───────┐             │
│ │ idx │ pred │ proba │             │
│ ├─────┼──────┼───────┤             │
│ │ 0   │  1   │ 0.87  │             │
│ │ 1   │  0   │ 0.23  │             │
│ │ 2   │  1   │ 0.91  │             │
│ │ ... │      │       │             │
│ └─────┴──────┴───────┘             │
│ Showing 50 of 500    [1][2]...[10]  │
│ [Download CSV]                       │
│                                      │
│ ── Prediction Distribution ──        │
│ ┌─────────────────────────────────┐ │
│ │      (histogram / Plotly)        │ │
│ └─────────────────────────────────┘ │
│                                      │
│ ── Comparison [Inf #1      ▼] ──    │
│ ┌─────────────────────────────────┐ │
│ │  (overlaid distribution plot)    │ │
│ │  ── current (blue)               │ │
│ │  ── Inf #1  (gray)               │ │
│ └─────────────────────────────────┘ │
│ ┌──────────┬─────────┬──────────┐  │
│ │          │ Current │  Inf #1  │  │
│ ├──────────┼─────────┼──────────┤  │
│ │ Mean     │  0.612  │  0.598   │  │
│ │ Std      │  0.245  │  0.251   │  │
│ │ Positive%│  61.2%  │  59.8%   │  │
│ └──────────┴─────────┴──────────┘  │
│                                      │
│ ▸ SHAP Summary                       │
│ ▸ Warnings                           │
└─────────────────────────────────────┘
```

##### ヘッダー

| 要素 | 説明 |
|------|------|
| 推論 ID | `Inf #2` |
| Job 情報 | `Job #5 LightGBM` |
| 行数 | `500 rows` |
| モード | `Prediction Only` |

##### Predictions テーブル

| 列 | 説明 | 表示条件 |
|----|------|---------|
| idx | 行インデックス | 常時 |
| pred | 予測値 | 常時 |
| proba | 予測確率 | binary / multiclass |

ページネーション表示（50行/ページ）。`actual` 列なし。

##### Prediction Distribution

現在の推論結果の予測値/確率の分布をヒストグラムで常時表示する。

- **binary:** 予測確率の分布
- **multiclass:** クラス別予測件数の棒グラフ
- **regression:** 予測値のヒストグラム

##### Comparison（過去推論との比較）

過去の推論結果を選択し、予測分布を重ね合わせて比較する。

| 要素 | コンポーネント | 説明 |
|------|--------------|------|
| 比較対象セレクタ | Select | 同一 Job の過去推論一覧（`Inf #1 — 1000rows — 1d ago` 形式） |
| 分布重ね合わせ | Plotly chart | 現在（blue）と比較対象（gray）のヒストグラムをオーバーレイ |
| サマリー統計比較 | Table | Mean / Std / Positive% 等を横並びで比較 |

**サマリー統計の項目:**

| 項目 | binary | multiclass | regression |
|------|--------|-----------|------------|
| Mean | 予測確率の平均 | — | 予測値の平均 |
| Std | 予測確率の標準偏差 | — | 予測値の標準偏差 |
| Positive% | 陽性予測の割合 | — | — |
| Class 分布 | — | クラス別予測割合 | — |
| Median | — | — | 予測値の中央値 |
| Min / Max | — | — | 予測値の範囲 |

比較対象が未選択の場合、Comparison セクションはセレクタのみ表示し、プロットとテーブルは非表示。

過去推論が 0 件（初回推論）の場合、Comparison セクション自体を非表示。

##### Accordion セクション

| セクション | 内容 | 表示条件 |
|-----------|------|---------|
| SHAP Summary | SHAP 値のサマリープロット（beeswarm / bar） | SHAP 有効時 |
| Warnings | カラム型不一致、欠損値等の警告一覧 | 警告がある場合のみ |

#### 4.4.4 Download CSV

正解あり・なし共通のアクション。Predictions テーブルの下に配置。

| 要素 | 説明 |
|------|------|
| ボタン | `Download CSV` |
| 内容 | Predictions テーブルの全行（ページネーション対象外の全データ） |
| ファイル名 | `inference_{inf_id}_{job_id}.csv`（自動命名） |
| 含むカラム | idx, actual（正解あり時）, pred, proba（該当時）, SHAP値（有効時は別ファイル） |

---

## 5. API 仕様

### 5.1 共通ルール

- ベースパス: `/api`
- Content-Type: `application/json`（ファイルアップロード除く）
- エラーレスポンス形式:

```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "Job not found: job_042",
    "details": {}
  }
}
```

### 5.2 Workspace API

Workspace の揮発状態を管理する。

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/workspace/status` | Workspace の現在状態（data, config, result の有無） |
| POST | `/api/workspace/reset` | Workspace 状態をリセット |

#### Config

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/workspace/config/schema` | Config の JSON Schema を返す |
| GET | `/api/workspace/config/defaults` | 完全なデフォルト Config を返す（query: `task`, `target`）(H-0025) |
| GET | `/api/workspace/config` | 現在の Config を返す |
| PUT | `/api/workspace/config` | Config を更新（バリデーション付き） |
| POST | `/api/workspace/config/validate` | Config dict をバリデーションのみ行う |
| POST | `/api/workspace/config/upload` | YAML/JSON ファイルから読み込み |
| GET | `/api/workspace/config/download` | 現在の Config を YAML でダウンロード |

#### Data

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/workspace/data/upload` | CSV/Parquet をアップロード（multipart/form-data） |
| POST | `/api/workspace/data/path` | ローカルパスを指定してデータ読み込み |
| GET | `/api/workspace/data/preview` | 先頭 N 行を返す（query: `rows=50`） |
| GET | `/api/workspace/data/columns` | カラム情報一覧（Target 指定時は自動判定結果を含む。query: `target`） |
| GET | `/api/workspace/data/describe` | 数値カラムの基本統計 |

**GET /api/workspace/data/columns レスポンス:**

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

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `target` | `str \| null` | 指定された Target カラム名。未指定時は `null` |
| `columns` | `array` | Target 以外の全カラム情報 |
| `name` | `str` | カラム名 |
| `dtype` | `str` | 元の dtype（`int64`, `float64`, `object` 等） |
| `unique_count` | `int` | ユニーク値の数 |
| `suggested_type` | `"numeric" \| "categorical"` | §4.2.1 の自動判定ルールに基づく推奨 Type |
| `suggested_excluded` | `bool` | 自動除外の推奨（ID / Const 判定） |
| `exclude_reason` | `"id" \| "constant" \| null` | 除外理由。自動除外でない場合は `null` |

#### Fit / Tune（Job作成）

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/workspace/fit` | 現在の Config + Data で fit Job を作成・実行 |
| POST | `/api/workspace/tune` | 現在の Config + Data で tune Job を作成・実行 |

レスポンス（共通）: `{ "job_id": "job_042" }`
Workspace の `workspace_result` は完了時に自動更新される。

### 5.3 Jobs API

永続化されたジョブを管理する。

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/jobs` | ジョブ一覧（query: `status=completed`, `sort=created_at`) |
| GET | `/api/jobs/{job_id}` | ジョブ詳細（meta + 結果サマリー） |
| GET | `/api/jobs/{job_id}/config` | ジョブの Config |
| GET | `/api/jobs/{job_id}/metrics` | メトリクステーブル |
| GET | `/api/jobs/{job_id}/split-summary` | Split サマリー |
| GET | `/api/jobs/{job_id}/importance` | 特徴量重要度（query: `kind=split`） |
| GET | `/api/jobs/{job_id}/plot/{plot_type}` | Plotly 図 JSON |
| GET | `/api/jobs/{job_id}/plots` | 利用可能なプロットタイプ一覧 |
| POST | `/api/jobs/{job_id}/export` | モデル/レポートを指定パスにExport |
| GET | `/api/jobs/{job_id}/log` | 実行ログ取得（H-0006） |
| POST | `/api/jobs/{job_id}/cancel` | Running ジョブのキャンセル（H-0011） |
| DELETE | `/api/jobs/{job_id}` | ジョブを削除 |

**POST /api/jobs/{job_id}/export リクエスト:**

```json
{
  "export_type": "model",
  "output_path": "/path/to/output"
}
```

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `export_type` | `"model" \| "report"` | `model`: 学習済みモデル一式。`report`: 結果レポート |
| `output_path` | `str` | 出力先ディレクトリパス |

**レスポンス:**

```json
{
  "exported_path": "/path/to/output/job_042_model",
  "export_type": "model"
}
```

**`plot_type` の値:**

| plot_type | 条件 |
|-----------|------|
| `learning-curve` | 全タスク |
| `importance` | 全タスク |
| `oof-distribution` | 全タスク |
| `residuals` | regression |
| `roc-curve` | binary |
| `calibration` | binary + calibration有効 |
| `probability-histogram` | binary |
| `tuning` | tune実行済み |

### 5.4 Inference API

学習済みモデルで新データを分析する。推論結果は Job ディレクトリ配下に永続化される（§3.4.5 参照）。

#### 実行・アップロード

| メソッド | パス | 説明 |
|---------|------|------|
| POST | `/api/inference/upload` | 推論用データをアップロード（multipart/form-data） |
| POST | `/api/inference/run` | 推論実行 |

**POST /api/inference/run リクエスト:**

```json
{
  "job_id": "job_042",
  "data": {
    "source_type": "path",
    "path": "/data/test.csv"
  },
  "return_shap": false
}
```

データは `source_type: "path"` (ローカルパス) または `source_type: "upload"` (事前アップロード) で指定。
アップロードの場合は先に `/api/inference/upload` でファイルを送信する。

**レスポンス:** `{ "inf_id": "inf_003", "job_id": "job_042" }`

#### 履歴・結果参照

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/inference/history` | 推論履歴一覧（query: `job_id`、省略時は全件） |
| GET | `/api/inference/{inf_id}` | 推論結果サマリー（query: `job_id` 必須。meta + has_ground_truth + row_count） |
| GET | `/api/inference/{inf_id}/predictions` | 予測テーブル（query: `job_id` 必須, `rows=50`, `offset=0`） |
| GET | `/api/inference/{inf_id}/metrics` | 評価メトリクス（query: `job_id` 必須。正解あり時。IS/OOS/Inf の3列） |
| GET | `/api/inference/{inf_id}/plot/{plot_type}` | 評価プロット（query: `job_id` 必須。正解あり時。Plotly JSON） |
| GET | `/api/inference/{inf_id}/download` | 予測結果の CSV ダウンロード（query: `job_id` 必須） |
| GET | `/api/inference/{inf_id}/comparison/{other_inf_id}` | 分布比較統計（query: `job_id` 必須。Mean/Std/Positive% 等） |

### 5.5 WebSocket

| パス | 方向 | 説明 |
|------|------|------|
| `/ws/jobs/{job_id}/progress` | Server → Client | ジョブの進捗メッセージ |

**進捗メッセージ形式:**

```json
{
  "type": "progress",
  "job_id": "job_042",
  "current": 2,
  "total": 5,
  "message": "Fold 2/5 training..."
}
```

```json
{
  "type": "completed",
  "job_id": "job_042",
  "message": "Training completed."
}
```

```json
{
  "type": "error",
  "job_id": "job_042",
  "message": "CONFIG_INVALID: ...",
  "code": "CONFIG_INVALID"
}
```

### 5.6 Backend API

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/backends` | 利用可能なバックエンド一覧 |
| GET | `/api/backends/ui-schema` | UI メタデータ（H-0026） |

**GET /api/backends レスポンス:**

```json
[
  {
    "name": "lizyml",
    "version": "0.4.0"
  }
]
```

**GET /api/backends/ui-schema レスポンス（H-0026, H-0032）:**

```json
{
  "sections": [
    {"key": "model", "title": "Model"},
    {"key": "training", "title": "Training"},
    {"key": "calibration", "title": "Calibration"},
    {"key": "evaluation", "title": "Evaluation"}
  ],
  "option_sets": {
    "objective": {
      "regression": ["huber", "mse", "mae", "..."],
      "binary": ["binary", "cross_entropy", "..."],
      "multiclass": ["multiclass", "softmax", "..."]
    },
    "metric": {
      "regression": ["mae", "mape", "rmse", "..."],
      "binary": ["auc", "logloss", "auc_pr", "..."],
      "multiclass": ["multi_logloss", "auc_mu", "..."]
    },
    "model_metric": {
      "regression": ["huber", "mae", "rmse", "..."],
      "binary": ["auc", "binary_logloss", "..."],
      "multiclass": ["multi_logloss", "auc_mu", "..."]
    },
    "metric_direction": {
      "regression": {"mae": "minimize", "r2": "maximize", "...": "..."},
      "binary": {"auc": "maximize", "logloss": "minimize", "...": "..."},
      "multiclass": {"multi_logloss": "minimize", "...": "..."}
    }
  },
  "n_trials_presets": [10, 50, 100, 200, 500],
  "parameter_hints": [
    {"key": "objective", "label": "Objective", "kind": "objective"},
    {"key": "metric", "label": "Metric", "kind": "model_metric"},
    {"key": "n_estimators", "label": "N Estimators", "kind": "integer", "step": 100},
    {"key": "learning_rate", "label": "Learning Rate", "kind": "number", "step": 0.001},
    "..."
  ],
  "search_space_catalog": [
    {"key": "objective", "title": "Objective", "paramType": "string", "modes": ["fixed", "choice"], "group": "model_params"},
    {"key": "n_estimators", "title": "N Estimators", "paramType": "integer", "modes": ["fixed", "range"], "group": "model_params"},
    {"key": "auto_num_leaves", "title": "Auto Num Leaves", "paramType": "boolean", "modes": ["fixed", "choice"], "group": "smart_params"},
    {"key": "num_leaves_ratio", "title": "Num Leaves Ratio", "paramType": "number", "modes": ["fixed", "range"], "group": "smart_params"},
    {"key": "seed", "title": "Seed", "paramType": "integer", "modes": ["fixed"], "group": "training"},
    "..."
  ],
  "step_map": {
    "n_estimators": 100, "learning_rate": 0.001, "max_depth": 1,
    "feature_fraction": 0.05, "bagging_fraction": 0.05, "..."
  },
  "conditional_visibility": {
    "calibration": {"task": ["binary"]},
    "num_leaves_ratio": {"auto_num_leaves": true},
    "num_leaves": {"auto_num_leaves": false},
    "early_stopping.rounds": {"early_stopping.enabled": true},
    "early_stopping.validation_ratio": {"early_stopping.enabled": true},
    "early_stopping.inner_valid": {"early_stopping.enabled": true}
  },
  "defaults": {
    "calibration": {"method": "platt", "n_splits": 5, "params": {}}
  },
  "calibration_methods": ["platt", "isotonic", "beta"],
  "inner_valid_options": ["holdout", "group_holdout", "time_holdout"],
  "additional_params": ["min_child_weight", "subsample", "colsample_bytree", "..."],
  "capabilities": {
    "cv_strategies": [
      "kfold", "stratified_kfold", "group_kfold", "stratified_group_kfold",
      "time_series", "purged_time_series", "group_time_series", "blocked_group_kfold"
    ],
    "tune": {
      "allow_empty_space": true
    }
  }
}
```

**フィールド説明:**

| フィールド | 説明 |
|-----------|------|
| `sections` | Fit タブの Accordion セクション定義 |
| `option_sets` | Task 別の選択肢リスト（objective, metric, model_metric, metric_direction） |
| `parameter_hints` | Model Params セクションに常時表示するパラメータ定義 |
| `search_space_catalog` | Tune Search Space に表示するパラメータ定義（`group` でグループ分け） |
| `step_map` | NumberInput のステップ値マップ |
| `conditional_visibility` | 親フィールドの値に応じた子フィールドの表示/非表示ルール |
| `defaults` | セクション有効化時の初期値 |
| `calibration_methods` | Calibration method の選択肢 |
| `inner_valid_options` | Inner Validation method の選択肢 |
| `additional_params` | Additional Params セクションで追加可能なパラメータ名リスト |
| `capabilities` | バックエンドの動的機能判定。`cv_strategies`: 利用可能な CV strategy、`tune.allow_empty_space`: 全 Fixed での Tune 可否 |

---

## 6. エラーハンドリング

### 6.1 エラーコード

| コード | 意味 | HTTPステータス |
|--------|------|---------------|
| `WORKSPACE_NO_CONFIG` | Workspace に Config 未設定 | 400 |
| `WORKSPACE_NO_DATA` | Workspace にデータ未読込 | 400 |
| `JOB_NOT_FOUND` | 指定されたジョブが存在しない | 404 |
| `JOB_NOT_COMPLETED` | ジョブが未完了（Inference/Export等の前提） | 400 |
| `VALIDATION_ERROR` | Config バリデーション失敗 | 422 |
| `FILE_INVALID` | ファイルの読み込み失敗 | 400 |
| `PATH_NOT_FOUND` | 指定されたローカルパスが存在しない | 400 |
| `BACKEND_ERROR` | バックエンドライブラリの内部エラー | 500 |
| `INTERNAL_ERROR` | 予期しないエラー | 500 |

### 6.2 バックエンドエラーの伝播

バックエンドライブラリのエラー（例: LizyML の `LizyMLError`）は `BACKEND_ERROR` として返す。`details` に元のエラー情報を含める。

### 6.3 フロントエンドのエラー表示

- API エラーは Toast（sonner）で画面上部に表示
- バリデーションエラーはフォームフィールドにインラインで表示
- WebSocket の error メッセージは Training 画面のログに表示

---

## 7. フロントエンド設計

### 7.1 状態管理

React の `useState` / `useReducer` をページ単位で使用する。
グローバル状態（セッションステータス）は Context で共有する。

外部状態管理ライブラリ（Redux, Zustand 等）は初期段階では導入しない。
複雑化した場合に HISTORY.md で提案の上で導入を検討する。

### 7.2 API クライアント

`frontend/src/api/client.ts` に共通 fetch ラッパーを配置。
各ドメインの API 関数は `frontend/src/api/` 配下にファイル分割する。

```
frontend/src/api/
├── client.ts          # 共通 fetch ラッパー + エラーハンドリング
├── workspace.ts       # Workspace API (config, data, fit)
├── jobs.ts            # Jobs API
├── inference.ts       # Inference API
└── websocket.ts       # WebSocket クライアント
```

### 7.3 Plotly 連携

- バックエンドは Adapter 経由で `PlotData` (Plotly JSON) を取得して返す
- フロントエンドは `react-plotly.js` の `<Plot>` コンポーネントで表示
- 軽量化のため `plotly.js-dist-min` を使用

---

## 8. テスト戦略

### 8.1 バックエンド

| レベル | 対象 | ツール |
|--------|------|--------|
| Unit | Service 層の個別メソッド | pytest |
| API | 各エンドポイントのリクエスト/レスポンス | pytest + httpx (TestClient) |
| Integration | LizyML との統合動作 | pytest (実際の LizyML 呼び出し) |

### 8.2 フロントエンド

初期段階ではフロントエンドの自動テストは設けない。
バックエンド API テストでカバーし、フロントエンドは手動確認とする。
必要に応じて HISTORY.md で提案の上で Vitest / Playwright を導入する。

---

## 9. ビルドと配布

### 9.1 開発時

```
Terminal 1: uv run lizystudio --reload      (FastAPI, port 8501)
Terminal 2: cd frontend && pnpm dev         (Vite dev, port 5173, proxy → 8501)
```

- フロントエンド開発は Vite の HMR で即時反映
- API 呼び出しは Vite の proxy で FastAPI に転送

### 9.2 プロダクションビルド

```bash
cd frontend && pnpm build    # → src/lizystudio/static/ に出力
uv build                     # → dist/ に wheel を生成
```

- `pnpm build` で Vite がフロントエンドをビルドし `src/lizystudio/static/` に配置
- `hatchling` が `artifacts = ["src/lizystudio/static/**"]` で wheel に含める
- `pip install lizystudio` 後、`lizystudio` コマンドで FastAPI が静的ファイルも配信

### 9.3 PyPI 配布

- 単一パッケージ `lizystudio` として配布
- ビルド済みフロントエンドを含む（ユーザーに Node.js 不要）

---

## 10. ディレクトリ構成

```
LizyStudio/
├── pyproject.toml
├── uv.lock
├── CLAUDE.md
├── BLUEPRINT.md
├── PLAN.md
├── HISTORY.md
├── README.md
├── frontend/
│   ├── package.json
│   ├── pnpm-lock.yaml
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── postcss.config.cjs
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── plotly.d.ts
│       ├── api/
│       │   ├── client.ts
│       │   ├── workspace.ts
│       │   ├── jobs.ts
│       │   ├── inference.ts
│       │   └── websocket.ts
│       ├── components/
│       │   ├── Sidebar.tsx
│       │   ├── Plot.tsx
│       │   ├── DataSourceInput.tsx    # パス入力 + アップロード共通コンポーネント
│       │   ├── ConfigEditor.tsx       # Config編集モーダル/ドロワー
│       │   ├── MetricsTable.tsx       # メトリクステーブル共通
│       │   ├── PlotViewer.tsx         # プロットセレクタ + 表示共通
│       │   └── ExportDialog.tsx       # Exportダイアログ共通
│       └── pages/
│           ├── WorkspacePage.tsx       # 3パネル: Data / Model / Results
│           ├── JobsPage.tsx           # ジョブ一覧 + 詳細
│           └── InferencePage.tsx      # 2パネル: Setup / Results
├── src/lizystudio/
│   ├── __init__.py
│   ├── __main__.py
│   ├── _version.py
│   ├── cli.py
│   ├── server.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── workspace.py       # Workspace API (config, data, fit)
│   │   ├── jobs.py            # Jobs API
│   │   └── inference.py       # Inference API
│   ├── services/
│   │   ├── __init__.py
│   │   ├── workspace.py       # Workspace 揮発状態管理
│   │   ├── jobs.py            # Job ライフサイクル + ディスク永続化
│   │   └── inference.py       # 推論実行
│   ├── backends/
│   │   ├── __init__.py
│   │   ├── base.py            # BackendAdapter Protocol
│   │   ├── types.py           # 共通型 (FitSummary, PlotData, DataRef 等)
│   │   ├── registry.py        # Adapter 登録・取得
│   │   └── lizyml.py          # LizyML Adapter 実装
│   └── ws/
│       ├── __init__.py
│       └── jobs.py            # ジョブ進捗 WebSocket
├── tests/
│   ├── __init__.py
│   ├── test_api_workspace.py
│   ├── test_api_jobs.py
│   ├── test_api_inference.py
│   ├── test_services_jobs.py
│   └── test_backends_lizyml.py
└── .ai_settings/skills/
    ├── api-design/
    ├── backend-adapter/         # Adapter 実装手順
    ├── frontend-pages/
    ├── frontend-components/
    ├── services/
    ├── state-management/
    ├── build-and-deploy/
    ├── testing/
    ├── history-proposals/
    ├── git-workflow/
    ├── dev-environment/
    └── release/
```
