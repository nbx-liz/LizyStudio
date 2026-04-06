# Gap Registry

lizystudio-analyst による比較分析で発見された機能ギャップと UX 改善提案の一覧。

## ステータス凡例

- `open`: 未着手
- `in-progress`: 実装中
- `resolved`: 解決済み
- `wontfix`: 対応しない（理由を備考に記載）

---

## 機能ギャップ (FG)

| ID | 内容 | 重要度 | Phase | Proposal | ステータス | 備考 |
|----|------|--------|-------|----------|-----------|------|
| FG-01 | 閾値最適化・レポートなし | Critical | C-6 | H-0040 | open | FG-12 依存 |
| FG-03 | 混同行列がない | High | B | 不要 | open | BackendAdapter に既存メソッドあり |
| FG-04 | クラス別 precision/recall がない | High | C-3 | H-0037 | open | |
| FG-05 | Tune best-params 抽出・適用 API なし | High | C-1 | H-0035 | open | UX-06 と統合 |
| FG-06 | 特徴量間の相関分析がない | High | C-5 | H-0039 | open | スコープ議論要 |
| FG-09 | probability-histogram が 500 エラー | Medium | A | 不要 | open | バグ修正 |
| FG-11 | LightGBM 以外のモデル比較不可 | Medium | — | — | wontfix | BLUEPRINT §0 でスコープ外 |
| FG-12 | 推論時閾値制御パラメータなし | High | C-2 | H-0036 | open | |

## UX 改善提案 (UX)

| ID | 内容 | 重要度 | Phase | Proposal | ステータス | 備考 |
|----|------|--------|-------|----------|-----------|------|
| UX-01 | ファイルパスエラーメッセージが不親切 | High | A | 不要 | open | |
| UX-02 | POST /config/validate ドキュメント不一致 | High | A | 不要 | open | |
| UX-03 | Tuning search space スキーマ未ドキュメント | High | A | 不要 | open | |
| UX-04 | Inference API ドキュメント不一致 | Critical | A | 不要 | open | data_path vs data.source_type |
| UX-05 | Job progress が常に 0% | Critical | A | 不要 | open | WebSocket 関連 |
| UX-06 | Tune→Fit ワークフロー断絶 | High | C-1 | H-0035 | open | FG-05 と統合 |
| UX-07 | ターゲット自動検出なし | Medium | B | 不要 | open | フロントエンドのみ |
| UX-08 | Split summary にクラス分布なし | Medium | C-4 | H-0038 | open | |
| UX-11 | 閾値キャリブレーション警告なし | High | B | 不要 | open | フロントエンドのみ |

## 発見日

- 初回発見: 2026-03-31（breast-cancer データセット）
