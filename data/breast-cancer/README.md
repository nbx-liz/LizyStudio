# Wisconsin Breast Cancer Dataset

## 概要

乳房の Fine Needle Aspirate (FNA) 画像から計測された細胞核の特徴量に基づく、悪性/良性の二値分類データセット。

## 出典

- **元データ**: UCI Machine Learning Repository
- **取得方法**: `sklearn.datasets.load_breast_cancer()`
- **論文**: W.N. Street, W.H. Wolberg, O.L. Mangasarian (1993). Nuclear feature extraction for breast tumor diagnosis.

## ビジネスコンテキスト

- **ステークホルダー**: 病院放射線科
- **意思決定**: FNA結果に基づく「要精密検査」vs「経過観察」の振り分け
- **現行ベースライン**: 放射線科医の手動分類 約85%精度
- **年間患者数**: 約2,000人
- **コスト構造**: FN（見逃し）= $200K+、FP（不要生検）= $5K

## データ仕様

- **行数**: 569
- **特徴量**: 30列（mean/error/worst × 10種類の細胞核計測値）
- **ターゲット**: `diagnosis` (0=malignant, 1=benign)
- **クラス分布**: Malignant 212 (37.3%), Benign 357 (62.7%)
- **欠損値**: なし

## 再現手順

```python
from sklearn.datasets import load_breast_cancer
import pandas as pd

data = load_breast_cancer()
df = pd.DataFrame(data.data, columns=data.feature_names)
df['diagnosis'] = data.target
df.to_csv('breast_cancer.csv', index=False)
```
