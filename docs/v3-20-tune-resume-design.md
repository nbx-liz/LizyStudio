# v3-20 (R-1.4) — Tune long-run resumability 設計レビュー資料

**Status**: 🟢 Approved 2026-05-06 — 推奨案 5 件 (§6) すべて採用、実装は v3-20a..g の個別 PR で develop に積む

> 採用された設計判断 (§6 議論ポイント):
>
> 1. **API 設計**: 案 B — 既存 `/resume` は変更せず、新規 `POST /jobs/{id}/unpause` を追加
> 2. **paused 中の Cancel UX**: 案 a — UI で "新規 Job 開始には Resume か Cancel が必要" を明示
> 3. **format_version migration**: v3-20 → v3-25 順 (v3-20 で v2 導入、v3-25 で migration matrix CI gate)
> 4. **Playwright tune-resume**: 1 trial=1s mock 採用、24h 実機テストは defer
> 5. **Optuna storage**: SQLite で着手、lock 競合発生時に JournalFileStorage を検討

**Original status**: 🟡 Design review (2026-05-06)
**Proposal**: P-0099 (R-1 invariants + `paused` state Change Gate, **Approved 2026-05-06**)
**Issue**: #360 (Tune long-run resumability, 24h+, all termination paths)
**Upstream**: lizyml 0.12.0 H-0072 (`Tuner.__init__(storage=, study_name=)` + `Model.tune(storage=, study_name=)`)
**期間**: 3 週間
**実装ブランチ予定**: `feat/v3-20-r14-tune-resume`

> v0.5 R-1 で最大の production code 変更フェーズ。本資料は **着手前の構造設計レビュー** を目的とし、ユーザの "GO" 判断を前提に詳細実装に進む。

---

## 1. 達成すべき不変条件 (P-0099)

| INV | 内容 | テスト場所 |
|---|---|---|
| INV-1 | 既存 + paused: at-most-one running-or-paused、release は 6 経路のみ (paused は release 経路ではない) | `test_inv_slot_release.py` (extend) |
| INV-3 | state machine 遷移は明示宣言、illegal transitions は assert で reject。新規遷移: `running → paused` / `paused → running` / `paused → cancelled` / `paused → failed` | 新規 `test_inv_state_machine.py` |
| INV-4 | paused job は trial-level checkpoint + meta.json から完全復元可能。Optuna study re-attach で trial.number / best_value / trial.state が一致 | 新規 `test_inv_paused_roundtrip.py` |

---

## 2. 既存コード audit 結果

### 2.1 Backend adapter (`src/lizystudio/backends/lizyml/lifecycle_mixin.py`)

現在の `tune()` シグネチャ:
```python
def tune(self, model, *, on_progress, re_tune, checkpoint_dir, resume) -> TuningSummary:
```

`model.tune(progress_callback=..., resume=True, ...)` を呼ぶ既存ロジック (lines 151-169)。lizyml 0.12.0 の `Model.tune(storage=..., study_name=...)` を **新引数として pass-through** する必要あり。

### 2.2 Job dataclass (`src/lizystudio/services/jobs.py:83-100`)

```python
status: Literal["pending", "running", "completed", "failed", "cancelled"]
```

`"paused"` を **6 番目の状態として追加**。format_version 1→2 migration が必要 (既存 v1 の meta.json には status="paused" が出現しないので migration は no-op identity でも動くが、明示的に migration を書いて INV-3 の illegal transition reject ロジックを v2 で一貫させる)。

### 2.3 WebSocket messages (`src/lizystudio/ws/messages.py`)

現在 4 variant: `WsProgress` / `WsCompleted` / `WsError` / `WsPing`。
**`WsPaused` を追加**:
```python
class WsPaused(BaseModel):
    type: Literal["paused"]
    job_id: str
    trial_number: int  # 最後に完了した trial の番号
    checkpoint_path: str  # storage SQLite ファイルへの相対パス
    message: str = "Tune paused. Resume from the Jobs UI."
```

### 2.4 既存 `/resume` エンドポイント (`src/lizystudio/api/retune.py:215-272`)

既存の `POST /api/jobs/{id}/resume` は **`status="failed"` の Tune を checkpoint-based で resume** する H-0062 ロジック。新規 child job を作成する。

**重要**: P-0099 の resume (paused → running) は **同じ job_id を継続実行する** semantics (child job を作らない、Optuna study を re-attach する)。**両者を /resume URL に共存させる設計は危険** — 2 つの semantically 異なる操作が同 URL で呼ばれる。

#### 案 A: 1 つの URL で status 分岐 (P-0099 当初案)
- 単一 `POST /api/jobs/{id}/resume` で `parent.status` により分岐
- 利点: クライアント実装が一貫
- 欠点: backend 内部で 2 つのまったく違うコード経路 (child job creation vs. study re-attach)、テストの分岐が複雑化

#### 案 B: 別 URL に分離 (推奨)
- `POST /api/jobs/{id}/resume` (既存) — failed-resume のみ、変更なし
- `POST /api/jobs/{id}/unpause` (新規) — paused → running の Optuna study re-attach 専用
- 利点: API contract が明確、既存 frontend を一切壊さない、新機能を opt-in 化できる
- 欠点: P-0099 の Impact section と乖離 — minor doc update が必要

**着手提案**: 案 B。v3-20 着手時に HISTORY.md P-0099 の Impact section を minor 修正 (Approved 内容の精緻化、Re-Approval は不要と判断)。

### 2.5 Slot release semantics (Critical)

`_run_job_core.finally:` (lines 186-188 of `_training_core.py`):
```python
finally:
    job_store.release_active(job.job_id)
    job_store.clear_cancel(job.job_id)
```

**現状の問題**: pause 経路でこの finally が走ると slot が解放され INV-1 違反。

**解決策**: 新例外 `PausedError` を導入し、`_run_job_core` に専用 except branch を追加。finally で **status が "paused" の場合は release / clear_cancel をスキップ**。

```python
class PausedError(Exception):
    """Worker observed pause request — write status=paused, KEEP slot."""

def _run_job_core(...):
    try:
        ...
        execute_fn(cb)
        job.status = "completed"
    except PausedError:
        # NEW: paused branch
        job.status = "paused"
        job.completed_at = None  # paused is NOT terminal
        job_store.update(job)
        if broadcaster is not None:
            broadcaster.send_paused(job.job_id, ...)
    except (CancelledError, KeyboardInterrupt):
        job.status = "cancelled"
        ...
    except Exception as exc:
        job.status = "failed"
        ...
    finally:
        if job.status != "paused":
            job_store.release_active(job.job_id)
            job_store.clear_cancel(job.job_id)
        # progress capture / log persistence still runs unconditionally
```

これにより INV-1 が paused 状態で保たれる (slot が active_job_id に残る)。

---

## 3. 実装計画 — 7 サブフェーズ

```
v3-20a (Day 1-2)   format_version 2 migration + Job.status 拡張
v3-20b (Day 3-4)   Backend adapter storage passthrough + lizyml 0.12 連携
v3-20c (Day 5-6)   JobStore pause/unpause + PausedError + _run_job_core 分岐
v3-20d (Day 7)     POST /jobs/{id}/pause + POST /jobs/{id}/unpause API
v3-20e (Day 8)     WsPaused message + frontend WS handler
v3-20f (Day 9-10)  Frontend Jobs UI Pause / Resume buttons
v3-20g (Day 11-15) Invariant tests + Playwright tune-resume E2E
```

### 3.1 v3-20a: format_version migration + Job.status

**変更ファイル**:
- `src/lizystudio/storage/versions.py`: `STUDIO_FORMAT_VERSION` を `1` → `2`
- `src/lizystudio/storage/migrations.py`: `_migrate_v1_to_v2` 追加 (status 欠損時は "pending" デフォルト、その他は identity)
- `src/lizystudio/services/jobs.py:87`: status の Literal に `"paused"` 追加
- `src/lizystudio/api/models.py:210`: 同上

**Tests**:
- `tests/test_storage_versions.py` に v1→v2 migration テスト追加
- `tests/contract/test_format_version_migration.py` (新規) で実 v1 fixture を v2 にマイグレーションして round-trip 確認

**互換性**: 既存 v1 workspace を読み込んだ際、未知の status は "pending" にデフォルト。v0 → v1 → v2 の chain も自動。

### 3.2 v3-20b: Backend adapter passthrough

**変更ファイル**:
- `src/lizystudio/backends/base.py`: BackendAdapter Protocol の `tune()` に `storage: str | None = None`, `study_name: str | None = None` 追加 (Change Gate スコープ — Protocol 変更だが additive で既存実装は無修正で動く)
- `src/lizystudio/backends/lizyml/lifecycle_mixin.py:51-187`: `tune()` の引数追加 → `model.tune(storage=storage, study_name=study_name, ...)` へ pass-through
- `src/lizystudio/services/training.py`: tune launcher で job ごとに storage URL + study_name を組み立てて adapter に渡す
  - storage: `f"sqlite:///{job_dir}/optuna.db"` (per-job 隔離)
  - study_name: `f"studio-tune-{job_id}"`

**Tests**:
- `tests/test_backends_lizyml.py` に storage passthrough テスト追加
- `tests/test_backend_adapter_contract.py` で Protocol の `tune()` シグネチャに新引数を pin

### 3.3 v3-20c: JobStore pause/unpause + PausedError + _run_job_core

**新規ファイル / 変更**:
- `src/lizystudio/backends/exceptions.py`: `PausedError` を新例外として追加 (CancelledError 同様)
- `src/lizystudio/services/jobs.py`: `request_pause(job_id)` / `is_pause_requested(job_id)` / `clear_pause(job_id)` メソッドを既存 cancel API のパターンで実装 (in-memory set + ファイル flag for IPC)
- `src/lizystudio/services/_training_core.py:120-191`: `_run_job_core` に PausedError 分岐を追加 (上記 §2.5 設計通り)
- `src/lizystudio/services/_training_core.py:55-81` (`_make_cancel_aware_cb`): cancel check に加えて `is_pause_requested` も check、True なら `PausedError` を raise

**重要なテストポイント**:
- `_run_job_core` の finally で status="paused" のときは release_active が **呼ばれない** ことを assert する unit test
- 8 並行 pause-during-tune で「正確に 1 個が paused 状態 (slot 保持) になる」を count-based に確認

### 3.4 v3-20d: API endpoints

**変更ファイル**:
- `src/lizystudio/api/jobs.py`: 新規 `POST /api/jobs/{job_id}/pause`
  - status="running" の Tune ジョブのみ対象 (fit ジョブには pause なし — fit は短時間で完了する設計)
  - `job_store.request_pause(job_id)` を呼ぶ
  - 200 + `{"status": "paused_requested"}`
- `src/lizystudio/api/retune.py` か新規 `src/lizystudio/api/pause.py`: `POST /api/jobs/{job_id}/unpause`
  - status="paused" の Tune ジョブのみ対象
  - `services/training.py:start_tune_async` を「同 job_id で再走させる」モードで呼ぶ
  - storage / study_name を再構築してから lifecycle_mixin.tune に渡す → Optuna が `load_if_exists=True` で trial を継続

**Tests**:
- `tests/test_jobs_api.py` に pause / unpause の HTTP コントラクトテスト
- `tests/regression/test_inv_paused_roundtrip.py` (新規):
  - tune ジョブを 5 trial 走らせて pause → meta.json に status="paused"、Optuna sqlite に 5 trial 残る
  - unpause で再走 → trial 6 から開始 (load_if_exists=True で 1-5 は再実行されない)

### 3.5 v3-20e: WsPaused message

**変更ファイル**:
- `src/lizystudio/ws/messages.py`: `WsPaused` Pydantic モデル追加 + `WsMessage` discriminated union に追加
- `src/lizystudio/ws/progress.py`: `ProgressBroadcaster.send_paused(job_id, trial_number, checkpoint_path)` 追加。terminal-replay cache には載せない (paused は non-terminal)
- frontend: `pnpm generate:api` で型再生成、`useJobProgress` の switch に `case "paused"` を追加

**Tests**:
- `tests/test_ws_messages.py` に WsPaused parsing テスト
- `frontend/src/api/websocket.test.ts` に paused message ハンドリングテスト

### 3.6 v3-20f: Frontend Jobs UI

**変更ファイル**:
- `frontend/src/components/jobs/JobsPage.tsx` (or 該当 file)
  - status="running" + job_type="tune" の行に **Pause** ボタン追加
  - status="paused" の行に **Resume** ボタン追加 (既存 ResumeActionButton と命名衝突に注意 — ResumeActionButton は `failed` 用なので別 component `UnpauseActionButton` を作るか、既存に paused サポートを追加)
- `frontend/src/api/queries.ts`: `usePauseJob()` / `useUnpauseJob()` mutation hooks 追加

**UI 仕様**:
- Pause クリック → 確認ダイアログ ("Tune を一時停止します。再開可能ですが、現在の trial 完了まで停止が反映されません。")
- Pause 後 status="paused" 表示、Resume ボタンに切り替わる
- Resume クリック → 即座に POST /unpause、status="running" に戻る

**Tests**:
- Storybook story for paused state
- `frontend/src/components/jobs/JobsPage.test.tsx` で pause/resume ボタン表示分岐 + mutation 呼び出しテスト

### 3.7 v3-20g: Invariants + E2E

**新規 Test ファイル**:

1. **`tests/regression/test_inv_paused_roundtrip.py`** (INV-4)
   - 5 trials → pause → meta.json status="paused" + Optuna study に 5 trials
   - 同 storage URL + 同 study_name で再 attach → trial 6 から再開
   - assert: trial.number / best_value が一致 (snapshot ベース)

2. **`tests/regression/test_inv_state_machine.py`** (INV-3)
   - 全許可遷移を driver-based に呼び出して assert
   - illegal 遷移 (例: completed → paused) を assert で reject (`AssertionError` を期待)

3. **`tests/regression/test_inv_pause_keeps_slot.py`** (INV-1 extension)
   - 8 並行 pause-during-tune で正確に 1 個が paused 状態 + slot 保持
   - 既存 `test_inv_slot_release.py` を `paused` ケースに extend

4. **`frontend/tests/e2e/tune-resume.spec.ts`** (Playwright)
   - 50 trial の tune を起動 → 5 trial 後に Pause クリック → status=paused 確認
   - Resume クリック → 残り 45 trial を走破 → completed
   - **時間圧縮 mock**: 1 trial = 1s に設定 (lizyml の dummy backend or test fixture で)
   - 24h 超えの実機テストはランナーコスト高すぎるので圧縮 mock で代替
   - 別 spec で **process kill → restart で resume** シナリオ (server lifespan startup で paused job を再 attach)

---

## 4. リスクと未解決事項

### 4.1 リスク R-1: Subprocess + pause の同期点

**問題**: 子プロセスが OpenMP detection で起動する場合、`is_pause_requested` のファイル flag を子の中で読む必要がある (cancel と同じ仕組み)。子は SIGTERM に変換せず、ファイル flag を polling して PausedError を raise する。

**緩和**: 既存 `_make_cancel_aware_cb` パターンを extend。子の `JobStore` instance は親と同じ `jobs_dir` を見るので問題なし。

### 4.2 リスク R-2: paused の slot 占有による usability 低下

**問題**: paused job が slot を保持している間、ユーザは新規 fit / tune を起動できない。長時間 paused のままだと workspace がブロックされる。

**緩和案 a (採用推奨)**:
- pause 時に明示的 UI 通知「Tune は一時停止中です。新規 Job を始めるには、まず Resume するか Cancel してください。」
- Cancel ボタンを paused 状態でも有効化 → cancel は slot を release する正規経路 (INV-1)

**緩和案 b (未採用、要議論)**:
- paused 中は slot を擬似 release し、resume 時に再 claim — INV-1 違反になるので採用しない

### 4.3 リスク R-3: Optuna sqlite ロック競合

**問題**: 同 sqlite ファイルに対して並行 reader/writer が競合した際、Optuna は短時間ロックを取る。pause 直後にすぐ resume すると、storage flush 中の lock 競合で失敗する可能性。

**緩和**: `Tuner.tune()` の戻り後 `study.storage._connection.close()` を明示的に呼ぶ (lizyml 0.12.0 の挙動を確認、必要なら storage の `JournalFileStorage` (lock-free) を採用)。実装時に lizyml 側に Issue を切る可能性あり。

### 4.4 リスク R-4: format_version 2 への外部影響

**問題**: format_version=2 の migration matrix CI gate (v3-25) はまだ実装されていない。v3-20 で v2 を導入すると、外部から渡された v1 workspace の load 互換性に依存。

**緩和**: v3-20 と並行で v3-25 着手、または v3-25 を v3-20 と同 PR (大きすぎるので別 PR 推奨だが順序を v3-20 → v3-25 に固定)。

### 4.5 リスク R-5: Server restart 時の paused 復元

**問題**: サーバ再起動後、paused job がメモリ上の `_active_job_id` から消える。disk の status="paused" を起動時に再 attach する必要あり。

**緩和**: v3-22 (R-1.5b Server Restart Recovery) のスコープ。v3-20 では「process 内で pause → unpause が動く」までを担保し、restart 越えは v3-22 で扱う。

---

## 5. Acceptance criteria (全 phase 完了時の DoD)

- [ ] `tests/regression/test_inv_paused_roundtrip.py` で 5-trial pause → resume が trial 6 から再開する round-trip green
- [ ] `tests/regression/test_inv_state_machine.py` で全合法遷移 + illegal reject green
- [ ] `tests/regression/test_inv_pause_keeps_slot.py` で 8 並行 pause で slot 保持 green
- [ ] `tests/contract/test_format_version_migration.py` で v0 → v1 → v2 round-trip green
- [ ] `frontend/tests/e2e/tune-resume.spec.ts` で UI 経由の pause → resume シナリオ green
- [ ] Issue #360 が close 済 (kill -9 / network 切断 / browser リロード × 3 経路で 24h+ resume 動作)
- [ ] CHANGELOG (v0.5 draft) に `paused` 状態が **Added** として記載
- [ ] BLUEPRINT.md §3.4 (Job lifecycle) に INV-1〜INV-7 の状態図が反映
- [ ] HISTORY.md P-0099 の Impact section が API 設計の最終形に追従 (案 B 採用ならその記録)

---

## 6. 議論ポイント (User decision required before implementation)

1. **API 設計** — §2.4 案 A (一URL分岐) vs 案 B (別 URL `/unpause`) どちらで進めるか?
2. **paused 中の Cancel UX** — §4.2 緩和案 a (明示通知 + Cancel 経路) で OK か?
3. **format_version migration の順序** — §4.4 v3-20 → v3-25 の順で進めるか? それとも v3-25 を先に切り出すか?
4. **Playwright tune-resume の時間圧縮** — §3.7 で 1 trial=1s の mock を使う方針で OK か? (24h 実機テストは別途 nightly bench で扱うか議論要)
5. **lizyml 0.12.0 の Optuna storage 挙動** — §4.3 リスク R-3 の lock 競合は実装中に確認。問題があれば LizyML に Issue を切るが、最初は dev 用に `JournalFileStorage` を試すか SQLite で行くか?

---

## 7. References

- HISTORY.md P-0099 (`Approved` 2026-05-06)
- PLAN.md v3-20 (entry criteria + DoD)
- LizyML 0.12.0 H-0072 (`Tuner` / `Model.tune()` storage args)
- BLUEPRINT.md §3.4 (Job lifecycle, will be updated)
- ~/.claude/rules/common/invariants-first.md (テスト先行ルール)
