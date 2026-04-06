# Analysis Reports

python-analyst と lizystudio-analyst による比較分析レポートの保管場所。

## ディレクトリ構造

```
analysis/
├── reports/
│   └── {YYYY-MM-DD}_{dataset}/
│       ├── python-analyst.md          # Python 分析レポート
│       ├── lizystudio-analyst.md      # LizyStudio API 分析レポート
│       ├── comparison.md              # 差分サマリー
│       └── metadata.json              # 実行メタデータ
└── gaps/
    ├── gap-registry.md                # 全ギャップの一覧・ステータス
    └── proposals/                     # HISTORY.md Proposal の草案
```

## 命名規則

- ディレクトリ: `{YYYY-MM-DD}_{dataset-name}` (例: `2026-03-31_breast-cancer`)
- 同日複数回: `{YYYY-MM-DD}_{dataset-name}_v2`

## metadata.json の形式

```json
{
  "date": "2026-03-31",
  "dataset": "breast-cancer",
  "data_path": "data/breast-cancer/",
  "agents": ["python-analyst", "lizystudio-analyst"],
  "gaps_found": 15,
  "ux_proposals": 12
}
```
