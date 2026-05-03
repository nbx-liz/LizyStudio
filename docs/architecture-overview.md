# LizyStudio Architecture Overview

> 本ドキュメントは PyPI リリース v0.3.0 準備の一環として、LizyStudio の主要構造を一望するための補助資料です。 詳細仕様は [BLUEPRINT.md](../BLUEPRINT.md) が正、経緯は [HISTORY.md](../HISTORY.md)、実装スナップショットは [docs/architecture.md](./architecture.md) と [docs/architecture-as-implemented.md](./architecture-as-implemented.md) を参照してください。本書はそれらのドキュメントを置き換えるものではなく、図解による導入レイヤーとして機能します。

---

## 1. System Context (C4 Level 1)

LizyStudio は単一プロセスのデスクトップ向け Web GUI として動作し、ローカルのデータファイルとローカルにインストールされた `lizyml` ライブラリを橋渡しします。ユーザーはブラウザから操作し、外部のクラウドサービスや認証基盤には依存しません。Job 成果物 (`fit_result.json` / `model/` / 推論履歴) はすべてローカルファイルシステムに永続化され、Prometheus 互換のメトリクスエンドポイントが運用観点で外部から参照可能です。

```mermaid
flowchart LR
    User([User])
    Browser["Browser SPA<br/>(http://localhost:5173 dev<br/>http://localhost:8501 prod)"]
    Server["LizyStudio Server<br/>(FastAPI + uvicorn :8501)"]
    LizyML["lizyml library<br/>(in-process Python import)"]
    FS[("Local FileSystem<br/>.lizystudio/jobs/<br/>+ user data dirs")]
    Prom[/"Prometheus scraper<br/>(optional)"/]

    User -->|HTTP / WS| Browser
    Browser -->|REST + WebSocket| Server
    Server -->|create_model / fit / tune / predict| LizyML
    Server -->|read CSV/Parquet<br/>write meta.json / model/| FS
    Prom -->|GET /api/metrics| Server
```

---

## 2. Container View (C4 Level 2)

サーバープロセスは FastAPI アプリケーション 1 個に集約され、内部で API ルーター群・WebSocket Hub・サブプロセスワーカー・ストレージレイヤを協調させます。`uvicorn` の lifespan で `WorkspaceState` / `JobStore` / `ProgressBroadcaster` を `app.state` に組み立て、各リクエストには `Depends(...)` 経由で注入します。重い学習処理は OpenMP デーモンスレッド劣化を避けるため、子プロセスへ切り出して走らせます (H-0036)。

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        SPA["React 19 SPA<br/>+ TanStack Query<br/>+ openapi-fetch"]
    end

    subgraph Process["LizyStudio Process (uvicorn)"]
        direction TB
        API["FastAPI Routers<br/>workspace / jobs / inference<br/>backends / files / health / metrics"]
        WS["WebSocket Hub<br/>ProgressBroadcaster<br/>/ws/jobs/{id}/progress"]
        Svc["Service Layer<br/>workspace · training · jobs<br/>job_results · inference · export"]
        Adapter["BackendAdapter Protocol<br/>→ LizyMLAdapter (mixins)"]
        Sub["Subprocess Runner<br/>(child uvicorn-less Python)"]
        AppState["app.state<br/>WorkspaceState · JobStore<br/>ProgressBroadcaster · MetricsRegistry"]
    end

    subgraph Storage["Storage"]
        Jobs[("{jobs_dir}/{job_id}/<br/>meta.json · fit_result.json<br/>tune_result.json · model/<br/>execution.log · CANCEL")]
        Inf[("{jobs_dir}/{job_id}/inferences/<br/>{inf_id}/predictions.parquet<br/>+ metrics.json")]
        Tmp[("/tmp/lizystudio_*<br/>(uploaded files)")]
    end

    LizyML[["lizyml<br/>(installed package)"]]

    SPA -->|REST| API
    SPA -->|WebSocket| WS
    API --> Svc
    WS --> Svc
    Svc --> AppState
    Svc --> Adapter
    Svc -->|optional fork| Sub
    Sub --> Adapter
    Adapter --> LizyML
    Svc -->|read/write versioned JSON| Jobs
    Svc --> Inf
    API --> Tmp
```

---

## 3. Module Layering

依存方向は常に Browser → API → Service → Adapter → Backend と一方向で、Service 層は backend 固有の型を直接扱わず共通型 (`FitSummary` / `PlotData` / `DataRef`) のみを介します (CLAUDE.md §8)。Storage 層は service が版付き JSON で読み書きする SSOT で、API ルーターは直接ファイルを触りません。フロントエンドも対称な階層 (pages → hooks → api) になっており、`api/generated/schema.d.ts` の自動生成型を経由してドリフトを防ぎます (C-1)。

```mermaid
flowchart TB
    subgraph FE["Frontend (frontend/src/)"]
        direction TB
        Pages["pages/<br/>WorkspacePage · JobsPage<br/>InferencePage · NotFoundPage"]
        Comps["components/<br/>workspace · jobs · inference<br/>layout · shared · ui (shadcn)"]
        Hooks["hooks/<br/>useDataLoad · useConfigSync<br/>useJobLifecycle · useJobProgress<br/>useJobResultData"]
        FeApi["api/<br/>client.ts (openapi-fetch)<br/>workspace · jobs · inference<br/>websocket · queryKeys<br/>generated/schema.d.ts"]
    end

    subgraph BE["Backend (src/lizystudio/)"]
        direction TB
        Routers["api/<br/>workspace · jobs · inference<br/>retune · backends · files<br/>health · metrics_api"]
        Services["services/<br/>workspace · jobs · training<br/>_training_core · subprocess_runner<br/>job_results · inference · export · data"]
        Adapters["backends/<br/>base.py (Protocol)<br/>registry.py<br/>lizyml/ (mixins)"]
        Store["storage/<br/>versions · migrations<br/>(format_version SSOT)"]
        Ws["ws/<br/>progress.ProgressBroadcaster<br/>messages.WsMessage union"]
    end

    Pages --> Comps
    Pages --> Hooks
    Comps --> Hooks
    Hooks --> FeApi
    FeApi -->|HTTP / WS| Routers

    Routers --> Services
    Routers --> Ws
    Services --> Adapters
    Services --> Store
    Services --> Ws
    Adapters -.imports.-> Store
```

---

## 4. Job Lifecycle State Machine

Job は `pending` で `JobStore.create_and_claim_active` によりアクティブスロットを原子的に確保し、ランナースレッド/サブプロセスが `running` へ昇格させます。終端は `completed` / `failed` / `cancelled` のいずれかで、終端遷移時に `release_active` がスロットを解放し、Workspace ロックは終端ステータスを許容するキャリーアウト (P-0089) で post-fit re-fit を許可します。`cancelled` への遷移は HTTP `POST /jobs/{id}/cancel` または `POST /workspace/reset` 由来の協調キャンセルにより、ファイル `CANCEL` を介して subprocess へ伝搬します (Issue #152)。

```mermaid
stateDiagram-v2
    [*] --> pending: POST /workspace/fit<br/>or /workspace/tune<br/>(create_and_claim_active)
    pending --> running: runner picks up<br/>(thread or subprocess)
    running --> completed: backend.fit/tune<br/>returns FitSummary/TuningSummary
    running --> failed: exception in execute_fn<br/>or pickle preflight failure
    running --> cancelled: POST /jobs/{id}/cancel<br/>or workspace reset<br/>(CANCEL flag)
    pending --> failed: claim succeeded but<br/>start_*_async raised
    completed --> [*]: release_active +<br/>record_job_terminal("completed")
    failed --> [*]: release_active +<br/>record_job_terminal("failed")
    cancelled --> [*]: release_active +<br/>record_job_terminal("cancelled")

    note right of running
      Workspace config is locked
      while in this state
      (P-0089 / Issue #279).
      Terminal statuses unlock
      to allow post-fit re-fit.
    end note
```

---

## 5. Request → Response Flows

### 5.1 Data load (`POST /api/workspace/data/path`)

ローカルファイルパスからの読込は、まず `validate_path_within(ALLOWED_FILES_ROOT)` で symlink swap 攻撃を排除し、その後 `pandas` で DataFrame 化、`check_dataframe_memory` で OOM を予防、最後に `WorkspaceState` に揮発的に保持します。永続化はせず、ブラウザを閉じれば消える設計です (BLUEPRINT §4.2.3)。

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant SPA as React SPA
    participant API as workspace.router
    participant Sec as security.validate_path_within
    participant Data as services.data
    participant WS as WorkspaceState

    U->>SPA: select file path
    SPA->>API: POST /api/workspace/data/path { path }
    API->>Sec: validate_path_within(path, ALLOWED_FILES_ROOT)
    Sec-->>API: resolved Path
    API->>Data: load_dataframe(resolved)
    Data-->>API: pandas.DataFrame
    API->>Data: make_data_ref(df, source_type="path", ...)
    API->>WS: ws.set_data(df, data_ref)
    API-->>SPA: 200 { data_ref, memory_usage_bytes }
    SPA-->>U: preview / column analysis
```

### 5.2 Fit submit + WebSocket streaming

`POST /api/workspace/fit` はバリデーションののち `create_and_claim_active` で原子的に Job レコードを生成、`start_fit_async` がスレッドまたはサブプロセスでランナーを起動します。進捗は `ProgressCallback` を経由して `ProgressBroadcaster` に流れ、購読中の WebSocket クライアントへ JSON で配信されます (`/ws/jobs/{job_id}/progress`)。終端メッセージ受信後にフロントエンドは Job 詳細を再フェッチして結果を表示します。

```mermaid
sequenceDiagram
    autonumber
    participant SPA as React SPA
    participant API as workspace.router
    participant JS as JobStore
    participant Train as services.training
    participant Adapter as LizyMLAdapter
    participant Sub as subprocess (optional)
    participant Bcast as ProgressBroadcaster
    participant WSConn as WebSocket /ws/jobs/{id}/progress

    SPA->>API: POST /api/workspace/fit { config? }
    API->>JS: create_and_claim_active(...)
    JS-->>API: Job(pending)
    API->>Train: start_fit_async(ws, job_store, broadcaster, ...)
    par Background runner
        Train->>Adapter: create_model(config, df)
        Adapter-->>Train: model
        Train->>Sub: spawn subprocess (if enabled)
        loop progress events
            Adapter-->>Train: ProgressCallback(current,total,message)
            Train->>Bcast: publish WsProgress
            Bcast-->>WSConn: { type:"progress", ... }
        end
        Adapter-->>Train: FitSummary
        Train->>Adapter: export_model(model, model_dir)
        Train->>JS: update Job(status=completed) + release_active
        Train->>Bcast: publish WsCompleted
        Bcast-->>WSConn: { type:"completed", job_id }
    and Foreground
        API-->>SPA: 200 { job_id }
        SPA->>WSConn: connect(job_id)
        WSConn-->>SPA: progress / completed / error frames
        SPA->>API: GET /api/jobs/{job_id} (after terminal)
        API-->>SPA: JobDetail (fit_result, metrics)
    end
```

### 5.3 Export model (`POST /api/jobs/{job_id}/export`)

完了済み Job の保存済みモデルを Adapter 経由で再ロードし、ユーザーが指定したパス (allow-list 内) へ書き出します。コードエクスポート (`GET /api/jobs/{job_id}/export-code`) はテンポラリ ZIP を `BackgroundTasks` で削除する FileResponse として返却します (H-0027)。

```mermaid
sequenceDiagram
    autonumber
    participant SPA as React SPA
    participant API as jobs.router
    participant Sec as security.validate_path_within
    participant Exp as services.export
    participant Adapter as LizyMLAdapter
    participant FS as FileSystem

    SPA->>API: POST /api/jobs/{id}/export { export_type, output_path }
    API->>Sec: validate_path_within(output_path, ALLOWED_FILES_ROOT)
    API->>Exp: export_model(job, backend, output_path)
    Exp->>Adapter: load_model(job.model_path)
    Adapter-->>Exp: model
    Exp->>Adapter: export_model(model, output_path)
    Adapter->>FS: write artefacts under output_path
    Exp-->>API: resolved path
    API-->>SPA: 200 { exported_path, export_type }
```

### 5.4 Inference run (`POST /api/inference/run`)

完了済み Job をモデル供給元として、別データセットへの予測を行います。データパスを allow-list 検証してから、`run_inference` が Adapter の `predict` を呼び出し、結果を `{jobs_dir}/{job_id}/inferences/{inf_id}/` へ Parquet + JSON で永続化、Ground truth がある場合は metrics も併存します。アップロード由来の一時ファイルはレスポンス前の `finally` で `consume_temp_file` により消去します (HIGH-8)。

```mermaid
sequenceDiagram
    autonumber
    participant SPA as React SPA
    participant API as inference.router
    participant JS as JobStore
    participant InfSvc as services.inference
    participant Adapter as LizyMLAdapter
    participant Store as InferenceStore
    participant FS as FileSystem

    SPA->>API: POST /api/inference/run { job_id, data, evaluate }
    API->>JS: get(job_id) → completed?
    JS-->>API: Job
    API->>InfSvc: run_inference(job, job_store, backend, data_path, ...)
    InfSvc->>Adapter: load_model(job.model_path)
    InfSvc->>Adapter: predict(model, data, return_shap)
    Adapter-->>InfSvc: PredictionSummary
    InfSvc->>Store: write predictions.parquet + metrics.json
    Store->>FS: persist under {jobs_dir}/{job_id}/inferences/{inf_id}/
    InfSvc-->>API: InferenceRecord
    API->>SPA: 200 { inf_id, job_id }
    Note over API,SPA: SPA queries<br/>GET /api/inference/{inf_id}/predictions<br/>GET /api/inference/{inf_id}/metrics<br/>GET /api/inference/{inf_id}/plot/{type}
```

---

## 6. Cross-References

- **WHAT (構造定義)**: [BLUEPRINT.md](../BLUEPRINT.md) §0–§5
- **WHY (経緯記録)**: [HISTORY.md](../HISTORY.md) — Proposal P-0086 (atomic config@fit) / P-0089 (workspace running-lock) / H-0036 (subprocess runner) / H-0062 (re-tune lineage) / H-0068 (BackendAdapter split) / H-0083 (CORS + WS origin) / H-0084 (per-app ModelCache)
- **WHEN (フェーズ計画)**: [PLAN.md](../PLAN.md)
- **HOW (詳細スナップショット)**: [docs/architecture.md](./architecture.md), [docs/architecture-as-implemented.md](./architecture-as-implemented.md), [docs/adapter-guide.md](./adapter-guide.md), [docs/api.md](./api.md)
