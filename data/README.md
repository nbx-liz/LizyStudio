# Analysis Datasets

分析エージェントが使用するデータセットの管理場所。

## ディレクトリ構造

```
data/
└── {dataset-name}/
    ├── {file}.csv                # データ本体（.gitignore で除外）
    ├── README.md                 # メタデータ: カラム説明、出典、ビジネスコンテキスト
    └── schema.json               # 機械可読スキーマ
```

## データファイルについて

データファイル（CSV, Parquet, pkl 等）は `.gitignore` で除外されています。
データを取得するには各データセットの `README.md` に記載の手順に従ってください。

## schema.json の形式

```json
{
  "name": "dataset-name",
  "source": "URL or description",
  "rows": 569,
  "columns": [
    {
      "name": "column_name",
      "type": "numeric|categorical|target",
      "description": "Column description"
    }
  ]
}
```

## データ追加手順

1. `data/{dataset-name}/` ディレクトリを作成
2. データファイルを配置
3. `README.md` を作成（出典、カラム説明、ビジネスコンテキスト）
4. `schema.json` を作成（機械可読メタデータ）
