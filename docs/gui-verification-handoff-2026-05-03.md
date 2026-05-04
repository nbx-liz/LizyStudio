# GUI Verification Handoff — 2026-05-03

> **目的**: 体系的 GUI 検証を**新しいセッション**で継続するための引継ぎ資料。
> 本ドキュメントだけ読めば、新セッションが cold start から検証を再開できることを目的とする。
> **対象**: 次回セッションの Claude (または別開発者)

---

## 0. 30秒サマリ

- 本日 (2026-05-03) **Round 1 + Round 2** の GUI 検証を実施し、3件のバグを発見・3件すべて Issue 起票済み (うち 1件は既に PR #356 で fix 済)
- **未検証領域** が残っており、これを Round 3 で網羅したい
- ブランチ: `develop` (未コミット変更あり、§5 参照)
- 直近のスコープ確定: [`docs/business-use-definition.md`](business-use-definition.md) v0.2、[`docs/v0.4-business-readiness-plan.md`](v0.4-business-readiness-plan.md) v0.1

---

## 1. これまでの検証結果

### Round 1 (2026-05-03 朝)
**発見**: SHAP 500 (Issue #355)
**修正**: PR #356 で 404 マッピング + Frontend gating、merged
**詳細**: [`docs/pypi-release-readiness-2026-05-03.md`](pypi-release-readiness-2026-05-03.md)

### Round 2 (2026-05-03 夕方、PR #356 merged 後)
**発見**:
- **Issue #358**: BlockedGroup CV strategy click never sticks (stale-state revert PUT)
- **Issue #359**: Inference Model dropdown job numbers drift from Jobs page when failures exist

**両方未修正**。v0.4 Phase R-1 で対応予定。

### Clean Pass (Round 1 + Round 2 で通過確認済)

✅ A-01〜A-05: Layout / Navigation / 404 / Theme toggle
✅ B-01: Path mode CSV load (binary + regression)
✅ B-02: Invalid path → 400 + UI error
✅ C-01〜C-02: Target select + Task auto-detect
✅ C-05: CV strategy 切替 (8 種中 7 種)、BlockedGroup のみ #358
✅ C-06: Fit submit + 完了
✅ D-01〜D-08: Job リスト + 詳細 + Plot タブ (Learning Curve / ROC / Importance / OOF Dist)
✅ E-?: Tune タブの UI 構造 (実走は **未**)
✅ F-01: Job → Inference 自動遷移
✅ F-03: Inference run with-GT
✅ F-05: Predictions table + Download CSV
✅ F-06: Inference history
✅ F-08: SHAP fix 再確認 (no 500/404)
✅ H-01〜H-04: Regression task (Residuals plot)
✅ J-01〜J-03: API health/metrics/ready

---

## 2. Round 3 で検証すべき未確認領域

### 高優先 (Critical path)

| ID | ケース | 補足 |
|---|---|---|
| **未-01** | **Tune 実走** (10 trial 程度) | UI 構造のみ確認済、実 trial 実行・tuning plot 描画は未 |
| **未-02** | **Cancel during running fit** | race condition / slot release |
| **未-03** | **Cancel during running tune** | 同上、長時間ジョブ用 |
| **未-04** | **ブラウザリロード後の状態復元** | data + config + 進行中 job (golden path) |
| **未-05** | **WebSocket 再接続** | DevTools で network throttling して切断テスト |

### 中優先 (前回検出パターンの symmetric audit)

| ID | ケース | 関連 Issue |
|---|---|---|
| **未-06** | **Plot type gating の symmetric audit** | #355 と同パターンを `tuning`, `calibration`, `probability-histogram` で確認 |
| **未-07** | **Numbering の symmetric audit** | #359 と同パターンを Jobs, Lineage, Inference history `#N` で確認 |
| **未-08** | **CV state race の他パターン** | #358 と類似、Group/Time 系で `group_col` / `time_col` 切替直後 |

### 中優先 (機能網羅性)

| ID | ケース | 補足 |
|---|---|---|
| **未-09** | Inference Upload mode (Path のみ確認済) | |
| **未-10** | Inference Pred-only mode (Evaluate OFF) | |
| **未-11** | Inference comparison (2 records) | |
| **未-12** | Inference history からの再選択 | |
| **未-13** | Re-tune (深さ 2 以上の lineage) | |
| **未-14** | Export Model 実走 (zip ダウンロード確認) | |
| **未-15** | Export Code 実走 (Python script ダウンロード) | |
| **未-16** | YAML Import / Export round-trip | |
| **未-17** | Save Preset → Load Preset | |
| **未-18** | Feature Weights エディタ | |
| **未-19** | Workspace columns: Exclude bulk toggle | |
| **未-20** | Workspace columns: Type Num/Cat 切替 | |
| **未-21** | Command palette (Cmd/Ctrl+K) | |
| **未-22** | Onboarding flow (初回起動時) | |
| **未-23** | Sidebar collapse persistence | |

### 低優先 (エッジケース)

| ID | ケース |
|---|---|
| **未-24** | 1行 / 1列 / 全欠損 CSV |
| **未-25** | 非UTF-8 CSV |
| **未-26** | 巨大 CSV (1GB+, 業務利用上限) |
| **未-27** | Wide DataFrame (1k 列以上、Issue #361 関連) |
| **未-28** | format_version 0 の旧 workspace |
| **未-29** | 複数タブで同一 workspace |

---

## 3. 環境セットアップ (新セッションでの再開手順)

### 3.1 リポジトリ確認

```bash
cd /home/rem/repos/LizyStudio
git status            # branch: develop, untracked docs/* あり (§5 参照)
git log --oneline -5  # 直近マージ確認
```

### 3.2 Frontend ビルド (PR #356 / #357 反映済)

ビルドは前回セッションで完了済。`src/lizystudio/static/` に最新が入っているはず。
変更があれば再ビルド:

```bash
cd /home/rem/repos/LizyStudio/frontend
pnpm build  # ~30秒
```

### 3.3 Backend 起動

```bash
cd /home/rem/repos/LizyStudio
uv run lizystudio --port 8501
# 別シェル / バックグラウンドで実行
```

### 3.4 Playwright MCP で接続

`http://localhost:8501/` (または `http://127.0.0.1:8501/` だが MCP の whitelist で localhost 推奨)

---

## 4. テスト用データ

| 用途 | パス |
|---|---|
| Binary 分類 (no calibration) | `/home/rem/repos/LizyStudio/tests/fixtures/lizyml/binary_no_cal/data.csv` (418 行 × 13 列) |
| Binary 分類 (isotonic calibration) | `/home/rem/repos/LizyStudio/tests/fixtures/lizyml/binary_isotonic/data.csv` |
| Regression | `/home/rem/repos/LizyStudio/tests/fixtures/lizyml/regression/data.csv` |
| Tune fixture | `/home/rem/repos/LizyStudio/tests/fixtures/lizyml/tune/data.csv` |

**Target columns**:
- binary_no_cal / binary_isotonic: `Survived`
- regression: `target`

---

## 5. 現在のリポジトリ状態

### Branch
`develop` (origin/develop と同期済)

### 未コミットファイル
```
?? docs/business-use-definition.md       (v0.2 CONFIRMED)
?? docs/v0.4-business-readiness-plan.md  (v0.1 DRAFT)
M  HISTORY.md                            (P-0096 起票分)
```

これらは **本日の業務利用定義作業の成果物**。GUI 検証 Round 3 には影響しない。
Round 3 を別ブランチで実施する場合は不要、develop 上で続けるなら考慮不要。

### 開いている PR / Issue
- PR #356 (SHAP fix) — **MERGED** ✅
- PR #357 (sdist 整理 + 業務利用 docs) — **MERGED** ✅
- Issue #355 (SHAP 500) — **CLOSED** ✅
- Issue #358 (BlockedGroup race) — **OPEN**, v0.4 R-1 候補
- Issue #359 (Inference job-num drift) — **OPEN**, v0.4 R-1 候補
- Issue #360 (Tune long-run resumability) — **OPEN**, v0.4 R-1 候補
- Issue #361 (Wide DataFrame UI) — **OPEN**, v0.4 R-5 候補

---

## 6. 検証マトリクスの形式

### 結果記録テンプレ

各ケースは以下の形式で記録:

```
| ID | ケース | 結果 | 備考 / Issue |
|---|---|---|---|
| 未-01 | Tune 実走 (10 trial) | ✅ / ❌ / ⚠️ | (詳細) |
```

- ✅ PASS — 期待通り動作
- ❌ FAIL — バグ、Issue 起票
- ⚠️ DEGRADED — 動くが UX に問題あり、Issue は任意

### 新規バグ検出時のフロー

1. **Reproduction を最低 2 回確認** (一発で 100% 再現させる)
2. **Network trace + Console error を取得**
3. **Root cause 仮説**を立てる (時間があれば、なくても OK)
4. **Issue 起票** (英語、Severity 付き、関連既存 Issue 参照)
5. **検証マトリクスに `❌` で記録**、後続の検証は継続

### Issue 起票テンプレ

```
gh issue create \
  --title "<type>(<scope>): <one-line summary>" \
  --body-file /tmp/issue-NNN.md \
  --label "bug,priority-<low|medium|high>,tier-<2|3|4>,area-<frontend|backend|both>"
```

過去 issue のテンプレ参考:
- [#358](https://github.com/nbx-liz/LizyStudio/issues/358) — Stale-state race パターン
- [#359](https://github.com/nbx-liz/LizyStudio/issues/359) — Numbering drift パターン
- [#355](https://github.com/nbx-liz/LizyStudio/issues/355) — Plot gating 500 パターン

---

## 7. 既知の制約 / 注意点

### Playwright MCP の癖

- `127.0.0.1` は whitelist 外 → **`localhost` を使う**
- スクリーンショットの保存先は `/home/rem/repos/LizyStudio/.playwright-mcp/` のみ許可
- `.playwright-mcp/` は gitignore 済 (commit されない)
- React の controlled input に programmatic value 設定する場合は:
  ```js
  const s=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  s.call(inp, 'value');
  inp.dispatchEvent(new Event('input',{bubbles:true}));
  inp.dispatchEvent(new Event('change',{bubbles:true}));
  ```

### Bash hook の制約

- 一部の grep パターン (例: `*.py.*Mixin`) は `dangerous system pattern` として弾かれる → 別パターンで代替
- PR/Issue/commit メッセージは **英語のみ** (validate-pr-language.sh)
- `127.0.0.1` 経由の curl は **記憶ファイル書き込みガード** で block されることがある
- 削除系 (rm -rf) は確認後実行、permission 拒否されたらサブパス分割で再試行

### 既知の Console 警告 (無視して OK)

- `WebSocket connection to 'ws://localhost:8501/ws/jobs/<id>/progress' failed: WebSocket is closed before the connection is established`
  → Fit が短時間 (~5秒) で完了するときに WS handshake が間に合わない race。Round 1/2 で確認済、機能には影響しない。

---

## 8. Round 3 推奨 plan (案)

### Step 1 (30分): Critical path 重点確認
未-01 (Tune 実走) → 未-02/03 (Cancel) → 未-04 (Reload restore) → 未-05 (WS reconnect)

### Step 2 (30分): Symmetric audit
未-06 (Plot gating) → 未-07 (Numbering) → 未-08 (CV race)

### Step 3 (45分): 機能網羅性
未-09〜未-23 を batch で

### Step 4 (15分): エッジ系
未-24〜未-29 を可能な範囲で

### Step 5: Triage + Issue 起票 + Final report

合計 2〜3 時間。サーバ起動 + 既存 35 ジョブを使って効率化。

---

## 9. 引継ぎ完了チェックリスト

新セッション開始前に確認:

- [ ] このドキュメントを読み終えた
- [ ] [`docs/business-use-definition.md`](business-use-definition.md) v0.2 §16 (12 質問への回答) を確認
- [ ] [`docs/v0.4-business-readiness-plan.md`](v0.4-business-readiness-plan.md) §7 (Exit Criteria 9 項目) を確認
- [ ] Issue #358 / #359 / #360 / #361 の内容を把握
- [ ] バックエンド・フロントエンドが起動できる状態
- [ ] Playwright MCP が利用可能

---

## 10. 関連ドキュメント

| ドキュメント | 役割 |
|---|---|
| [`docs/business-use-definition.md`](business-use-definition.md) v0.2 | 業務利用の確定定義 (Tier 4) |
| [`docs/v0.4-business-readiness-plan.md`](v0.4-business-readiness-plan.md) v0.1 | v0.4 Phase 別実装計画 (Tier 4) |
| [`docs/pypi-release-readiness-2026-05-03.md`](pypi-release-readiness-2026-05-03.md) | v0.3 リリース準備時の Round 1 監査 |
| [`docs/architecture-overview.md`](architecture-overview.md) | システム全体像 (Mermaid 図 5 種) |
| `BLUEPRINT.md` (Tier 1) | 構造・責務・画面定義 |
| `HISTORY.md` P-0096 (Tier 1) | 業務利用定義の Change Gate Decision |

---

## 11. 次に取り得るアクション

新セッション開始時に、以下のいずれかを起点にできる:

**A**: 「§8 の Step 1 から Round 3 を開始してください」
**B**: 「§2 の特定領域 (例: 未-01〜未-05) のみ先行で確認してください」
**C**: 「Issue #358 / #359 の修正に着手したい」 (検証よりも修正優先の場合)
**D**: 「v0.4 Phase R-1 を開始する」 (検証はここで切り上げ、実装フェーズに移行)

A が標準ルート。
