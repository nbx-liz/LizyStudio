# 業務利用の定義 — v0.2 (CONFIRMED)

> **Status**: ✅ **CONFIRMED v0.2** (ユーザ承認済み 2026-05-03)
> **目的**: v0.4 / v0.5 の Exit Criteria を「業務利用可能」と定義するに先立ち、その中身をユーザと合意した結果を記録する。
> **次のステップ**: 本ドキュメントを Tier 4 (アクティブな個別計画) として固定し、`HISTORY.md` に Proposal P-0096 として Change Gate を通す。確定事項は `PLAN.md` v0.4 / v0.5 セクションに反映する。
> **改訂履歴**: §18 を参照。

---

## 0. 確定したサマリ (Decision Sheet)

| 項目 | 確定内容 |
|---|---|
| 利用シナリオ | **A. 単独データサイエンティストが個人 PC で繰り返し使う** (Q1) |
| 同時利用人数 | **1名** (§7, Q3) — マルチタブ衝突制御は不要 |
| データ規模 (上限) | **1000万行 × 1万列 × 100GB** (Q2) |
| データ規模 (典型) | **100万行未満 × 数百〜数千列** (§4) |
| データ機密度 | **社外秘** (Q4) — ユーザ環境側で担保、LizyStudio は補助しない |
| デプロイ | **個人PC / 社内Linuxサーバ / Docker / クラウド** (Q5) |
| 自動化 | **インタラクティブのみ** (Q6) — scheduler/通知は範囲外 |
| 失敗許容度 | **長時間 Tune (24h) でも resume できること** (§8, 確認C) |
| 互換性 | format_version 後方互換、Pickle は同 minor 版内のみ保証 (§12) |
| 商用サポート | **なし** (Q7) |
| 顧客提供予定 | **なし** (Q8) |
| 業務利用 KPI | **問題なくモデル開発を行い、Export Code ができている** (Q9) |

---

## 1. プロジェクトの位置づけ

### 確定内容
LizyStudio は **「ML 実務者の作業を1段階速くする内製ツール」** である。SaaS でも顧客向けプロダクトでもない。**作業者が自分用のサーバーを立ち上げて、自分のために使う**形態を想定する。

### 含意
- マルチテナント設計は v1.0 まで不要
- 課金・利用量計測は範囲外
- ホストする責任は配布元ではなくユーザ側

---

## 2. ユーザペルソナ

### 確定内容
**Primary persona**: データサイエンティスト / ML エンジニア。**経験年数1年程度の初学者も含む**が、ライブラリのパラメータは**自分で調査して理解する前提**。

**フォローしないもの**:
- 完全な ML 初心者向けのチュートリアル機能
- 「ドラッグ&ドロップで誰でも使える」UX

### 含意
- 操作のヒント・チュートリアルは「ML を一通りやった人」向けで十分
- エラーメッセージは技術用語 OK (`Pydantic ValidationError` 等を見せて良い)
- 「業務担当者用の簡易ビュー」は範囲外

---

## 3. デプロイ形態

### 確定内容
**主たる形態**:
1. **個人 PC**: `pip install lizystudio` してローカル起動
2. **社内共有 Linux サーバ**: 部署のサーバに 1 インスタンス、自分専用に使う
3. **Docker** (v0.5 提供): 同じ image を個人/社内/クラウドで使い回す
4. **クラウド** (AWS/GCP/Azure): VM に直接インストール、または Docker で動かす

**範囲外**:
- マネージド SaaS (lizystudio.com みたいなホスティング)
- Kubernetes での水平スケール (single-pod のみ)
- サーバレス

### 含意
- v0.5 で Docker 公式イメージを GitHub Container Registry に publish
- HTTPS / 認証は配置側の責任 (リバースプロキシ前段で対応想定)
- バックアップは workspace ディレクトリ単位の tar で十分

---

## 4. データの性質

### 確定内容
- **データの出所**: 社内データ (販売実績・顧客属性・製造ログ・センサー時系列等)
- **機密性**: 社外秘・営業秘密を含み得る (詳細は §10)
- **規模**:
  - **典型**: 100万行未満 × 数百〜数千列
  - **上限**: 1000万行 × 1万列 × 100GB (Q2)
- **形式**: ローカルファイル (CSV / Parquet) 中心
- **DB 接続**: 想定なし (将来ニーズが多くなれば検討)
- **頻度**: 静的データの分析が中心、streaming は範囲外

### スケーリング戦略 — Bring Your Own RAM (BYO RAM)

LizyStudio はチャンク読み・サンプリング・out-of-core 学習などの**複雑な仕掛けは実装しない**。データ規模に応じて**マシンスペックを増強する**前提で運用する。

| データ規模 | 推奨 RAM | 推奨ストレージ | 想定 SLO |
|---|---|---|---|
| 〜 100MB | 8 GB | SSD | 全機能サクサク |
| 〜 1 GB | 16 GB | SSD | Fit 5 分以内 |
| 〜 10 GB | 64 GB | NVMe SSD | Fit 30 分以内 |
| 〜 100 GB | 200 GB+ | NVMe SSD | Fit 数時間、I/O 律速可 |

### 含意
- v0.4 は **1 GB データを 16 GB RAM で完走** を SLO 基準点に置く
- 100 GB は best-effort ではなく **「適切なハードウェアで完走する」** を保証 (高 RAM サーバを前提)
- v0.5 で `docs/hardware-sizing.md` を整備
- DB connector 系は **v1.0 以降の検討事項**
- セキュリティ要件は「社内ネットワーク内」を前提、ゼロトラスト前提ではない

---

## 5. ワークフローの性質

### 確定内容
**典型的な使い方**:

```
朝、データを更新
  ↓
Workspace でデータをロード、target を決める
  ↓
Fit を 5〜10回回しながらパラメータ調整
  ↓
Tune で 30〜100 trial 回す (10〜30分、長時間なら数時間〜1日)
  ↓
良い結果を Inference に乗せて検証
  ↓
Export Code で Python スクリプト化、別環境で運用
```

**期間感**:
- 1モデルの調整: 1日 〜 2週間
- 完成したモデルの運用: 数ヶ月 〜 1年
- LizyStudio はモデル**作成期間中**のメインツール、運用フェーズでは Export Code 後の Python スクリプトが主役

### 含意
- 「Fit を 1日 50 回」が捌ける UX (履歴管理、比較、削除しやすさ)
- 「2週間前の Fit を見返せる」永続性
- 「1モデルが本番運用でずっと使われる」前提なので、 Pickle 互換切れは超 重大インシデント

---

## 6. 自動化の範囲

### 確定内容
**LizyStudio の責務**: モデルの検証と、モデルを再現できるスクリプト (Export Code) の生成まで。
**それ以降**: ユーザ側で別システムに組み込む。

**含む**:
- API 経由で別スクリプトから fit を kick (現状もそう)
- Export Code で生成した Python を CI / cron で自動実行
- 推論バッチを REST API 経由で呼ぶ

**含まない**:
- LizyStudio 自身が cron で fit を回す機能 (= scheduler 内蔵)
- 完了通知 (Slack / Email)
- パイプライン定義 (DAG, Airflow 連携)

### 含意
- v0.4-0.5 で「自動化フレンドリーな API」(idempotent, well-documented) は提供
- スケジューラ・通知系は v1.0 以降に検討
- ETL パイプライン連携は範囲外

---

## 7. 並行性 (Concurrency)

### 確定内容
**1 サーバインスタンスに対して**:
- 同時アクセスユーザ: **1名**
- 1 ユーザあたりタブ数: 1〜2 (Workspace + Jobs を同時に開く程度)
- 同時実行 fit/tune: **1 並列で十分** (subprocess 1スロット)、複数並列は不要 (計算機スペック制約)

**保証する不変量**:
- 同一ユーザの複数タブで状態が破綻しないこと
- 後勝ち書き込みを許容 (衝突検出は不要)

### 含意 (前バージョンから縮小)
- ✅ 同一ユーザの複数タブ整合性は維持
- ❌ 「他タブが workspace を変更しました」UI は **v0.4 から削除** (1名利用なので発生しない)
- ❌ ETag/version による衝突検出は **v0.4 から削除**
- ❌ ジョブキュー (queue 1〜N) は **不要**
- 範囲外: SSE 多人数同時編集、CRDT、リアルタイム協調

---

## 8. 失敗許容度 (Resilience SLO)

### 確定内容

| 失敗カテゴリ | 許容度 | 業務影響 |
|---|---|---|
| データ消失 (workspace の data + config) | **絶対 NG** | 30 分の作業が消えれば信頼を失う |
| 完了ジョブの artefact 消失 | **絶対 NG** | 過去のモデルで再現できなくなる |
| **進行中ジョブのクラッシュ (短時間 Fit)** | **ギリギリ許容** (リトライできれば) | リトライできれば事故ではない |
| **進行中ジョブのクラッシュ (長時間 Tune, 数時間〜1日)** | **NG** | 1 日の作業が消えるのは業務的に許容できない |
| 起動失敗 | NG | ユーザは server 管理者ではない |
| エラー発生 | OK (ただし復旧経路が見えること) | 復旧できれば事故ではない |
| 平日業務時間内 10分超ダウン | NG | 仕事が止まる |
| 平日業務時間外ダウン | 許容 | 翌朝起きていれば良い |

### v0.4 Exit Criteria への昇格

長時間 Tune の resume を **v0.4 必須項目** とする (確認C 合意):

- 任意の終了経路 (SIGKILL / WS切断 / サーバ再起動 / ブラウザ閉じる) で Tune が **resume 可能**
- 完了済 trial は再実行しない
- 24時間 Tune が中断されても、resume で次の trial から続行できる

### 含意
- v0.4 R-1 phase: slot release invariant の網羅検証は維持
- v0.4 R-1 phase: **Tune long-run resumability を必須化** (新規)
- v0.4 R-2 phase: WS reconnect は必須 (= 業務時間中のネット瞬断で作業ロストはNG)
- v0.5 で 30日連続稼働テスト・99.5% 稼働率を Exit Criteria に置く

---

## 9. データ保持・永続性

### 確定内容
- workspace 単位の data + config + jobs 全てがローカル file system に永続化
- ジョブ削除はユーザ明示操作のみ (auto-prune は無し)
- 過去ジョブは **無限に残る前提** (ユーザの自発的管理に任せる)
- バックアップ: ユーザ自身が `~/.lizystudio/` を tar で取る前提 (v0.5 で公式 CLI 提供)

### 含意
- v0.4 で diagnostic export endpoint を提供 (個別 job の調査用)
- v0.5 で公式 backup / restore CLI を提供
- v1.0 でも auto-archive は **不要** (ユーザ管理に任せる)

---

## 10. セキュリティ要件

### 確定内容
**Threat model**:
- **In-scope**: 同一ネットワーク内の意図しない誤操作・誤上書きの防止
- **In-scope**: 依存ライブラリの CVE 監視 (dependabot / pip-audit)
- **In-scope**: pickle 経路の path traversal / 悪意ある artefact 読み込み防止 (#67 で着手済)
- **Out of scope**: 認証 / 認可 (前段リバースプロキシで対応想定)
- **Out of scope**: 通信暗号化 (HTTPS は配置側の責任)
- **Out of scope**: 監査ログ (誰がいつ何をしたか)

**機密データ取扱い**:
- 機密度の高いデータを扱うことがあり得るが、それらの**保護はユーザ環境側で担保**する
- LizyStudio は **セキュアな環境内での実行を推奨**するが、自身では機密保護機能を提供しない

### 含意
- v0.4 P-2 で pickle hardening + path traversal 完全監査
- v0.4 で `pip-audit` / dependabot を CI gate
- 監査ログ・認証層・暗号化通信は **正式に Out of scope**
- v1.0 でも実装予定なし (ユーザ環境側で対応)

---

## 11. パフォーマンス SLO (確定)

| 操作 | p95 ターゲット | 根拠 |
|---|---|---|
| `GET /api/jobs/` (履歴 100件) | < 200 ms | UI 体感が悪化する閾値 |
| `GET /api/workspace/config` | < 100 ms | 1クリックで複数回叩かれる |
| `PUT /api/workspace/config` | < 300 ms | 連続編集時の応答性 |
| `POST /api/workspace/fit` (起動だけ) | < 500 ms | ジョブ受付の即応性 |
| Fit 完了 (1GB CSV, 100k 行 × 50列, lgbm, 16GB RAM) | < 5 min | 日常の反復に耐える |
| Fit 完了 (10GB CSV, 1M 行 × 100列, lgbm, 64GB RAM) | < 30 min | 中規模目標 |
| Fit 完了 (100GB CSV, 10M 行 × 1k列, lgbm, 200GB RAM) | < 数時間 | 上限目標 (BYO RAM) |
| WS progress 更新間隔 | < 2 sec | リアルタイム感 |
| Frontend 初期 load (Cold) | < 3 sec | 業務開始時のストレス |

### 含意
- v0.4 P-1 で Bench harness を整備し SLO 監視を Nightly CI に組み込む
- 1GB を SLO 上限基準点に置き、10GB / 100GB は対応するハードウェア前提で測る
- Frontend bundle 5.7MB → 1MB 以下に code split (v0.5)
- **1万列 Wide DataFrame** は別枠で UI 含めた検証 (Issue 別途起票)

---

## 12. 互換性ポリシー

### 確定内容

**Format Version (workspace + meta.json)**:
- マイナー版アップグレード時、過去の workspace は **必ず読める** (forward migration)
- バージョン跨ぎ migration は最大 N=3 minor 版を保証
- 古い workspace を新しい CLI が壊さない (= read のみで write しない、read-modify-write 時は format_version を上げる)

**Pickle (model artefact)**:
- 同じ lizyml minor 版で fit したモデルは LizyStudio 同 minor 版間で必ず読める
- lizyml minor バンプ時の Pickle 互換は **保証外** (ユーザ側で再 Fit 推奨)、ただし `cloudpickle` の検出ロジックで明示的にエラーにする

**Public API**:
- `/api/*` の breaking change は SemVer minor 以上、HISTORY.md に Decision 必須
- `openapi.json` を CI で diff し、未承認の変更は block

### 含意
- v0.4 R-4 で format_version migration matrix の自動化
- API breaking change は許可するが透明性を確保

---

## 13. 他システム連携 (Integration)

### 確定内容

**入力**:
| 入力源 | 現在 | v0.4 | v0.5 | v1.0+ |
|---|---|---|---|---|
| ローカル CSV / Parquet | ✅ | ✅ | ✅ | ✅ |
| Web Upload | ✅ | ✅ | ✅ | ✅ |
| S3 / GCS / Azure Blob | ❌ | ❌ | ❌ | 検討 |
| BigQuery / Snowflake / Postgres | ❌ | ❌ | ❌ | 検討 |
| Excel (.xlsx) | ❌ | ❌ | ❌ | 検討 |

**出力**:
| 形式 | 現在 | v0.4 | v0.5 |
|---|---|---|---|
| Pickle (model) | ✅ | ✅ | ✅ |
| Predictions CSV | ✅ | ✅ | ✅ |
| Python script (Export Code) | ✅ | ✅ | ✅ |
| HTML Report | ✅ | ✅ | ✅ |
| ONNX | ❌ | ❌ | ❌ |

**API**:
- REST API 経由で外部から呼べる (現状もそう)
- Webhook / イベント通知は範囲外

### 含意
- v0.4-v0.5 で connector 系は触らない
- API ドキュメント (OpenAPI) は v0.4 で「外部からも使えるレベル」に整備

---

## 14. サポート・運用モデル

### 確定内容

**一次対応** (ユーザ自身):
- `docs/troubleshooting.md` を読んで自己解決 (v0.5 で整備)
- `lizystudio diagnose` CLI で診断結果を取得 (v0.4 で提供)

**二次対応** (開発元):
- GitHub Issue で受付、SLA は best-effort
- 緊急パッチは critical bug のみ patch リリース

**運用責任**:
- サーバ起動・停止: ユーザ
- バックアップ: ユーザ (公式 CLI で支援)
- アップグレード: ユーザ (`pip install -U lizystudio`)
- 監視: ユーザ (`/api/metrics` を Prometheus でスクレイプ)

**商用サポート**: 検討していない (Q7)

### 含意
- v0.4 で `lizystudio diagnose` 相当の機能を実装
- v0.5 で `docs/operations.md` (運用 runbook) を整備
- 商用サポート tier は v1.0 でも提供しない方針

---

## 15. 範囲外 (Anti-scope) と将来余地

### v0.4 / v0.5 で確実に Out of scope
- マルチテナント SaaS、課金、テナント隔離
- リアルタイム streaming inference (online learning)
- 大規模深層学習の自前実装
- AutoML 完全自動探索 (NAS, model selection)
- データウェアハウス・データレイク連携
- BI ツール統合 (Tableau, PowerBI, Looker)
- ワークフローオーケストレーション (Airflow, Dagster)
- モバイルアプリ
- 認証・認可・SSO の組み込み (任意の前段プロキシで実現を期待)

### v0.4 / v0.5 で扱う可能性のある拡張領域

#### PyTorch backend
- **方針**: lizyml 側で PyTorch サポートが提供された後に、LizyStudio 側で `BackendAdapter` を実装する
- **依存**: lizyml の PyTorch サポート (上流次第)
- **実装スコープ (lizyml が対応した時点で)**: 既存の Adapter パターンを使って PyTorch backend を追加。GPU 対応は段階的
- **現時点では LizyStudio 単独では着手しない**

#### LLM 統合
- **方針**: 必要が出たタイミングで個別 Issue を起票して扱う
- **現時点で確定された解釈はなし** — 将来要件次第で以下のいずれかが入る可能性:
  - LLM をモデル backend として fine-tune
  - LLM で結果を解釈・要約
  - LLM で feature extraction (前処理)
  - AutoML 自動化補助
  - text data の処理経路
- v0.4 / v0.5 では **要件が明確化された段階で別途計画する**

### 含意
- 既存の `BackendAdapter` Protocol は将来の PyTorch / その他 backend 受け入れに備えて変更しない (Change Gate 対象)
- LLM 統合の Issue は本ドキュメントでは起票しない (必要時に起票)

---

## 16. 業務利用 KPI (Q9)

業務利用できているとは、以下が満たされている状態を指す:

- ユーザが**問題なくモデル開発を行える**こと
- **Export Code が機能し、生成された Python スクリプトが別環境で正しく動く**こと

これを v0.4 / v0.5 リリース時の確認項目とする:
- v0.4: 開発作業のリスク (データ消失・長時間Tune中断・Wide DataFrame 破綻) を排除
- v0.5: 周辺整備 (運用 runbook・性能 SLO 監視・診断ツール) で「事故時にチーム内で対応できる」状態へ

---

## 17. このドキュメントの取り扱い

**現在**: ✅ CONFIRMED v0.2

**次のステップ** (合意済):
1. ✅ 修正版 v0.2 を作成 (本ドキュメント)
2. 🔜 `HISTORY.md` に Proposal P-0096 として「業務利用定義の確定」を起票し Change Gate を通す
3. 🔜 `docs/release-readiness-2026-05-03.md` を改訂し、確定された定義に基づく v0.4 / v0.5 計画を作成
4. 🔜 新規 Issue 起票 (本日は 2件のみ):
   - `feat: Tune long-run resumability (24h+, all termination paths)` — Phase R-1 拡張
   - `feat: Wide DataFrame UI support (up to 10k columns)` — Phase R-5 (新設)
5. 必要が出たタイミングで以下を起票 (本日は起票しない):
   - hardware sizing docs (v0.5 着手前)
   - Large CSV scaling (実測ベンチが必要になった時点)
   - PyTorch backend (lizyml 対応後)
   - LLM 統合 (要件定義後)

**承認ルート**: `change-gate.md` の運用上、本ドキュメントは Tier 4 (アクティブな個別計画) に位置する。Tier 1 への昇格時に `HISTORY.md` に Proposal P-0096 として正式起票する。

---

## 18. 改訂履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-05-03 | Claude による初版ドラフト、各仮説を「修正欄」付きで提示 |
| **v0.2** | 2026-05-03 | ユーザ回答を取り込み確定。同時利用1名、長時間Tune resume必須、BYO RAM戦略、PyTorchはlizyml後追、LLMは要件定義後に起票 |
