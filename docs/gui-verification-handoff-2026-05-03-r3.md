# GUI Verification Round 3 + Bug Fix Session — Handoff (2026-05-03)

> **目的**: Round 3 検証 + 当日発見した bug の修正サイクルの引継ぎ。残作業を新セッションで再開するため。
> **対象**: 次回セッションの Claude (または別開発者)

---

## 0. 30 秒サマリ

- **Round 3 検証完了** (Step 1〜4 のうち高優先項目はすべて完了)
- **8 件の PR を着手** (うち 5 件マージ済 / 1 件 CI 待ち / 2 件 deferred)
- **3 件の新規 Issue 起票** (#369/#370/#373)
- **次セッションは PR #372 マージ確認 → Issue #373 着手 → Round 3 残項目 が起点**

---

## 1. 当日マージ済 PR (develop に取り込まれた変更)

| PR | Issue | タイトル | Status |
|---|---|---|---|
| **#365** | #364 | `fix(metrics): derive oos_std from oof_per_fold when oof_std absent` | ✅ MERGED |
| **#366** | #359 | `fix(inference): derive dropdown #N from allJobs not completedJobs` | ✅ MERGED |
| **#367** | #363 | `fix(workspace): hydrate Data Panel from server-persisted state on reload` | ✅ MERGED |
| **#368** | #358 | `fix(workspace): latch user-picked CV strategy against stale cache reverts` (latch + 2s TTL) | ✅ MERGED |
| **#371** | #370 | `fix(inference): use probability-histogram + gate distribution panel on availability` | ✅ MERGED |

`develop` HEAD: `3c67d18` (= `#371` 直後)。

---

## 2. CI 進行中 / 未マージ PR

| PR | 内容 | 状態 |
|---|---|---|
| **#372** | `fix(workspace): replace Load Preset Select with menu-driven popover (#369)` | **BLOCKED** (e2e-chromium IN_PROGRESS) — auto-merge 設定済 |

#372 の経緯:
- 初回の e2e-chromium で `workspace-presets.spec.ts` が古い Select API を使っていて FAIL
- フォローアップ commit `e3e35b8 test(e2e): update Load Preset interaction to menu trigger + menuitem` で対応
- さらに `5e70239 Merge branch 'develop' into ...` で develop の #371 を取り込み
- 現在再走行中の e2e が green になり次第 auto-merge

**新セッションで最初に確認すべきコマンド**:
```bash
gh pr view 372 --json mergedAt,mergeStateStatus --jq '{merged: .mergedAt, state: .mergeStateStatus}'
```
- `merged: <timestamp>` ならマージ済み → そのまま進む
- `state: BLOCKED` で CI 走行中なら待つ
- `state: CI_FAILED` ならログを確認 (`gh run view <run-id> --log-failed`)

---

## 3. 当日起票した新規 Issue (deferred)

| Issue | タイトル | Severity | Notes |
|---|---|---|---|
| **#369** | `fix(workspace): Load Preset combobox cannot re-apply the currently selected preset` | medium | **PR #372 で対応中** (CI 待ち) |
| **#370** | `fix(inference): UI requests non-existent plot type 'prediction-distribution'` | medium | **PR #371 で対応済 (マージ済)** |
| **#373** | `fix(inference): SHAP Summary accordion is permanently hidden -- backend never advertises 'shap-summary' plot` | low-medium | **defer** — backend (lizyml) に `shap-summary` plot を追加する必要があり、frontend だけでは閉じない |

---

## 4. Round 3 検証カバレッジ

### Step 1 Critical path (5/5 ✅)
- 未-01 Tune 実走 → ✅ (Std=NaN は #364 経由で fix)
- 未-02 Cancel during fit → ✅
- 未-03 Cancel during tune → ✅
- 未-04 Reload state restoration → ✅ (#363 経由で fix)
- 未-05 WebSocket reconnect → ✅ (3 回切断後も自動再接続)

### Step 2 Symmetric audit (3/3 ✅)
- 未-06 Plot type gating → ✅ jobs.py + inference.py 両方とも `_BackendPlotNotAvailable` → 404 で正しく扱う (post #356)
- 未-07 Numbering drift → ✅ JobList / JobsPage / ResultsPanel は OK、SetupPanel / InferencePage が drift → #366 で fix
- 未-08 CV col race → ✅ GroupKFold + group_col / rapid switch も race 観測されず

### Step 3 Functional coverage (11 done)
| ID | 結果 | 備考 |
|---|---|---|
| 未-10 | ✅ | Inference Pred-only mode (Evaluate OFF) |
| 未-12 | ✅ | History 再選択 |
| 未-13 | ✅ | Re-tune depth-2 lineage (root → child → grandchild) |
| 未-14 | ✅ | Export Model (4-file artifact) |
| 未-15 | ✅ | Export Code (zip with train.py / predict.py / requirements / artifacts) |
| 未-16 | ✅ | YAML Export (group_col 等が正しく書き出される) |
| 未-17 | ✅ Save / ❌ Load | Save は OK、Load Preset 同 preset 再適用は #369 で fix |
| 未-19 | ⚠️ | Bulk Exclude toggle 未実装 (#361 acceptance criteria に含まれる) |
| 未-20 | ✅ | Type Num/Cat 切替 (Pclass Cat→Num が server に反映) |
| 未-21 | ✅ | Cmd/Ctrl+K Command Palette |
| 未-23 | ✅ | Sidebar collapse persistence (`sidebar-collapsed: true`) |

### Step 4 Edge cases (1 done)
- 未-24 1-row / all-NaN CSV → ✅ part PASS (load 通過、fit-time validation は backend 責務)

### スキップした項目
- Step 3: 未-09 (Inference Upload mode), 未-11 (Inference comparison — 中断)、未-18 (Feature Weights editor)、未-22 (Onboarding flow — 既に completed = localStorage 確認済)
- Step 4: 未-25 (非 UTF-8 CSV)、未-26 (1GB+ CSV)、未-27 (Wide DataFrame, #361 でカバー予定)、未-28 (format_version 0)、未-29 (multi-tab)

---

## 5. Browser 状態 / 環境

- **Backend** running on `http://localhost:8501` (pid 不明 / nohup で background)
- **Frontend bundle**: `src/lizystudio/static/assets/index-DAazKAj3.js` (May 3 23:04 build) — **#370 fix を含まない古いビルド** ⚠️
- 新セッションで browser 検証する場合は **必ず再ビルド**:
  ```bash
  cd /home/rem/repos/LizyStudio/frontend && pnpm build
  ```
- Server に persist したジョブ:
  - `job_47a57770` Tune #42 (binary_no_cal, no calibration)
  - `job_49beaad6` Tune (#42 の child)
  - `job_050aa3ea` Tune (#42 の grandchild)
  - 他 fit/tune 多数 (#39, #38, ..., #29, ...)
- Inference history:
  - `inf_f588369f` (with-GT, 13:37)
  - `inf_52cf729e` (with-GT, 13:21)
  - `inf_f685144b` (pred-only, 13:20)
- Workspace に load 済み: `/home/rem/repos/LizyStudio/tests/fixtures/lizyml/binary_no_cal/data.csv`
- LocalStorage `lizystudio-config-presets` に `audit-preset-r3` (split.method=time_series) が保存済

---

## 6. 既知の小バグ (Issue 起票していないが書き留めておく)

1. **`probability-histogram` plot は calibrated 二値分類のみ available** (`evaluation_mixin.py:121` で `calibration_enabled` 必須)。非 calibrated でもユーザーは予測分布を見たいだろうが、今は出ない。
   - PR #371 で当面の 404 noise は止めたが、根本的に lizyml backend に「非 calibrated 二値で probability_histogram_plot を生やす」改善が望ましい。
   - 別 Issue にするかは未定。
2. **Inference の `probability-histogram` を非 calibrated 二値ジョブに対し直接呼ぶと 500 (LizyMLError)** — `available_plots` ガード越しなら届かないので OK。frontend 経由では発生しない (#370 fix で gated)。
3. **未-23 Sidebar collapse persistence は localStorage に保存はされるが、reload 直後の "Collapse"⇄"Expand" 状態の即時反映は未確認** — 軽微。

---

## 7. 次セッション開始時の推奨アクション

### A. PR #372 のマージ確認 (最優先)
```bash
gh pr view 372 --json mergedAt,mergeStateStatus
```
- merged 済 → 進む
- まだ CI 走行中 → `gh pr checks 372 --watch` で待つ
- CI 落ちた → ログを `gh run view --log-failed` で読む

### B. 残 Issue / Round 3 残項目から選ぶ
1. **#373 SHAP Summary plot** (priority-low-medium、backend 改修必須):
   - `src/lizystudio/backends/lizyml/evaluation_mixin.py` の `_PLOT_DISPATCH` と `available_plots()` に `shap-summary` を追加
   - lizyml の `model.shap_summary_plot()` メソッドが存在するか先に確認
2. **Round 3 Step 3 残**: 未-09 / 未-11 / 未-18 — 30〜60 分で spot 検証可能
3. **Round 3 Step 4 残**: 未-25 (非 UTF-8 CSV) / 未-29 (multi-tab) — エッジケースとして 30 分以内
4. **v0.4 Phase R-1 着手**: #360 Tune long-run resume — 大型 (multi-PR / multi-week)
5. **v0.4 Phase R-5 着手**: #361 Wide DataFrame UI — 大型

### C. 次セッションで再現する Browser scenario (任意)
```bash
# 1. Backend 起動
cd /home/rem/repos/LizyStudio
nohup uv run lizystudio --port 8501 > /tmp/lz.log 2>&1 & disown
sleep 8

# 2. Frontend 再ビルド (古いバンドルだから)
cd frontend && pnpm build

# 3. Playwright 経由で http://localhost:8501/ にアクセス
# (workspace data は server に persist されているので #363 fix で自動 hydrate されるはず — 検証チャンス)
```

---

## 8. 参考リンク

- 前回セッションの handoff: [`docs/gui-verification-handoff-2026-05-03.md`](gui-verification-handoff-2026-05-03.md) — Round 1 + 2 の結果と Round 3 plan
- 業務利用定義: [`docs/business-use-definition.md`](business-use-definition.md) v0.2
- v0.4 業務利用 plan: [`docs/v0.4-business-readiness-plan.md`](v0.4-business-readiness-plan.md)
- ROADMAP 一元管理: [`docs/ROADMAP.md`](ROADMAP.md)
